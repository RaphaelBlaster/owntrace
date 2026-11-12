import { randomUUID } from 'node:crypto'
import { MailInsight, MailAnalysis, mailCategories, MAIL_ENRICHMENT_VERSION } from '../models/mail-insight.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'
import { fetchOrderPage, hashOrderValue } from './order-mail.service.js'
import { canReadMailBody, fetchMailBody } from './mail-body.service.js'
import { intelligenceConfigured, sanitizeMailMetadata, sanitizeMailBody, gateMessages, categorizeMessages } from './mail-intelligence.service.js'
import { logEvent } from '../utils/logger.js'
import { ensureGmailPush } from './google-push.service.js'
import { ensureMicrosoftPush } from './microsoft-push.service.js'
import { analysisMessageLimit, groupMailInsights, paginateInsights, visibleMailScope } from './mail-insight-query.service.js'

export { analysisMessageLimit }

const models = { gmail: GoogleConnection, outlook: MicrosoftConnection }
const active = new Map()
const stateWrites = new Map()
async function withStateLock(userId, work) {
  const key = String(userId), previous = stateWrites.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  stateWrites.set(key, current)
  await previous
  try { return await work() }
  finally { release(); if (stateWrites.get(key) === current) stateWrites.delete(key) }
}
// Statuses a Top K scan may read from. ERROR is usually left behind by an old
// metadata scan failure while the token is still valid (an invalid token moves
// the connection to NEEDS_RECONNECT), so it must not block body analysis. A
// failed Google revocation also lands in ERROR and is never scanned.
const SCANNABLE_STATUSES = ['CONNECTED', 'SYNCING', 'ERROR']
const UNSCANNABLE_ERROR_CODES = ['GOOGLE_REVOCATION_FAILED']
function topKBodyAccess(provider, connection) {
  if (connection?.status !== 'ERROR') return canReadMailBody(provider, connection)
  if (UNSCANNABLE_ERROR_CODES.includes(connection.lastErrorCode)) return false
  return canReadMailBody(provider, { status: 'CONNECTED', scopes: connection.scopes })
}
// The provider just accepted this connection's token, so a stale ERROR status
// no longer describes it. Body reads require CONNECTED/SYNCING, so this runs as
// soon as a metadata page loads rather than only at the end of the run.
async function clearStaleConnectionError(provider, connectionId, userId) {
  await models[provider].updateOne({ _id: connectionId, userId, status: 'ERROR', lastErrorCode: { $nin: UNSCANNABLE_ERROR_CODES } }, { $set: { status: 'CONNECTED', lastErrorCode: null } })
}
// One undeliverable or oversized message must not fail the whole page: it is
// analysed from metadata only. Aborts and scope/permission errors still stop the run.
// MAIL_BODY_REQUEST_FAILED also covers provider outages, rate limits and expired
// tokens, so several failures in a row fail the page (it resumes from its
// checkpoint) instead of storing a whole page of metadata-only results.
const MAX_CONSECUTIVE_BODY_FAILURES = 3
async function readMailBodyOrEmpty(scope, signal, failures) {
  try {
    const body = await fetchMailBody(scope, signal)
    failures.consecutive = 0
    return body
  } catch (error) {
    if (signal.aborted || !(error instanceof AppError) || error.code !== 'MAIL_BODY_REQUEST_FAILED') throw error
    failures.consecutive += 1
    if (failures.consecutive >= MAX_CONSECUTIVE_BODY_FAILURES) throw error
    logEvent('warn', 'mail_body_skipped', { provider: scope.provider, errorCode: error.code })
    return ''
  }
}
const excluded = new Set(['marketing', 'spam', 'personal', 'other'])
const labels = { jobs: 'Jobs', orders: 'Orders', subscriptions: 'Subscriptions', security: 'Security', finance: 'Finance', travel: 'Travel', social: 'Social', marketing: 'Marketing', spam: 'Suspected spam', personal: 'Personal', other: 'Needs review' }
export function rankCategories(rows, k = 3, now = new Date()) {
  const categories = mailCategories.map(category => {
    const items = rows.filter(row => row.category === category).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    const weights = items.map(row => {
      const ageDays = Math.max(0, (now - new Date(row.occurredAt)) / 86400000)
      return ((row.importance || 1) + (row.actionRequired ? 3 : 0)) / (1 + ageDays / 7)
    }).sort((a, b) => b - a)
    // Bounded contribution stops bulk newsletters from overwhelming a single interview.
    const score = excluded.has(category) ? 0 : Number(weights.slice(0, 5).reduce((sum, weight, i) => sum + weight / (i + 1), 0).toFixed(3))
    return { category, label: labels[category], count: items.length, score, items }
  }).sort((a, b) => b.score - a.score || a.category.localeCompare(b.category))
  return { categories, topCategories: categories.filter(x => x.count && !excluded.has(x.category)).slice(0, k).map(x => x.category) }
}

export async function topKState(userId, k) {
  const analysis = await MailAnalysis.findOne({ userId }).lean()
  const limit = analysisMessageLimit()
  const connections = await Promise.all(Object.entries(models).map(async ([provider, Model]) => {
    const connection = await Model.findOne({ userId })
    return { provider, connected: !!connection && SCANNABLE_STATUSES.includes(connection.status) && !(connection.status === 'ERROR' && UNSCANNABLE_ERROR_CODES.includes(connection.lastErrorCode)), bodyAccess: !!connection && topKBodyAccess(provider, connection), oauthUrl: `/api/${provider === 'gmail' ? 'google' : 'microsoft'}/oauth/start?access=body` }
  }))
  const rows = analysis?.runId ? await MailInsight.find(visibleMailScope(userId, analysis)).sort({ occurredAt: -1 }).limit(limit).lean() : []
  const items = rows.map(row => Object.fromEntries(['category','title','status','summary','occurredAt','actionRequired','importance','evidence','senderDomain','analyzedBy','companyName','companyDomain','roleName','applicationReference','referenceType','eventKind','enrichmentVersion','threadHash'].map(key => [key, row[key]]).concat([['id', String(row._id)]])))
  const ranked = rankCategories(items, k)
  ranked.categories = ranked.categories.map(category => {
    const grouped = paginateInsights(groupMailInsights(category.items), { limit: 6 })
    return { ...category, items: grouped.insights, pagination: grouped.pagination, counts: grouped.counts }
  })
  const enriching = ['QUEUED', 'RUNNING'].includes(analysis?.enrichmentStatus)
  return { ...ranked, connections, analysis: { observedAt: analysis?.updatedAt, enabled: Boolean(analysis?.enabled), version: 1, status: enriching ? analysis.enrichmentStatus : analysis?.status || 'IDLE', phase: enriching ? 'enrichment' : 'scan', enrichmentStatus: analysis?.enrichmentStatus || 'IDLE', enrichmentProcessed: analysis?.enrichmentProcessed || 0, provider: analysis?.provider, processed: analysis?.processed || 0, limit, lastErrorCode: analysis?.lastErrorCode || analysis?.enrichmentErrorCode || null }, configured: intelligenceConfigured() }
}

export async function stopTopK(userId, provider, { disable = false } = {}) {
  const filter = { userId, ...(provider ? { provider } : {}) }
  const entry = active.get(String(userId))
  const matches = entry && (!provider || entry.provider === provider)
  if (matches) entry.controller.abort()
  await withStateLock(userId, async () => {
    await MailAnalysis.updateMany(filter, { $set: { pushPending: false, ...(disable ? { enabled: false, acceptedAt: null } : {}) } })
    await MailAnalysis.updateMany({ ...filter, enrichmentStatus: { $in: ['QUEUED', 'RUNNING'] } }, { $set: { enrichmentStatus: 'CANCELLED', enrichmentLeaseId: null, enrichmentLeaseUntil: null } })
    await MailAnalysis.updateMany({ ...filter, status: { $in: ['QUEUED', 'RUNNING', 'FAILED'] } }, { $set: { status: 'CANCELLED', leaseId: null, leaseUntil: null } })
  })
  if (matches) await entry.done
}
export async function removeTopKSource(userId, provider, connectionId) {
  await stopTopK(userId, provider, { disable: !provider })
  await MailInsight.deleteMany({ userId, ...(provider ? { provider } : {}), ...(connectionId ? { connectionId } : {}) })
  if (!provider) await MailAnalysis.deleteMany({ userId })
}
export async function startTopKScan(userId, provider, { push = false, followUp = false, signal } = {}) {
  signal?.throwIfAborted()
  if (!Object.hasOwn(models, provider)) throw new AppError('Choose Gmail or Outlook.', 400, 'MAIL_INVALID_INPUT')
  const settings = await MailAnalysis.findOne({ userId }).select('+cursor')
  if (!settings?.enabled || settings.version !== 1 || !settings.acceptedAt) throw new AppError('Enable email analysis on Top K first.', 403, 'MAIL_CONSENT_REQUIRED')
  if (!intelligenceConfigured()) throw new AppError('Jev and Mercury must both be configured.', 503, 'MAIL_AI_NOT_CONFIGURED')
  const connection = await models[provider].findOne({ userId, status: { $in: SCANNABLE_STATUSES } })
  if (!connection || !topKBodyAccess(provider, connection)) throw new AppError('Grant read-only body access for this mailbox on Top K.', 409, 'MAIL_BODY_PERMISSION_REQUIRED')
  if (['QUEUED', 'RUNNING'].includes(settings.status) || ['QUEUED', 'RUNNING'].includes(settings.enrichmentStatus)) {
    if (push && settings.provider === provider) { await MailAnalysis.updateOne({ _id: settings.id, enabled: true, $or: [{ status: { $in: ['QUEUED', 'RUNNING'] } }, { enrichmentStatus: { $in: ['QUEUED', 'RUNNING'] } }] }, { $set: { pushPending: true } }); return }
    throw new AppError('An email analysis is already running.', 409, 'MAIL_SCAN_BUSY')
  }
  if (push && !followUp && settings.updatedAt > new Date(Date.now() - 30000)) {
    // Debounced, not dropped: park the push so the replay loop runs it later.
    // timestamps:false keeps parking from extending the debounce window.
    await MailAnalysis.updateOne({ _id: settings.id, enabled: true }, { $set: { pushPending: true } }, { timestamps: false })
    return
  }
  const limit = analysisMessageLimit()
  const resume = settings.status === 'FAILED' && settings.provider === provider && String(settings.connectionId) === connection.id && settings.cursor && settings.processed < limit
  const previousRunId = settings.provider === provider && String(settings.connectionId) === connection.id ? (settings.status === 'COMPLETED' ? settings.runId : settings.previousRunId) : null
  const result = await withStateLock(userId, () => {
    signal?.throwIfAborted()
    return MailAnalysis.findOneAndUpdate({ _id: settings.id, enabled: true, status: settings.status, updatedAt: settings.updatedAt, enrichmentStatus: { $nin: ['QUEUED', 'RUNNING'] } }, { $set: { provider, connectionId: connection.id, runId: resume ? settings.runId : randomUUID(), previousRunId, cursor: resume ? settings.cursor : null, processed: resume ? settings.processed : 0, limit, until: resume ? settings.until : new Date(), status: 'QUEUED', leaseId: null, leaseUntil: null, lastErrorCode: null, pushPending: false } }, { returnDocument: 'after' })
  })
  if (!result) throw new AppError('Scan state changed. Refresh and retry.', 409, 'MAIL_SCAN_BUSY')
  if (!push) {
    // The scan is already durably queued; the provider watch call can take
    // seconds, so it runs after the request returns. The mail sync worker's
    // renewal sweep retries a watch that failed here.
    Promise.resolve().then(() => (provider === 'gmail' ? ensureGmailPush : ensureMicrosoftPush)(userId))
      .catch(() => logEvent('warn', 'top_k_watch_setup_failed', { provider, errorCode: 'MAIL_PUSH_SETUP_FAILED' }))
  }
  return result
}

// Lease held by a running page. It is renewed while the page runs so a slow
// page is never claimed by a second worker process, and a renewal that no
// longer matches (stopped, cancelled or taken over) aborts the page.
// timestamps:false because updatedAt drives scan order, debounce and optimistic checks.
const LEASE_MS = 240000
const LEASE_RENEW_MS = 60000
function holdLease(filter, field, controller) {
  let released = false
  const timer = setInterval(async () => {
    try {
      const renewed = await MailAnalysis.updateOne(filter, { $set: { [field]: new Date(Date.now() + LEASE_MS) } }, { timestamps: false })
      if (!released && !renewed.matchedCount) controller.abort()
    } catch { /* the lease still has minutes left; the next renewal retries */ }
  }, LEASE_RENEW_MS)
  timer.unref?.()
  return () => { released = true; clearInterval(timer) }
}
// Stored insight fields a page needs to decide whether a card can be reused.
const PREVIOUS_FIELDS = 'messageHash fingerprint analyzedBy category title evidence enrichmentVersion'

// Hashes each listed message once and drops deleted or repeated messages.
function dedupeMessages(scan, messages) {
  const seen = new Set(), result = []
  for (const message of messages) {
    if (message.deleted || !message.providerId) continue
    const messageHash = hashOrderValue(scan.userId, scan.provider, scan.connectionId, message.providerId)
    if (seen.has(messageHash)) continue
    seen.add(messageHash)
    result.push({ message, messageHash })
  }
  return result
}

export async function processTopKPage(id) {
  const leaseId = randomUUID()
  const scan = await MailAnalysis.findOneAndUpdate({ _id: id, enabled: true, $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] }, { $set: { status: 'RUNNING', leaseId, leaseUntil: new Date(Date.now() + LEASE_MS) } }, { returnDocument: 'after' }).select('+cursor +leaseId')
  if (!scan) return
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
  let finish
  const done = new Promise(resolve => { finish = resolve })
  active.set(String(scan.userId), { controller, done, provider: scan.provider })
  const owned = { _id: scan.id, runId: scan.runId, leaseId, status: 'RUNNING', enabled: true }
  const releaseLease = holdLease(owned, 'leaseUntil', controller)
  async function guard() {
    signal.throwIfAborted()
    const connection = await models[scan.provider].findOne({ _id: scan.connectionId, userId: scan.userId, status: { $in: SCANNABLE_STATUSES } })
    if (!connection || !topKBodyAccess(scan.provider, connection) || !await User.exists({ _id: scan.userId }) || !await MailAnalysis.exists(owned)) throw new AppError('Email analysis stopped.', 409, 'MAIL_SCAN_STOPPED')
  }
  let stage = 'metadata'
  const limit = analysisMessageLimit()
  try {
    await guard()
    const reachedLimit = scan.processed >= limit
    const page = reachedLimit ? { cursor: null, messages: [] } : await fetchOrderPage({ ...scan.toObject(), limit, since: new Date(0) }, signal)
    // Only a page the provider actually served proves the token still works.
    if (!reachedLimit) await clearStaleConnectionError(scan.provider, scan.connectionId, scan.userId)
    // One write per message (keyed by messageHash), so the page is stored with
    // one unordered bulkWrite and a message the provider repeats in a page can
    // never produce two racing upserts on the same unique key.
    const writeMap = new Map(), bodyFailures = { consecutive: 0 }
    const writes = { push: op => writeMap.set(op.updateOne.filter.messageHash, op) }
    const pageMessages = dedupeMessages(scan, page.messages)
    // One read for the whole page instead of a findOne per message.
    const stored = pageMessages.length ? await MailInsight.find({ userId: scan.userId, provider: scan.provider, connectionId: scan.connectionId, messageHash: { $in: pageMessages.map(x => x.messageHash) } }).select(PREVIOUS_FIELDS).lean() : []
    const previousByHash = new Map(stored.map(row => [row.messageHash, row]))
    for (let offset = 0; offset < pageMessages.length; offset += 5) {
      await guard()
      const entries = []
      for (const { message, messageHash } of pageMessages.slice(offset, offset + 5)) {
        const input = sanitizeMailMetadata(message)
        const fingerprint = hashOrderValue(scan.userId, scan.provider, scan.connectionId, JSON.stringify(input))
        const filter = { userId: scan.userId, provider: scan.provider, connectionId: scan.connectionId, messageHash }
        const previous = previousByHash.get(messageHash)
        const invalidFallback = previous?.analyzedBy === 'mercury' && previous.category === 'other' && previous.title === 'Needs review' && !previous.evidence
        if (previous && previous.fingerprint === fingerprint && !invalidFallback && (previous.category !== 'jobs' || previous.enrichmentVersion >= MAIL_ENRICHMENT_VERSION)) { writes.push({ updateOne: { filter, update: { $set: { runId: scan.runId } } } }); continue }
        if (input) entries.push({ message, input, filter, fingerprint, previous, threadHash: message.threadId ? hashOrderValue(scan.userId, scan.provider, scan.connectionId, message.threadId) : null })
      }
      if (!entries.length) continue
      stage = 'jev'
      const gates = await gateMessages(entries.map(x => x.input), signal)
      const eligible = []
      entries.forEach((entry, i) => {
        if (['eligible', 'review'].includes(gates[i])) eligible.push(entry)
        else writes.push({ updateOne: { filter: entry.filter, update: { $set: { ...entry.input, subject: undefined, title: gates[i] === 'personal' ? 'Private correspondence' : entry.input.subject.slice(0, 120), summary: gates[i] === 'personal' ? 'Excluded from body analysis.' : entry.input.subject.slice(0, 300), category: gates[i], status: 'filtered', importance: 1, actionRequired: false, evidence: '', analyzedBy: 'jev', fingerprint: entry.fingerprint, runId: scan.runId } }, upsert: true } })
      })
      if (eligible.length) {
        const inputs = []
        for (const entry of eligible) {
          await guard()
          stage = 'body'
          const body = sanitizeMailBody(await readMailBodyOrEmpty({ userId: scan.userId, provider: scan.provider, connectionId: String(scan.connectionId), providerId: entry.message.providerId }, signal, bodyFailures))
          inputs.push({ ...entry.input, body })
        }
        await guard()
        stage = 'mercury'
        const cards = await categorizeMessages(inputs, signal)
        for (let i = 0; i < eligible.length; i++) {
          const entry = eligible[i]
          if (!cards[i] && entry.previous?.evidence) {
            writes.push({ updateOne: { filter: entry.filter, update: { $set: { runId: scan.runId } } } })
            continue
          }
          const card = cards[i] || { category: 'other', title: 'Needs review', status: 'unknown', summary: 'Insufficient evidence for a supported category.', evidence: '', actionRequired: false, importance: 1 }
          writes.push({ updateOne: { filter: entry.filter, update: { $set: { ...card, threadHash: entry.threadHash, senderDomain: entry.input.senderDomain, occurredAt: entry.input.occurredAt, fingerprint: entry.fingerprint, runId: scan.runId, analyzedBy: 'mercury', enrichmentVersion: cards[i] ? MAIL_ENRICHMENT_VERSION : 0 } }, upsert: true } })
        }
      }
    }
    stage = 'storage'
    const processed = scan.processed + page.messages.length
    const completed = processed >= limit || !page.cursor
    await withStateLock(scan.userId, async () => {
      await guard()
      signal.throwIfAborted()
      // Unordered: every op targets a distinct document. A partial failure
      // throws before the cursor advances, and the idempotent upserts replay.
      if (writeMap.size) await MailInsight.bulkWrite([...writeMap.values()], { ordered: false })
      await guard()
      releaseLease()
      await MailAnalysis.updateOne(owned, { $set: { processed, cursor: completed ? null : page.cursor, status: completed ? 'COMPLETED' : 'QUEUED', leaseId: null, leaseUntil: null, lastErrorCode: null } })
    })
    if (completed) {
      const pending = await MailAnalysis.findOneAndUpdate({ _id: scan.id, status: 'COMPLETED', pushPending: true }, { $set: { pushPending: false } })
      if (pending) await startTopKScan(scan.userId, scan.provider, { push: true, followUp: true, signal })
    }
  } catch (error) {
    releaseLease()
    await MailAnalysis.updateOne(owned, { $set: { status: signal.aborted ? 'CANCELLED' : 'FAILED', leaseId: null, leaseUntil: null, lastErrorCode: error.code && typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' } })
    logEvent('warn', 'mail_analysis_failed', { stage, responseStage: error.details?.stage, errorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' })
  } finally { releaseLease(); active.delete(String(scan.userId)); finish() }
}

export async function queueMailEnrichment(userId) {
  const settings = await MailAnalysis.findOne({ userId })
  if (!settings?.enabled || !settings.acceptedAt || settings.version !== 1 || settings.status !== 'COMPLETED') throw new AppError('Complete the current email scan before updating application details.', 409, 'MAIL_SCAN_BUSY')
  const connection = await models[settings.provider].findOne({ _id: settings.connectionId, userId })
  if (!topKBodyAccess(settings.provider, connection)) throw new AppError('Read-only body access is required.', 409, 'MAIL_BODY_PERMISSION_REQUIRED')
  if (['QUEUED', 'RUNNING'].includes(settings.enrichmentStatus)) throw new AppError('Application details are already being updated.', 409, 'MAIL_SCAN_BUSY')
  const resume = settings.enrichmentStatus === 'FAILED'
  const result = await withStateLock(userId, () => MailAnalysis.updateOne({ _id: settings.id, enabled: true, status: 'COMPLETED', runId: settings.runId, updatedAt: settings.updatedAt, enrichmentStatus: { $nin: ['QUEUED', 'RUNNING'] } }, { $set: { enrichmentStatus: 'QUEUED', enrichmentErrorCode: null, enrichmentLeaseId: null, enrichmentLeaseUntil: null, ...(!resume ? { enrichmentProcessed: 0, enrichmentCursor: null } : {}) } }))
  if (!result.matchedCount) throw new AppError('Scan state changed. Refresh and retry.', 409, 'MAIL_SCAN_BUSY')
}

export async function processMailEnrichmentPage(id) {
  const leaseId = randomUUID()
  const scan = await MailAnalysis.findOneAndUpdate({ _id: id, enabled: true, status: 'COMPLETED', $or: [{ enrichmentStatus: 'QUEUED' }, { enrichmentStatus: 'RUNNING', enrichmentLeaseUntil: { $lt: new Date() } }] }, { $set: { enrichmentStatus: 'RUNNING', enrichmentLeaseId: leaseId, enrichmentLeaseUntil: new Date(Date.now() + LEASE_MS) } }, { returnDocument: 'after' }).select('+enrichmentCursor')
  if (!scan) return
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
  let finish
  const done = new Promise(resolve => { finish = resolve })
  active.set(String(scan.userId), { controller, done, provider: scan.provider })
  const owned = { _id: scan.id, runId: scan.runId, enabled: true, enrichmentStatus: 'RUNNING', enrichmentLeaseId: leaseId }
  const releaseLease = holdLease(owned, 'enrichmentLeaseUntil', controller)
  async function guard() {
    signal.throwIfAborted()
    const connection = await models[scan.provider].findOne({ _id: scan.connectionId, userId: scan.userId, status: { $in: SCANNABLE_STATUSES } })
    if (!topKBodyAccess(scan.provider, connection) || !await MailAnalysis.exists(owned) || !await User.exists({ _id: scan.userId })) throw new AppError('Application enrichment stopped.', 409, 'MAIL_SCAN_STOPPED')
  }
  const limit = analysisMessageLimit()
  try {
    await guard()
    const reachedLimit = scan.enrichmentProcessed >= limit
    const page = reachedLimit ? { cursor: null, messages: [] } : await fetchOrderPage({ ...scan.toObject(), since: new Date(0), limit, processed: scan.enrichmentProcessed, cursor: scan.enrichmentCursor }, signal)
    if (!reachedLimit) await clearStaleConnectionError(scan.provider, scan.connectionId, scan.userId)
    const entries = [], bodyFailures = { consecutive: 0 }
    const pageMessages = dedupeMessages(scan, page.messages)
    // One read for the whole page instead of a findOne per message.
    const candidates = pageMessages.length ? await MailInsight.find({ userId: scan.userId, runId: scan.runId, connectionId: scan.connectionId, messageHash: { $in: pageMessages.map(x => x.messageHash) }, $or: [
      { category: 'jobs', $or: [{ enrichmentVersion: { $lt: MAIL_ENRICHMENT_VERSION } }, { enrichmentVersion: { $exists: false } }] },
      { category: 'other', title: 'Needs review', evidence: { $in: ['', null] }, analyzedBy: 'mercury' },
    ] }).select('_id messageHash').lean() : []
    const rowByHash = new Map(candidates.map(row => [row.messageHash, row]))
    for (const { message, messageHash } of pageMessages) {
      const row = rowByHash.get(messageHash)
      const input = row && sanitizeMailMetadata(message)
      if (input) entries.push({ message, row, input })
    }
    const writes = []
    for (let offset = 0; offset < entries.length; offset += 5) {
      const batch = entries.slice(offset, offset + 5), inputs = []
      for (const entry of batch) {
        await guard()
        inputs.push({ ...entry.input, body: sanitizeMailBody(await readMailBodyOrEmpty({ userId: scan.userId, provider: scan.provider, connectionId: String(scan.connectionId), providerId: entry.message.providerId }, signal, bodyFailures)) })
      }
      await guard()
      const cards = await categorizeMessages(inputs, signal)
      // An invalid response must not erase evidence or falsely mark a legacy card enriched.
      batch.forEach((entry, i) => { if (cards[i]) writes.push({ updateOne: { filter: { _id: entry.row._id, userId: scan.userId, runId: scan.runId }, update: { $set: { ...cards[i], threadHash: entry.message.threadId ? hashOrderValue(scan.userId, scan.provider, scan.connectionId, entry.message.threadId) : null, enrichmentVersion: MAIL_ENRICHMENT_VERSION } } } }) })
    }
    const processed = scan.enrichmentProcessed + page.messages.length
    const completed = processed >= limit || !page.cursor
    await withStateLock(scan.userId, async () => {
      await guard(); signal.throwIfAborted()
      // Unordered: each op targets a distinct _id (messages are deduplicated).
      if (writes.length) await MailInsight.bulkWrite(writes, { ordered: false })
      await guard()
      releaseLease()
      await MailAnalysis.updateOne(owned, { $set: { enrichmentProcessed: processed, enrichmentCursor: completed ? null : page.cursor, enrichmentStatus: completed ? 'COMPLETED' : 'QUEUED', enrichmentLeaseId: null, enrichmentLeaseUntil: null, enrichmentErrorCode: null } })
    })
    if (completed) {
      const pending = await MailAnalysis.findOneAndUpdate({ _id: scan.id, enabled: true, status: 'COMPLETED', enrichmentStatus: 'COMPLETED', pushPending: true }, { $set: { pushPending: false } })
      if (pending) await startTopKScan(scan.userId, scan.provider, { push: true, followUp: true, signal })
    }
  } catch (error) {
    releaseLease()
    await MailAnalysis.updateOne(owned, { $set: { enrichmentStatus: signal.aborted ? 'CANCELLED' : 'FAILED', enrichmentLeaseId: null, enrichmentLeaseUntil: null, enrichmentErrorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' } })
    logEvent('warn', 'mail_enrichment_failed', { errorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' })
  } finally { releaseLease(); active.delete(String(scan.userId)); finish() }
}

export function startTopKWorker() {
  let stopped = false, running = false, current = Promise.resolve()
  async function tick() {
    if (stopped || running || !intelligenceConfigured()) return
    running = true
    current = (async () => {
      // Oldest updatedAt first: each page completion bumps updatedAt, so a long
      // scan takes turns with other mailboxes instead of starving them.
      const scan = await MailAnalysis.findOne({ enabled: true, $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] }).sort({ updatedAt: 1 }).select('_id')
      if (scan) await processTopKPage(scan.id)
      else {
        const enrichment = await MailAnalysis.findOne({ enabled: true, status: 'COMPLETED', $or: [{ enrichmentStatus: 'QUEUED' }, { enrichmentStatus: 'RUNNING', enrichmentLeaseUntil: { $lt: new Date() } }] }).sort({ updatedAt: 1 }).select('_id')
        if (enrichment) await processMailEnrichmentPage(enrichment.id)
      }
    })().catch(() => logEvent('warn', 'top_k_worker_failed', { errorCode: 'MAIL_ANALYSIS_FAILED' }))
    await current; running = false
  }
  const timer = setInterval(tick, 3000); timer.unref()
  return async () => { stopped = true; clearInterval(timer); for (const entry of active.values()) entry.controller.abort(); await current }
}
