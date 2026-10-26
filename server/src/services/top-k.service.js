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
import { groupMailInsights, paginateInsights } from './mail-insight-query.service.js'

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
  const connections = await Promise.all(Object.entries(models).map(async ([provider, Model]) => {
    const connection = await Model.findOne({ userId })
    return { provider, connected: !!connection && ['CONNECTED', 'SYNCING'].includes(connection.status), bodyAccess: !!connection && canReadMailBody(provider, connection), oauthUrl: `/api/${provider === 'gmail' ? 'google' : 'microsoft'}/oauth/start?access=body` }
  }))
  const rows = analysis?.runId ? await MailInsight.find({ userId, runId: analysis.runId }).sort({ occurredAt: -1 }).limit(250).lean() : []
  const items = rows.map(row => Object.fromEntries(['category','title','status','summary','occurredAt','actionRequired','importance','evidence','senderDomain','analyzedBy','companyName','companyDomain','roleName','applicationReference','referenceType','eventKind','enrichmentVersion','threadHash'].map(key => [key, row[key]]).concat([['id', String(row._id)]])))
  const ranked = rankCategories(items, k)
  ranked.categories = ranked.categories.map(category => {
    const grouped = paginateInsights(groupMailInsights(category.items), { limit: 6 })
    return { ...category, items: grouped.insights, pagination: grouped.pagination, counts: grouped.counts }
  })
  const enriching = ['QUEUED', 'RUNNING'].includes(analysis?.enrichmentStatus)
  return { ...ranked, connections, analysis: { enabled: Boolean(analysis?.enabled), version: 1, status: enriching ? analysis.enrichmentStatus : analysis?.status || 'IDLE', phase: enriching ? 'enrichment' : 'scan', enrichmentStatus: analysis?.enrichmentStatus || 'IDLE', enrichmentProcessed: analysis?.enrichmentProcessed || 0, provider: analysis?.provider, processed: analysis?.processed || 0, limit: 250, lastErrorCode: analysis?.lastErrorCode || analysis?.enrichmentErrorCode || null }, configured: intelligenceConfigured() }
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
  if (!models[provider]) throw new AppError('Choose Gmail or Outlook.', 400, 'MAIL_INVALID_INPUT')
  const settings = await MailAnalysis.findOne({ userId }).select('+cursor')
  if (!settings?.enabled || settings.version !== 1 || !settings.acceptedAt) throw new AppError('Enable email analysis on Top K first.', 403, 'MAIL_CONSENT_REQUIRED')
  if (!intelligenceConfigured()) throw new AppError('Jev and Mercury must both be configured.', 503, 'MAIL_AI_NOT_CONFIGURED')
  const connection = await models[provider].findOne({ userId, status: { $in: ['CONNECTED', 'SYNCING'] } })
  if (!connection || !canReadMailBody(provider, connection)) throw new AppError('Grant read-only body access for this mailbox on Top K.', 409, 'MAIL_BODY_PERMISSION_REQUIRED')
  if (['QUEUED', 'RUNNING'].includes(settings.status) || ['QUEUED', 'RUNNING'].includes(settings.enrichmentStatus)) {
    if (push && settings.provider === provider) { await MailAnalysis.updateOne({ _id: settings.id, enabled: true, $or: [{ status: { $in: ['QUEUED', 'RUNNING'] } }, { enrichmentStatus: { $in: ['QUEUED', 'RUNNING'] } }] }, { $set: { pushPending: true } }); return }
    throw new AppError('An email analysis is already running.', 409, 'MAIL_SCAN_BUSY')
  }
  if (push && !followUp && settings.updatedAt > new Date(Date.now() - 30000)) return
  const resume = settings.status === 'FAILED' && settings.provider === provider && String(settings.connectionId) === connection.id && settings.cursor && settings.processed < 250
  const result = await withStateLock(userId, () => {
    signal?.throwIfAborted()
    return MailAnalysis.findOneAndUpdate({ _id: settings.id, enabled: true, status: settings.status, updatedAt: settings.updatedAt, enrichmentStatus: { $nin: ['QUEUED', 'RUNNING'] } }, { $set: { provider, connectionId: connection.id, runId: resume ? settings.runId : randomUUID(), cursor: resume ? settings.cursor : null, processed: resume ? settings.processed : 0, limit: 250, until: resume ? settings.until : new Date(), status: 'QUEUED', leaseId: null, leaseUntil: null, lastErrorCode: null, pushPending: false } }, { returnDocument: 'after' })
  })
  if (!result) throw new AppError('Scan state changed. Refresh and retry.', 409, 'MAIL_SCAN_BUSY')
  if (!push) {
    try { await (provider === 'gmail' ? ensureGmailPush : ensureMicrosoftPush)(userId) }
    catch { logEvent('warn', 'top_k_watch_setup_failed', { provider, errorCode: 'MAIL_PUSH_SETUP_FAILED' }) }
  }
  return result
}

export async function processTopKPage(id) {
  const leaseId = randomUUID()
  const scan = await MailAnalysis.findOneAndUpdate({ _id: id, enabled: true, $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] }, { $set: { status: 'RUNNING', leaseId, leaseUntil: new Date(Date.now() + 240000) } }, { returnDocument: 'after' }).select('+cursor +leaseId')
  if (!scan) return
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
  let finish
  const done = new Promise(resolve => { finish = resolve })
  active.set(String(scan.userId), { controller, done, provider: scan.provider })
  const owned = { _id: scan.id, runId: scan.runId, leaseId, status: 'RUNNING', enabled: true }
  async function guard() {
    signal.throwIfAborted()
    const connection = await models[scan.provider].findOne({ _id: scan.connectionId, userId: scan.userId, status: { $in: ['CONNECTED', 'SYNCING'] } })
    if (!connection || !canReadMailBody(scan.provider, connection) || !await User.exists({ _id: scan.userId }) || !await MailAnalysis.exists(owned)) throw new AppError('Email analysis stopped.', 409, 'MAIL_SCAN_STOPPED')
  }
  let stage = 'metadata'
  try {
    await guard()
    const page = await fetchOrderPage({ ...scan.toObject(), since: new Date(0) }, signal)
    const writes = []
    for (let offset = 0; offset < page.messages.length; offset += 5) {
      await guard()
      const entries = []
      for (const message of page.messages.slice(offset, offset + 5)) {
        if (message.deleted || !message.providerId) continue
        const input = sanitizeMailMetadata(message)
        const messageHash = hashOrderValue(scan.userId, scan.provider, scan.connectionId, message.providerId)
        const fingerprint = hashOrderValue(scan.userId, scan.provider, scan.connectionId, JSON.stringify(input))
        const filter = { userId: scan.userId, provider: scan.provider, connectionId: scan.connectionId, messageHash }
        const previous = await MailInsight.findOne(filter).lean()
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
          const body = sanitizeMailBody(await fetchMailBody({ userId: scan.userId, provider: scan.provider, connectionId: String(scan.connectionId), providerId: entry.message.providerId }, signal))
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
    const completed = processed >= 250 || !page.cursor
    await withStateLock(scan.userId, async () => {
      await guard()
      signal.throwIfAborted()
      if (writes.length) await MailInsight.bulkWrite(writes, { ordered: true })
      await guard()
      await MailAnalysis.updateOne(owned, { $set: { processed, cursor: completed ? null : page.cursor, status: completed ? 'COMPLETED' : 'QUEUED', leaseId: null, leaseUntil: null, lastErrorCode: null } })
    })
    if (completed) {
      const pending = await MailAnalysis.findOneAndUpdate({ _id: scan.id, status: 'COMPLETED', pushPending: true }, { $set: { pushPending: false } })
      if (pending) await startTopKScan(scan.userId, scan.provider, { push: true, followUp: true, signal })
    }
  } catch (error) {
    await MailAnalysis.updateOne(owned, { $set: { status: signal.aborted ? 'CANCELLED' : 'FAILED', leaseId: null, leaseUntil: null, lastErrorCode: error.code && typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' } })
    logEvent('warn', 'mail_analysis_failed', { stage, responseStage: error.details?.stage, errorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' })
  } finally { active.delete(String(scan.userId)); finish() }
}

export async function queueMailEnrichment(userId) {
  const settings = await MailAnalysis.findOne({ userId })
  if (!settings?.enabled || !settings.acceptedAt || settings.version !== 1 || settings.status !== 'COMPLETED') throw new AppError('Complete the current email scan before updating application details.', 409, 'MAIL_SCAN_BUSY')
  const connection = await models[settings.provider].findOne({ _id: settings.connectionId, userId })
  if (!canReadMailBody(settings.provider, connection)) throw new AppError('Read-only body access is required.', 409, 'MAIL_BODY_PERMISSION_REQUIRED')
  if (['QUEUED', 'RUNNING'].includes(settings.enrichmentStatus)) throw new AppError('Application details are already being updated.', 409, 'MAIL_SCAN_BUSY')
  const resume = settings.enrichmentStatus === 'FAILED'
  const result = await withStateLock(userId, () => MailAnalysis.updateOne({ _id: settings.id, enabled: true, status: 'COMPLETED', runId: settings.runId, updatedAt: settings.updatedAt, enrichmentStatus: { $nin: ['QUEUED', 'RUNNING'] } }, { $set: { enrichmentStatus: 'QUEUED', enrichmentErrorCode: null, enrichmentLeaseId: null, enrichmentLeaseUntil: null, ...(!resume ? { enrichmentProcessed: 0, enrichmentCursor: null } : {}) } }))
  if (!result.matchedCount) throw new AppError('Scan state changed. Refresh and retry.', 409, 'MAIL_SCAN_BUSY')
}

export async function processMailEnrichmentPage(id) {
  const leaseId = randomUUID()
  const scan = await MailAnalysis.findOneAndUpdate({ _id: id, enabled: true, status: 'COMPLETED', $or: [{ enrichmentStatus: 'QUEUED' }, { enrichmentStatus: 'RUNNING', enrichmentLeaseUntil: { $lt: new Date() } }] }, { $set: { enrichmentStatus: 'RUNNING', enrichmentLeaseId: leaseId, enrichmentLeaseUntil: new Date(Date.now() + 240000) } }, { returnDocument: 'after' }).select('+enrichmentCursor')
  if (!scan) return
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
  let finish
  const done = new Promise(resolve => { finish = resolve })
  active.set(String(scan.userId), { controller, done, provider: scan.provider })
  const owned = { _id: scan.id, runId: scan.runId, enabled: true, enrichmentStatus: 'RUNNING', enrichmentLeaseId: leaseId }
  async function guard() {
    signal.throwIfAborted()
    const connection = await models[scan.provider].findOne({ _id: scan.connectionId, userId: scan.userId, status: { $in: ['CONNECTED', 'SYNCING'] } })
    if (!canReadMailBody(scan.provider, connection) || !await MailAnalysis.exists(owned) || !await User.exists({ _id: scan.userId })) throw new AppError('Application enrichment stopped.', 409, 'MAIL_SCAN_STOPPED')
  }
  try {
    await guard()
    const page = await fetchOrderPage({ ...scan.toObject(), since: new Date(0), limit: 250, processed: scan.enrichmentProcessed, cursor: scan.enrichmentCursor }, signal)
    const entries = []
    for (const message of page.messages) {
      if (!message.providerId || message.deleted) continue
      const messageHash = hashOrderValue(scan.userId, scan.provider, scan.connectionId, message.providerId)
      const row = await MailInsight.findOne({ userId: scan.userId, runId: scan.runId, connectionId: scan.connectionId, messageHash, $or: [
        { category: 'jobs', $or: [{ enrichmentVersion: { $lt: MAIL_ENRICHMENT_VERSION } }, { enrichmentVersion: { $exists: false } }] },
        { category: 'other', title: 'Needs review', evidence: { $in: ['', null] }, analyzedBy: 'mercury' },
      ] })
      const input = row && sanitizeMailMetadata(message)
      if (input) entries.push({ message, row, input })
    }
    const writes = []
    for (let offset = 0; offset < entries.length; offset += 5) {
      const batch = entries.slice(offset, offset + 5), inputs = []
      for (const entry of batch) {
        await guard()
        inputs.push({ ...entry.input, body: sanitizeMailBody(await fetchMailBody({ userId: scan.userId, provider: scan.provider, connectionId: String(scan.connectionId), providerId: entry.message.providerId }, signal)) })
      }
      await guard()
      const cards = await categorizeMessages(inputs, signal)
      // An invalid response must not erase evidence or falsely mark a legacy card enriched.
      batch.forEach((entry, i) => { if (cards[i]) writes.push({ updateOne: { filter: { _id: entry.row._id, userId: scan.userId, runId: scan.runId }, update: { $set: { ...cards[i], threadHash: entry.message.threadId ? hashOrderValue(scan.userId, scan.provider, scan.connectionId, entry.message.threadId) : null, enrichmentVersion: MAIL_ENRICHMENT_VERSION } } } }) })
    }
    const processed = scan.enrichmentProcessed + page.messages.length
    await withStateLock(scan.userId, async () => {
      await guard(); signal.throwIfAborted()
      if (writes.length) await MailInsight.bulkWrite(writes, { ordered: true })
      await guard()
      await MailAnalysis.updateOne(owned, { $set: { enrichmentProcessed: processed, enrichmentCursor: processed >= 250 || !page.cursor ? null : page.cursor, enrichmentStatus: processed >= 250 || !page.cursor ? 'COMPLETED' : 'QUEUED', enrichmentLeaseId: null, enrichmentLeaseUntil: null, enrichmentErrorCode: null } })
    })
    if (processed >= 250 || !page.cursor) {
      const pending = await MailAnalysis.findOneAndUpdate({ _id: scan.id, enabled: true, status: 'COMPLETED', enrichmentStatus: 'COMPLETED', pushPending: true }, { $set: { pushPending: false } })
      if (pending) await startTopKScan(scan.userId, scan.provider, { push: true, followUp: true, signal })
    }
  } catch (error) {
    await MailAnalysis.updateOne(owned, { $set: { enrichmentStatus: signal.aborted ? 'CANCELLED' : 'FAILED', enrichmentLeaseId: null, enrichmentLeaseUntil: null, enrichmentErrorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' } })
    logEvent('warn', 'mail_enrichment_failed', { errorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' })
  } finally { active.delete(String(scan.userId)); finish() }
}

export function startTopKWorker() {
  let stopped = false, running = false, current = Promise.resolve()
  async function tick() {
    if (stopped || running || !intelligenceConfigured()) return
    running = true
    current = (async () => {
      const scan = await MailAnalysis.findOne({ enabled: true, $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] }).select('_id')
      if (scan) await processTopKPage(scan.id)
      else {
        const enrichment = await MailAnalysis.findOne({ enabled: true, status: 'COMPLETED', $or: [{ enrichmentStatus: 'QUEUED' }, { enrichmentStatus: 'RUNNING', enrichmentLeaseUntil: { $lt: new Date() } }] }).select('_id')
        if (enrichment) await processMailEnrichmentPage(enrichment.id)
      }
    })().catch(() => logEvent('warn', 'top_k_worker_failed', { errorCode: 'MAIL_ANALYSIS_FAILED' }))
    await current; running = false
  }
  const timer = setInterval(tick, 3000); timer.unref()
  return async () => { stopped = true; clearInterval(timer); for (const entry of active.values()) entry.controller.abort(); await current }
}
