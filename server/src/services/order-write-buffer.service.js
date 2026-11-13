import mongoose from 'mongoose'
import Redis from 'ioredis'
import GmailSignal from '../models/gmail-signal.model.js'
import MicrosoftSignal from '../models/microsoft-signal.model.js'
import OrderEvent from '../models/order-event.model.js'
import OrderReceipt from '../models/order-receipt.model.js'
import { getOrderWriteBufferConfig, orderWriteBufferEnabled } from '../config/order-write-buffer.js'
import { logEvent } from '../utils/logger.js'

// Only these derived-metadata models may be buffered. Scan/sync control state,
// leases, budgets and consent stay direct in Mongo because their readers need
// the value they just wrote.
const bufferedModels = { GmailSignal, MicrosoftSignal, OrderEvent, OrderReceipt }
// One bulkWrite per model, in this order: an OrderReceipt marks a message
// deduplicated, so it may never reach Mongo when its OrderEvent write failed.
export const orderWriteModelOrder = ['OrderEvent', 'OrderReceipt', 'GmailSignal', 'MicrosoftSignal']
const orderedWrites = { OrderEvent: true, OrderReceipt: true, GmailSignal: false, MicrosoftSignal: false }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms).unref?.())

let client = null
let batchTail = Promise.resolve()

async function withBatchLock(work) {
  const previous = batchTail
  let release
  batchTail = new Promise(resolve => { release = resolve })
  await previous
  try { return await work() } finally { release() }
}

export function safeOrderWriteBufferConfig() {
  if (!orderWriteBufferEnabled()) return null
  try { return getOrderWriteBufferConfig() } catch {
    logEvent('warn', 'order_write_buffer_unconfigured', { errorCode: 'ORDER_WRITE_BUFFER_CONFIG_INVALID' })
    return null
  }
}
function bufferClient(config) {
  if (!client) {
    client = new Redis(config.connection)
    // Connection loss is reported per write; it must not crash the process.
    client.on('error', () => logEvent('warn', 'order_write_buffer_redis_error', { errorCode: 'ORDER_WRITE_BUFFER_UNAVAILABLE' }))
  }
  return client
}
export async function closeOrderWriteBuffer() {
  const previous = client
  client = null
  if (!previous) return
  try { await previous.quit() } catch { previous.disconnect() }
}
// Envelopes hold only already-sanitized metadata: hashed message ids, sender
// domain/email, the normalized subject signal, billing fields and dates.
export function orderWriteEnvelope(model, filter, set, setOnInsert) {
  if (!bufferedModels[model]) throw new Error(`${model} writes cannot be buffered`)
  return { model, filter, set, ...(setOnInsert ? { setOnInsert } : {}) }
}
// JSON turns ObjectIds into hex and Dates into ISO strings; revive them with the
// schema so replayed envelopes write exactly the same values.
function revive(model, document) {
  const schema = bufferedModels[model].schema
  return Object.fromEntries(Object.entries(document || {}).map(([path, value]) => {
    if (value === null || value === undefined) return [path, value]
    const instance = schema.path(path)?.instance
    if (instance === 'Date') return [path, new Date(value)]
    if (instance === 'ObjectID' || instance === 'ObjectId') return [path, new mongoose.Types.ObjectId(value)]
    return [path, value]
  }))
}
export function groupOrderWrites(envelopes) {
  const grouped = new Map()
  for (const envelope of envelopes) {
    const model = bufferedModels[envelope?.model]
    if (!model || !envelope.filter || !envelope.set) throw new Error('Buffered write used an unsupported envelope')
    if (!grouped.has(envelope.model)) grouped.set(envelope.model, [])
    grouped.get(envelope.model).push({ updateOne: {
      filter: revive(envelope.model, envelope.filter),
      update: { $set: revive(envelope.model, envelope.set), ...(envelope.setOnInsert ? { $setOnInsert: revive(envelope.model, envelope.setOnInsert) } : {}) },
      upsert: true,
    } })
  }
  return orderWriteModelOrder.filter(name => grouped.has(name)).map(name => ({ name, model: bufferedModels[name], ops: grouped.get(name) }))
}
// Sequential on purpose: the first failure stops the batch, so receipts are
// never written after an event write failed. Upserts make replay idempotent.
export async function applyOrderWrites(groups) {
  const written = {}
  for (const group of groups) {
    const result = await group.model.bulkWrite(group.ops, { ordered: orderedWrites[group.name] })
    written[group.name] = { writes: group.ops.length, upserted: result?.upsertedCount ?? 0 }
  }
  return written
}
// Producers append to Redis first; Mongo is written only by the drain worker.
// Returns false when Redis is absent or unreachable so callers keep the safe
// fallback of writing the same idempotent upserts directly to Mongo.
export async function bufferOrderWrites(envelopes) {
  const config = safeOrderWriteBufferConfig()
  if (!config || !envelopes.length) return false
  try {
    const redis = bufferClient(config)
    for (const envelope of envelopes) {
      await redis.xadd(config.streamKey, '*', 'write', JSON.stringify(envelope))
    }
    return true
  } catch {
    logEvent('warn', 'order_write_buffer_append_failed', { errorCode: 'ORDER_WRITE_BUFFER_UNAVAILABLE' })
    return false
  }
}
function entriesFrom(response) {
  const entries = []
  for (const [, batch] of response || []) for (const entry of batch || []) entries.push(entry)
  return entries
}
function envelopeFrom(fields) {
  const payload = {}
  for (let index = 0; index < (fields || []).length; index += 2) payload[fields[index]] = fields[index + 1]
  try { return JSON.parse(payload.write) } catch { return null }
}
async function readBatch(redis, config, skipPending) {
  if (!skipPending) {
    // Own pending entries first, so a failed Mongo write is retried immediately.
    const pending = entriesFrom(await redis.xreadgroup('GROUP', config.group, config.consumer, 'COUNT', config.batchSize, 'STREAMS', config.streamKey, '0'))
    if (pending.length) return pending
    // Then entries a consumer left behind when its process died.
    const claimed = await redis.xautoclaim(config.streamKey, config.group, config.consumer, config.claimIdleMs, '0-0', 'COUNT', config.batchSize)
    const recovered = entriesFrom(claimed?.[1] ? [[config.streamKey, claimed[1]]] : null)
    if (recovered.length) return recovered
  }
  return entriesFrom(await redis.xreadgroup('GROUP', config.group, config.consumer, 'COUNT', config.batchSize, 'BLOCK', config.blockMs, 'STREAMS', config.streamKey, '>'))
}
// Reads one bounded batch, groups it by model, writes Mongo, and only then
// acknowledges. A failed batch stays pending in Redis and is retried.
export async function drainOrderWriteBatch(redis, config, apply = applyOrderWrites, { skipPending = false } = {}) {
  return withBatchLock(async () => {
    const entries = await readBatch(redis, config, skipPending)
    if (!entries.length) return { ids: [], written: {}, acked: 0, failed: false }
    const envelopes = [], malformed = []
    for (const [id, fields] of entries) {
      const envelope = envelopeFrom(fields)
      if (envelope) envelopes.push(envelope)
      else malformed.push(id)
    }
    if (malformed.length) {
      // An unparseable envelope can never be written; drop it instead of stalling.
      logEvent('error', 'order_write_buffer_envelope_invalid', { errorCode: 'ORDER_WRITE_BUFFER_INVALID' })
      await redis.xack(config.streamKey, config.group, ...malformed)
      await redis.xdel(config.streamKey, ...malformed)
    }
    const ids = entries.map(([id]) => id).filter(id => !malformed.includes(id))
    if (!ids.length) return { ids: [], written: {}, acked: malformed.length, failed: false }
    try {
      const written = await apply(groupOrderWrites(envelopes))
      await redis.xack(config.streamKey, config.group, ...ids)
      await redis.xdel(config.streamKey, ...ids)
      return { ids, written, acked: ids.length + malformed.length, failed: false }
    } catch {
      logEvent('warn', 'order_write_buffer_batch_failed', { errorCode: 'ORDER_WRITE_BUFFER_WRITE_FAILED' })
      return { ids, written: {}, acked: malformed.length, failed: true }
    }
  })
}
// '0' rather than '$': a group created after appends must still deliver them.
async function ensureGroup(redis, config) {
  try { await redis.xgroup('CREATE', config.streamKey, config.group, '0', 'MKSTREAM') } catch (error) {
    if (!/BUSYGROUP/.test(String(error?.message))) throw error
  }
}
export function startOrderWriteBufferWorker(config = safeOrderWriteBufferConfig(), { client: provided, apply = applyOrderWrites } = {}) {
  if (!config) return null
  const redis = provided || bufferClient(config)
  let stopping = false, stalledKey = null, failures = 0
  const running = (async () => {
    while (!stopping) {
      try {
        await ensureGroup(redis, config)
        // Repeated Mongo failures are left pending while newer writes continue.
        const batch = await drainOrderWriteBatch(redis, config, apply, { skipPending: failures >= config.maxBatchFailures })
        if (batch.failed) {
          const key = batch.ids[0]
          failures = key === stalledKey ? failures + 1 : 1
          stalledKey = key
          await sleep(config.retryDelayMs)
          continue
        }
        failures = 0; stalledKey = null
      } catch {
        logEvent('warn', 'order_write_buffer_worker_retrying', { errorCode: 'ORDER_WRITE_BUFFER_UNAVAILABLE' })
        await sleep(config.retryDelayMs)
      }
    }
  })()
  return async () => {
    stopping = true
    await running
    try { await drainBufferedOrderWrites({ timeoutMs: 30000, apply }) }
    catch { logEvent('warn', 'order_write_buffer_shutdown_deferred', { errorCode: 'ORDER_WRITE_BUFFER_PENDING' }) }
    await closeOrderWriteBuffer()
  }
}
// Cancellation and deletion paths drain first so buffered writes cannot land
// after the delete and resurrect data the user just removed.
export async function drainBufferedOrderWrites({ timeoutMs = 5000, apply = applyOrderWrites } = {}) {
  const config = safeOrderWriteBufferConfig()
  if (!config) return 0
  const redis = bufferClient(config)
  const deadline = Date.now() + timeoutMs
  let drained = 0
  await ensureGroup(redis, config)
  while (Date.now() < deadline) {
    const batch = await drainOrderWriteBatch(redis, { ...config, blockMs: 100 }, apply)
    drained += batch.acked
    if (batch.failed) throw new Error('Buffered Mongo writes are still pending')
    if (!batch.ids.length) return drained
  }
  throw new Error('Buffered Mongo writes did not drain before the timeout')
}
