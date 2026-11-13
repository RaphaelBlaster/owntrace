import { randomUUID } from 'node:crypto'
import OrderScan from '../models/order-scan.model.js'
import OrderPreference from '../models/order-preference.model.js'
import OrderBudget from '../models/order-budget.model.js'
import OrderEvent from '../models/order-event.model.js'
import OrderReceipt from '../models/order-receipt.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { classifyBatch, extractCards, sanitizeMetadata, ORDER_POLICY_VERSION, orderProviderConfigured } from './order-processing.service.js'
import { fetchOrderPage, hashOrderValue } from './order-mail.service.js'
import { registerOrderWork, releaseOrderWork } from './order-control.service.js'
import { createOrderWriteBatch, findPendingReceipt } from './order-write-batch.service.js'
import AppError from '../utils/app-error.js'
import { logEvent } from '../utils/logger.js'

const DAY = 86400000, LEASE = 240000
export async function initializeOrderStorage() {
  await Promise.all([OrderScan, OrderPreference, OrderBudget, OrderEvent, OrderReceipt].map(Model => Model.init()))
}
export const orderPolicy = { initialDays: 30, initialLimit: 200, dailyLimit: 200, onDemandLimit: 50, onDemandCooldownSeconds: 300, pageSize: 25, modelBatchSize: 5, dailyMetadataLimit: 1000, userModelUnits: 100000, globalModelUnits: 500000, receiptRetentionDays: 90 }
const connectionModel = provider => provider === 'gmail' ? GoogleConnection : MicrosoftConnection
const consentFilter = userId => ({ userId, enabled: true, version: ORDER_POLICY_VERSION, acceptedAt: { $ne: null } })
export async function requireOrderConsent(userId) {
  if (!await OrderPreference.exists(consentFilter(userId))) throw new AppError('Enable order email analysis before scanning.', 403, 'ORDER_CONSENT_REQUIRED')
}
export function publicScan(scan) {
  if (!scan) return null
  return Object.fromEntries(['provider','mode','status','limit','processed','examined','stored','reviewed','skipped','since','until','filterDomain','checkpointAt','lastErrorCode','updatedAt'].map(key => [key, scan[key]]))
}
export async function startOrderScan(userId, provider, mode, options = {}) {
  await requireOrderConsent(userId)
  if (!['gmail', 'outlook'].includes(provider) || !['initial', 'daily', 'on_demand'].includes(mode)) throw new AppError('Invalid scan request.', 400, 'ORDER_INVALID_INPUT')
  const connection = await connectionModel(provider).findOne({ userId, status: { $in: ['CONNECTED', 'SYNCING'] } })
  if (!connection) throw new AppError('Connect or reconnect this mailbox before scanning orders.', 409, 'ORDER_NOT_CONNECTED')
  if (!orderProviderConfigured()) throw new AppError('Configure Inception before scanning orders.', 503, 'ORDER_AI_NOT_CONFIGURED')
  if (mode === 'daily' && !await OrderPreference.exists({ ...consentFilter(userId), daily: true })) throw new AppError('Daily analysis is disabled.', 403, 'ORDER_DAILY_DISABLED')
  const previous = await OrderScan.findOne({ userId, provider }).select('+cursor +runId')
  if (previous && ['QUEUED', 'RUNNING'].includes(previous.status)) throw new AppError('An order scan is already active.', 409, 'ORDER_SCAN_BUSY')
  if (previous && mode === 'initial') throw new AppError('Initial import has already started. Use on-demand to resume or update it.', 409, 'ORDER_INITIAL_EXISTS')
  if (previous?.lastOnDemandAt && mode === 'on_demand' && Date.now() - previous.lastOnDemandAt.getTime() < 300000) throw new AppError('Wait five minutes between on-demand scans.', 429, 'ORDER_SCAN_COOLDOWN')
  if (options.days !== undefined && ![7,30,90].includes(options.days) || options.merchantDomain !== undefined && (typeof options.merchantDomain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(options.merchantDomain))) throw new AppError('Choose a supported period and merchant domain.', 400, 'ORDER_INVALID_INPUT')
  const explicitWindow = options.days !== undefined || options.merchantDomain !== undefined
  const resume = !explicitWindow && previous && ['PAUSED', 'FAILED'].includes(previous.status) && String(previous.connectionId) === String(connection.id) && (mode !== 'daily' || !previous.filterDomain)
  const until = resume ? previous.until : new Date()
  // Overlap catches late-arriving events; persisted receipts prevent duplicate AI work.
  const since = resume ? previous.since : explicitWindow ? new Date(Date.now() - (options.days || 30) * DAY) : previous?.checkpointAt ? new Date(previous.checkpointAt.getTime() - DAY) : new Date(Date.now() - 30 * DAY)
  const values = { connectionId: connection.id, mode, status: 'QUEUED', runId: randomUUID(), leaseId: null, leaseUntil: null,
    cursor: resume ? previous.cursor : null, since, until, filterDomain: resume ? previous.filterDomain : options.merchantDomain || null, limit: mode === 'on_demand' ? 50 : 200, processed: 0, examined: 0, stored: 0, reviewed: 0, skipped: 0, lastErrorCode: null,
    ...(mode === 'on_demand' ? { lastOnDemandAt: new Date() } : {}),
  }
  try {
    const filter = { userId, provider, ...(previous ? { _id: previous.id, status: previous.status, updatedAt: previous.updatedAt } : {}) }
    const scan = await OrderScan.findOneAndUpdate(filter, { $set: values }, { upsert: !previous, returnDocument: 'after', runValidators: true })
    if (!scan) throw new AppError('An order scan changed. Refresh and retry.', 409, 'ORDER_SCAN_BUSY')
    return scan
  } catch (error) { if (error.code === 11000) throw new AppError('An order scan is already active.', 409, 'ORDER_SCAN_BUSY'); throw error }
}
async function reserve(owner, field, amount, maximum) {
  const day = new Date().toISOString().slice(0, 10)
  try { await OrderBudget.updateOne({ owner, day }, { $setOnInsert: { expiresAt: new Date(Date.now() + 3 * DAY) } }, { upsert: true }) } catch (error) { if (error.code !== 11000) throw error }
  const result = await OrderBudget.updateOne({ owner, day, [field]: { $lte: maximum - amount } }, { $inc: { [field]: amount } })
  if (!result.modifiedCount) throw new AppError('Daily email-analysis allowance reached. Resume tomorrow.', 429, 'ORDER_DAILY_BUDGET')
}
async function modelBudget(userId, messages, extraction) {
  // Conservative UTF-8 input bytes + output reservation, not claimed provider-billed token counts.
  const units = Buffer.byteLength(JSON.stringify(messages)) + (extraction ? 5000 : 4000)
  await reserve('global', 'modelUnits', units, orderPolicy.globalModelUnits)
  await reserve('user:' + userId, 'modelUnits', units, orderPolicy.userModelUnits)
}
export async function processOrderScan(scanId) {
  const leaseId = randomUUID(), controller = new AbortController()
  const scan = await OrderScan.findOneAndUpdate({ _id: scanId, $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] }, { $set: { status: 'RUNNING', leaseId, leaseUntil: new Date(Date.now() + LEASE) } }, { returnDocument: 'after' }).select('+cursor +runId +leaseId')
  if (!scan) return
  let finish
  const done = new Promise(resolve => { finish = resolve })
  registerOrderWork(scan.id, { userId: scan.userId, provider: scan.provider, controller, done })
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
  const owned = { _id: scan.id, userId: scan.userId, runId: scan.runId, leaseId, status: 'RUNNING' }
  async function guard() {
    signal.throwIfAborted()
    await requireOrderConsent(scan.userId)
    if (!await OrderScan.exists(owned) || !await connectionModel(scan.provider).exists({ _id: scan.connectionId, userId: scan.userId, status: { $in: ['CONNECTED', 'SYNCING'] } })) throw new AppError('Scan stopped or mailbox disconnected.', 409, 'ORDER_SCAN_STOPPED')
    await OrderScan.updateOne(owned, { $set: { leaseUntil: new Date(Date.now() + LEASE) } })
  }
  try {
    await guard()
    if (!orderProviderConfigured()) throw new AppError('Inception is not configured.', 503, 'ORDER_AI_NOT_CONFIGURED')
    await reserve('user:' + scan.userId, 'metadata', Math.min(25, scan.limit - scan.processed), orderPolicy.dailyMetadataLimit)
    const page = await fetchOrderPage(scan, signal)
    const candidates = []
    let stored = 0, reviewed = 0, skipped = 0
    for (const message of page.messages) {
      if (typeof message.providerId !== 'string') continue
      const date = new Date(message.occurredAt)
      if (message.deleted || Number.isNaN(date.getTime()) || date < scan.since || date > scan.until) { skipped++; continue }
      const scope = { userId: scan.userId, provider: scan.provider, connectionId: scan.connectionId, messageIdHash: hashOrderValue(scan.userId, scan.provider, scan.connectionId, message.providerId) }
      const input = sanitizeMetadata({ ...message, occurredAt: date.toISOString() })
      if (scan.filterDomain && input?.senderDomain !== scan.filterDomain && !input?.senderDomain.endsWith('.' + scan.filterDomain)) { skipped++; continue }
      const fingerprint = hashOrderValue(scan.userId, scan.provider, scan.connectionId, JSON.stringify(input))
      // A receipt buffered in Redis has not reached Mongo yet; it still dedupes.
      if (findPendingReceipt(scope, fingerprint, ORDER_POLICY_VERSION)) { skipped++; continue }
      if (await OrderReceipt.exists({ ...scope, fingerprint, policyVersion: ORDER_POLICY_VERSION, expiresAt: { $gt: new Date() } })) { skipped++; continue }
      candidates.push({ scope, input, fingerprint })
    }
    // Receipts are accumulated with events and flushed once per provider page.
    const writes = createOrderWriteBatch()
    const receipt = (item, outcome) => writes.receipt(item.scope, outcome, { fingerprint: item.fingerprint, policyVersion: ORDER_POLICY_VERSION, expiresAt: new Date(Date.now() + 90 * DAY) })
    for (let offset = 0; offset < candidates.length; offset += 5) {
      await guard()
      const slice = candidates.slice(offset, offset + 5)
      for (const item of slice.filter(item => !item.input)) { receipt(item, 'skipped'); skipped++ }
      const batch = slice.filter(item => item.input)
      if (!batch.length) continue
      await modelBudget(scan.userId, batch.map(item => item.input), false)
      await guard()
      const classifications = await classifyBatch(batch.map(item => item.input), signal)
      const orders = []
      for (const [index, classification] of classifications.entries()) {
        const item = batch[index]
        if (classification === 'order') orders.push(item)
        else { receipt(item, classification); classification === 'review' ? reviewed++ : skipped++ }
      }
      if (!orders.length) continue
      await modelBudget(scan.userId, orders.map(item => item.input), true)
      await guard()
      const cards = await extractCards(orders.map(item => item.input), signal)
      for (const [index, card] of cards.entries()) {
        const item = orders[index]
        if (!card) { receipt(item, 'review'); reviewed++; continue }
        writes.event(item.scope, { ...card, fingerprint: item.fingerprint, occurredAt: new Date(item.input.occurredAt), policyVersion: ORDER_POLICY_VERSION })
        receipt(item, 'order'); stored++
      }
    }
    await guard()
    // Flush events before receipts and before advancing counters: a failed
    // write leaves the page uncounted and no message marked deduplicated.
    await writes.flush()
    const processed = scan.processed + page.messages.length
    const status = page.cursor ? processed >= scan.limit ? 'PAUSED' : 'QUEUED' : 'COMPLETED'
    await OrderScan.updateOne(owned, { $set: { status, cursor: page.cursor, leaseId: null, leaseUntil: null, lastErrorCode: status === 'PAUSED' ? 'ORDER_RUN_LIMIT' : null, ...(status === 'COMPLETED' && !scan.filterDomain ? { checkpointAt: scan.until } : {}) }, $inc: { processed: page.messages.length, examined: candidates.length, stored, reviewed, skipped } })
  } catch (error) {
    const code = typeof error.code === 'string' && /^ORDER_[A-Z_]+$/.test(error.code) ? error.code : 'ORDER_SCAN_FAILED'
    await OrderScan.updateOne(owned, { $set: { status: code === 'ORDER_DAILY_BUDGET' ? 'PAUSED' : 'FAILED', leaseId: null, leaseUntil: null, lastErrorCode: code } })
    logEvent('warn', 'order_scan_paused', { errorCode: code })
  } finally { finish(); releaseOrderWork(scan.id) }
}
export async function enqueueDaily() {
  const preferences = await OrderPreference.find({ enabled: true, daily: true, version: 1, nextDailyAt: { $lte: new Date() } }).sort({ nextDailyAt: 1 }).limit(10)
  for (const preference of preferences) {
    const claim = await OrderPreference.updateOne({ _id: preference.id, nextDailyAt: preference.nextDailyAt, enabled: true, daily: true }, { $set: { nextDailyAt: new Date(Date.now() + DAY) } })
    if (!claim.modifiedCount) continue
    for (const provider of ['gmail', 'outlook']) {
      try { await startOrderScan(preference.userId, provider, 'daily') }
      catch (error) { if (!['ORDER_NOT_CONNECTED','ORDER_SCAN_BUSY','ORDER_DAILY_DISABLED','ORDER_CONSENT_REQUIRED'].includes(error.code)) logEvent('warn', 'order_daily_enqueue_failed', { errorCode: 'ORDER_SCHEDULE_FAILED' }) }
    }
  }
}
export function startOrderWorker() {
  let stopping = false, running = false, current = Promise.resolve()
  // Scan scheduling stays in Mongo; Redis only buffers derived-metadata writes.
  async function tick() {
    if (stopping || running) return
    running = true
    current = (async () => {
      if (!orderProviderConfigured()) return
      await enqueueDaily()
      const scan = await OrderScan.findOne({ $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] }).sort({ updatedAt: 1 }).select('_id')
      if (scan) await processOrderScan(scan.id)
    })().catch(() => logEvent('warn', 'order_worker_failed', { errorCode: 'ORDER_WORKER_FAILED' }))
    await current
    running = false
  }
  const timer = setInterval(tick, 3000); timer.unref(); void tick()
  return async () => { stopping = true; clearInterval(timer); await current }
}
