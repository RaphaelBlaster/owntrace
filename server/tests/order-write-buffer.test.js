import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import mongoose from 'mongoose'
import OrderEvent from '../src/models/order-event.model.js'
import OrderReceipt from '../src/models/order-receipt.model.js'
import { getOrderWriteBufferConfig, orderWriteBufferEnabled } from '../src/config/order-write-buffer.js'
import {
  applyOrderWrites,
  bufferOrderWrites,
  closeOrderWriteBuffer,
  drainBufferedOrderWrites,
  drainOrderWriteBatch,
  groupOrderWrites,
  orderWriteEnvelope,
  orderWriteModelOrder,
  safeOrderWriteBufferConfig,
  startOrderWriteBufferWorker,
} from '../src/services/order-write-buffer.service.js'
import { removeOrderSource } from '../src/services/order-control.service.js'

// A local in-process stand-in for the same-host Redis stream. It implements just
// the consumer-group commands the buffer uses, including claim and ack tracking.
const { clients } = vi.hoisted(() => ({ clients: [] }))

vi.mock('ioredis', () => {
  class FakeRedis {
    constructor(options) {
      this.options = options
      this.entries = []
      this.sequence = 0
      this.failAppend = false
      clients.push(this)
    }
    on() { return this }
    async quit() { return 'OK' }
    disconnect() {}
    async xgroup() { return 'OK' }
    async xadd(key, ...args) {
      if (this.failAppend) throw new Error('redis unavailable')
      const id = `1700000000000-${++this.sequence}`
      this.entries.push({ id, json: args[args.length - 1], delivered: false, acked: false, deleted: false, foreign: false })
      return id
    }
    live() { return this.entries.filter((entry) => !entry.deleted) }
    static count(args) { const index = args.indexOf('COUNT'); return index === -1 ? 100 : Number(args[index + 1]) }
    payload(entries) { return entries.map((entry) => [entry.id, ['write', entry.json]]) }
    async xreadgroup(...args) {
      const cursor = args[args.length - 1]
      const limit = FakeRedis.count(args)
      if (cursor === '0') {
        const pending = this.live().filter((entry) => entry.delivered && !entry.acked && !entry.foreign).slice(0, limit)
        return pending.length ? [['stream', this.payload(pending)]] : []
      }
      const fresh = this.live().filter((entry) => !entry.delivered && !entry.foreign).slice(0, limit)
      if (!fresh.length) {
        // Yield to the event loop the way a blocking XREADGROUP would.
        await new Promise((resolve) => setTimeout(resolve, 1).unref?.())
        return null
      }
      fresh.forEach((entry) => { entry.delivered = true })
      return [['stream', this.payload(fresh)]]
    }
    async xautoclaim(key, group, consumer, minIdleMs, start, ...args) {
      const claimed = this.live().filter((entry) => entry.foreign && !entry.delivered).slice(0, FakeRedis.count(args))
      claimed.forEach((entry) => { entry.delivered = true })
      return ['0-0', this.payload(claimed)]
    }
    async xack(key, group, ...ids) {
      ids.forEach((id) => { const entry = this.entries.find((item) => item.id === id); if (entry) entry.acked = true })
      return ids.length
    }
    async xdel(key, ...ids) {
      ids.forEach((id) => { const entry = this.entries.find((item) => item.id === id); if (entry) entry.deleted = true })
      return ids.length
    }
  }
  return { default: FakeRedis }
})

const userId = new mongoose.Types.ObjectId()
const connectionId = new mongoose.Types.ObjectId()
const messageScope = (index) => ({ userId, provider: 'outlook', connectionId, messageIdHash: 'hash-' + index })
const eventEnvelope = (index) => orderWriteEnvelope('OrderEvent', messageScope(index), {
  fingerprint: 'fingerprint-' + index,
  merchantName: 'Shop',
  merchantDomain: 'shop.example',
  status: 'shipped',
  summary: 'Shipment reported.',
  occurredAt: new Date('2026-01-05T00:00:00.000Z'),
  policyVersion: 1,
})
const receiptEnvelope = (index) => orderWriteEnvelope('OrderReceipt', messageScope(index), {
  fingerprint: 'fingerprint-' + index,
  outcome: 'order',
  policyVersion: 1,
  expiresAt: new Date(Date.now() + 86400000),
})
const signalEnvelope = (model, index) => orderWriteEnvelope(model,
  { connectionId, messageIdHash: 'hash-' + index, userId },
  { senderDomain: 'shop.example', occurredAt: new Date('2026-01-05T00:00:00.000Z') },
  { connectionId, messageIdHash: 'hash-' + index, threadIdHash: 'thread-' + index, userId })
const drainConfig = { streamKey: 'owntrace:test-writes', group: 'owntrace-writers', consumer: 'owntrace-test', batchSize: 10, blockMs: 1, claimIdleMs: 1000, retryDelayMs: 1, maxStreamLength: 100, maxBatchFailures: 1 }

function seed(redis, json, foreign = false) {
  const entry = { id: `1800000000000-${redis.entries.length + 1}`, json, delivered: false, acked: false, deleted: false, foreign }
  redis.entries.push(entry)
  return entry
}
// Materializes the singleton client the producers use and returns the fake.
async function bufferedClient(envelopes) {
  vi.stubEnv('ORDER_REDIS_URL', 'redis://127.0.0.1:6379')
  expect(await bufferOrderWrites(envelopes)).toBe(true)
  return clients.at(-1)
}
// Same client, but without appending anything first.
async function emptyClient() {
  vi.stubEnv('ORDER_REDIS_URL', 'redis://127.0.0.1:6379')
  expect(await drainBufferedOrderWrites()).toBe(0)
  return clients.at(-1)
}

beforeEach(async () => { clients.length = 0; await closeOrderWriteBuffer() })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await closeOrderWriteBuffer() })

describe('ORDER_REDIS_URL configuration', () => {
  it('keeps direct Mongo writes when Redis is not configured', () => {
    vi.stubEnv('ORDER_REDIS_URL', '')
    expect(orderWriteBufferEnabled()).toBe(false)
    expect(getOrderWriteBufferConfig()).toBeNull()
    expect(safeOrderWriteBufferConfig()).toBeNull()
  })
  it('accepts same-host Redis endpoints only', () => {
    vi.stubEnv('ORDER_REDIS_URL', 'redis://127.0.0.1:6380/3')
    const scoped = getOrderWriteBufferConfig()
    expect(scoped.connection).toMatchObject({ host: '127.0.0.1', port: 6380, db: 3 })
    expect(scoped.streamKey).toBe('owntrace:order-writes')
    expect(scoped.consumer).toContain('owntrace-')
    vi.stubEnv('ORDER_REDIS_URL', 'rediss://:s3cret@localhost:6379')
    expect(getOrderWriteBufferConfig().connection).toMatchObject({ host: 'localhost', port: 6379, db: 0, password: 's3cret', tls: {} })
    for (const url of ['redis://localhost:6379', 'redis://[::1]:6379', 'redis://owntrace-redis:6379']) {
      vi.stubEnv('ORDER_REDIS_URL', url)
      expect(getOrderWriteBufferConfig()).toBeTruthy()
    }
  })
  it('rejects managed endpoints, foreign protocols and malformed values', () => {
    for (const url of ['redis://owntrace.abcdef.0001.use1.cache.amazonaws.com:6379', 'redis://redis.example.com:6379', 'https://localhost:6379', 'redis://localhost:6379?family=6', 'redis://localhost:6379/20', 'not-a-url']) {
      vi.stubEnv('ORDER_REDIS_URL', url)
      expect(() => getOrderWriteBufferConfig()).toThrow(/ORDER_REDIS_URL/)
      expect(safeOrderWriteBufferConfig()).toBeNull()
    }
  })
  it('validates the buffer tuning ranges', () => {
    vi.stubEnv('ORDER_REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('ORDER_WRITE_BUFFER_BATCH_SIZE', '0')
    expect(() => getOrderWriteBufferConfig()).toThrow(/ORDER_WRITE_BUFFER_BATCH_SIZE/)
    vi.stubEnv('ORDER_WRITE_BUFFER_BATCH_SIZE', '50')
    vi.stubEnv('ORDER_WRITE_BUFFER_MAX_BATCH_FAILURES', '99')
    expect(() => getOrderWriteBufferConfig()).toThrow(/ORDER_WRITE_BUFFER_MAX_BATCH_FAILURES/)
    vi.stubEnv('ORDER_WRITE_BUFFER_MAX_BATCH_FAILURES', '2')
    expect(getOrderWriteBufferConfig()).toMatchObject({ batchSize: 50, maxBatchFailures: 2 })
  })
})

describe('buffered write envelopes', () => {
  it('only allows the sanitized derived-metadata models', () => {
    expect(() => orderWriteEnvelope('OrderScan', {}, {})).toThrow(/cannot be buffered/)
    expect(() => orderWriteEnvelope('GoogleConnection', {}, {})).toThrow(/cannot be buffered/)
    expect(() => groupOrderWrites([{ model: 'OrderEvent' }])).toThrow(/unsupported envelope/)
    expect(() => groupOrderWrites([{ model: 'OrderScan', filter: {}, set: {} }])).toThrow(/unsupported envelope/)
  })
  it('groups one bulk write per model with events before receipts', () => {
    const groups = groupOrderWrites([signalEnvelope('MicrosoftSignal', 1), receiptEnvelope(1), signalEnvelope('GmailSignal', 2), eventEnvelope(1)])
    expect(groups.map((group) => group.name)).toEqual(orderWriteModelOrder)
    expect(groups.map((group) => group.name)).toEqual(['OrderEvent', 'OrderReceipt', 'GmailSignal', 'MicrosoftSignal'])
    const event = groups[0].ops[0].updateOne
    expect(event.upsert).toBe(true)
    expect(event.filter.userId).toBeInstanceOf(mongoose.Types.ObjectId)
    expect(event.update.$set.occurredAt).toBeInstanceOf(Date)
    expect(groups[1].ops[0].updateOne.update.$set.expiresAt).toBeInstanceOf(Date)
    expect(groups[2].ops[0].updateOne.update.$setOnInsert.threadIdHash).toBe('thread-2')
  })
  it('writes grouped batches to Mongo and stops at the first failure', async () => {
    const groups = groupOrderWrites([eventEnvelope(1), receiptEnvelope(1)])
    const written = await applyOrderWrites(groups)
    expect(written).toEqual({ OrderEvent: { writes: 1, upserted: 1 }, OrderReceipt: { writes: 1, upserted: 1 } })
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect(await OrderReceipt.countDocuments()).toBe(1)
    const receiptWrites = vi.spyOn(OrderReceipt, 'bulkWrite')
    vi.spyOn(OrderEvent, 'bulkWrite').mockRejectedValue(new Error('write conflict'))
    await expect(applyOrderWrites(groupOrderWrites([eventEnvelope(2), receiptEnvelope(2)]))).rejects.toThrow('write conflict')
    expect(receiptWrites).not.toHaveBeenCalled()
    expect(await OrderReceipt.countDocuments()).toBe(1)
  })
})

describe('producer appends', () => {
  it('appends one stream entry per envelope without writing Mongo', async () => {
    const eventWrites = vi.spyOn(OrderEvent, 'bulkWrite')
    const redis = await bufferedClient([eventEnvelope(1), receiptEnvelope(1)])
    expect(redis.entries).toHaveLength(2)
    expect(JSON.parse(redis.entries[0].json)).toMatchObject({ model: 'OrderEvent', set: { status: 'shipped' } })
    expect(JSON.parse(redis.entries[1].json).model).toBe('OrderReceipt')
    expect(eventWrites).not.toHaveBeenCalled()
    expect(await OrderEvent.countDocuments()).toBe(0)
  })
  it('reports unavailable instead of throwing when Redis cannot append', async () => {
    const redis = await bufferedClient([eventEnvelope(1)])
    redis.failAppend = true
    expect(await bufferOrderWrites([eventEnvelope(2)])).toBe(false)
    expect(redis.entries).toHaveLength(1)
    redis.failAppend = false
    expect(await bufferOrderWrites([])).toBe(false)
  })
  it('does not buffer when Redis is not configured', async () => {
    vi.stubEnv('ORDER_REDIS_URL', '')
    expect(await bufferOrderWrites([eventEnvelope(1)])).toBe(false)
    expect(clients).toHaveLength(0)
  })
})

describe('drain worker', () => {
  it('writes Mongo and only then acknowledges and deletes', async () => {
    const redis = await bufferedClient([eventEnvelope(1), receiptEnvelope(1)])
    const batch = await drainOrderWriteBatch(redis, drainConfig)
    expect(batch.failed).toBe(false)
    expect(batch.acked).toBe(2)
    expect(batch.written).toEqual({ OrderEvent: { writes: 1, upserted: 1 }, OrderReceipt: { writes: 1, upserted: 1 } })
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect(await OrderReceipt.countDocuments()).toBe(1)
    expect(redis.entries.every((entry) => entry.acked && entry.deleted)).toBe(true)
    expect(await drainOrderWriteBatch(redis, drainConfig)).toMatchObject({ ids: [], acked: 0, failed: false })
  })
  it('leaves a failed batch pending in Redis and retries it', async () => {
    const redis = await bufferedClient([eventEnvelope(1), receiptEnvelope(1)])
    vi.spyOn(OrderEvent, 'bulkWrite').mockRejectedValueOnce(new Error('mongo down'))
    const first = await drainOrderWriteBatch(redis, drainConfig)
    expect(first.failed).toBe(true)
    expect(first.acked).toBe(0)
    expect(redis.entries.every((entry) => !entry.acked && !entry.deleted)).toBe(true)
    expect(await OrderReceipt.countDocuments()).toBe(0)
    const retry = await drainOrderWriteBatch(redis, drainConfig)
    expect(retry.failed).toBe(false)
    expect(retry.acked).toBe(2)
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect(await OrderReceipt.countDocuments()).toBe(1)
  })
  it('drops a malformed envelope instead of stalling the stream', async () => {
    const redis = await bufferedClient([eventEnvelope(1)])
    const malformed = seed(redis, 'not-json')
    const batch = await drainOrderWriteBatch(redis, drainConfig)
    expect(batch.failed).toBe(false)
    expect(batch.acked).toBe(2)
    expect(batch.ids).not.toContain(malformed.id)
    expect(malformed.acked).toBe(true)
    expect(malformed.deleted).toBe(true)
    expect(await OrderEvent.countDocuments()).toBe(1)
  })
  it('reclaims entries a dead consumer left behind', async () => {
    const redis = await emptyClient()
    const orphan = seed(redis, JSON.stringify(eventEnvelope(5)), true)
    const batch = await drainOrderWriteBatch(redis, drainConfig)
    expect(batch.ids).toEqual([orphan.id])
    expect(await OrderEvent.countDocuments({ messageIdHash: 'hash-5' })).toBe(1)
    expect(orphan.acked && orphan.deleted).toBe(true)
  })
  it('drains continuously and acknowledges after Mongo success', async () => {
    const redis = await emptyClient()
    const stop = startOrderWriteBufferWorker(drainConfig, { client: redis })
    seed(redis, JSON.stringify(eventEnvelope(7)))
    await vi.waitFor(async () => { expect(await OrderEvent.countDocuments({ messageIdHash: 'hash-7' })).toBe(1) })
    await stop()
    expect(redis.entries.at(-1).acked).toBe(true)
    expect(redis.entries.at(-1).deleted).toBe(true)
  })
  it('steps over a repeatedly failing batch so newer writes still land', async () => {
    const redis = await emptyClient()
    const stalled = seed(redis, JSON.stringify(eventEnvelope('stalled')))
    const apply = vi.fn(async (groups) => {
      const poisoned = groups.some((group) => group.ops.some((operation) => operation.updateOne.filter.messageIdHash === 'hash-stalled'))
      if (poisoned) throw new Error('poison entry')
      return applyOrderWrites(groups)
    })
    const stop = startOrderWriteBufferWorker({ ...drainConfig, batchSize: 1 }, { client: redis, apply })
    await vi.waitFor(() => expect(apply.mock.calls.length).toBeGreaterThanOrEqual(2))
    seed(redis, JSON.stringify(eventEnvelope('fresh')))
    await vi.waitFor(async () => { expect(await OrderEvent.countDocuments({ messageIdHash: 'hash-fresh' })).toBe(1) })
    await stop()
    expect(await OrderEvent.countDocuments({ messageIdHash: 'hash-stalled' })).toBe(0)
    expect(stalled.acked).toBe(false)
    expect(stalled.deleted).toBe(false)
  })
})

describe('deletion guards', () => {
  it('flushes buffered writes before deleting order data', async () => {
    const redis = await bufferedClient([eventEnvelope(13), receiptEnvelope(13)])
    let eventsWhenDeleted = null
    const realDeleteMany = OrderEvent.deleteMany.bind(OrderEvent)
    vi.spyOn(OrderEvent, 'deleteMany').mockImplementation(async (filter) => {
      eventsWhenDeleted = await OrderEvent.countDocuments()
      return realDeleteMany(filter)
    })
    await removeOrderSource(userId, 'outlook', connectionId)
    // The buffered write reached Mongo before the delete ran, so nothing survives.
    expect(eventsWhenDeleted).toBe(1)
    expect(await OrderEvent.countDocuments()).toBe(0)
    expect(await OrderReceipt.countDocuments()).toBe(0)
    expect(redis.entries.every((entry) => entry.acked && entry.deleted)).toBe(true)
  })
  it('drains on demand and is a no-op without Redis', async () => {
    const redis = await bufferedClient([eventEnvelope(15), receiptEnvelope(15)])
    expect(await OrderEvent.countDocuments()).toBe(0)
    expect(await drainBufferedOrderWrites()).toBe(2)
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect(await OrderReceipt.countDocuments()).toBe(1)
    expect(redis.entries.every((entry) => entry.acked && entry.deleted)).toBe(true)
    vi.stubEnv('ORDER_REDIS_URL', '')
    expect(await drainBufferedOrderWrites()).toBe(0)
  })
})
