import GmailSyncJob from '../models/gmail-sync-job.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { startSync as startGmailSync } from './gmail-sync.service.js'
import { startSync as startMicrosoftSync } from './microsoft-sync.service.js'
import { MailAnalysis } from '../models/mail-insight.model.js'
import { startTopKScan } from './top-k.service.js'
import { logEvent } from '../utils/logger.js'

const jobs = {
  gmail: { Model: GmailSyncJob, Connection: GoogleConnection, start: startGmailSync },
  microsoft: { Model: MicrosoftSyncJob, Connection: MicrosoftConnection, start: startMicrosoftSync },
}
const active = ['QUEUED', 'SCANNING', 'PROCESSING']
const topKActive = ['QUEUED', 'RUNNING']
// startTopKScan does not start a scan for a push arriving within 30s of the last
// analysis update; it parks it in pushPending and runStrandedPushSyncs replays it.
const TOP_K_PUSH_DEBOUNCE_MS = 30_000

function errorCodeOf(error, fallback) {
  return typeof error?.code === 'string' ? error.code : fallback
}

async function markTopKPushPending(userId) {
  // timestamps:false so parking the push does not extend the debounce window.
  await MailAnalysis.updateOne({ userId, enabled: true, version: 1 }, { $set: { pushPending: true } }, { timestamps: false })
}

async function queuePushSync(provider, userId) {
  const insightProvider = provider === 'microsoft' ? 'outlook' : provider
  const analysis = await MailAnalysis.findOne({ userId, enabled: true, version: 1 }).select('provider')
  // Only a push from the mailbox Top K analyses (or any push before the first
  // scan picked one) goes to Top K. A push from the user's other provider takes
  // the metadata path, so it can never silently switch the analysis provider.
  if (analysis && (!analysis.provider || analysis.provider === insightProvider)) {
    try {
      // startTopKScan parks debounced pushes and pushes that arrive while a scan
      // or enrichment is running in pushPending itself, so neither is dropped.
      await startTopKScan(userId, insightProvider, { push: true })
    } catch (error) {
      if (error?.code === 'MAIL_SCAN_BUSY') await markTopKPushPending(userId)
      else logEvent('warn', 'top_k_push_enqueue_failed', { errorCode: errorCodeOf(error, 'MAIL_ANALYSIS_FAILED') })
    }
    return true
  }
  const entry = jobs[provider]
  if (!entry) return false
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await entry.Model.findOne({ userId }).select('+pushPending')
    if (current && active.includes(current.status)) {
      const updated = await entry.Model.updateOne({ _id: current.id, status: { $in: active } }, { $set: { pushPending: true } })
      if (updated.matchedCount) return true
      continue
    }
    try {
      await entry.start(userId, { trigger: 'push' })
      return true
    } catch (error) {
      if (!['GMAIL_SYNC_IN_PROGRESS', 'MICROSOFT_SYNC_IN_PROGRESS'].includes(error.code)) throw error
    }
  }
  throw new Error('Mailbox sync state changed repeatedly while queuing a provider notification')
}

async function runPendingPushSync(provider, userId) {
  const entry = jobs[provider]
  if (!entry) return false
  const claimed = await entry.Model.findOneAndUpdate(
    { userId, status: { $nin: active }, pushPending: true },
    { $set: { pushPending: false } },
    { returnDocument: 'after' },
  )
  if (!claimed) return false
  try {
    await entry.start(userId, { trigger: 'push' })
    return true
  } catch (error) {
    if (!['GMAIL_SYNC_IN_PROGRESS', 'MICROSOFT_SYNC_IN_PROGRESS'].includes(error.code)) throw error
    await entry.Model.updateOne({ userId, status: { $in: active } }, { $set: { pushPending: true } })
    return false
  }
}

// Replays pushes that were parked but never consumed: a metadata job finished
// by the browser-driven batch route (only the worker replayed pushPending), and
// Top K pushes that fell inside the startTopKScan debounce window.
async function runStrandedPushSyncs({ limit = 10 } = {}) {
  for (const provider of Object.keys(jobs)) {
    const stranded = await jobs[provider].Model.find({ pushPending: true, status: { $nin: active } }).select('userId').limit(limit)
    for (const job of stranded) {
      try { await runPendingPushSync(provider, job.userId) }
      catch (error) { logEvent('warn', 'mail_push_replay_failed', { provider, errorCode: errorCodeOf(error, 'MAIL_SYNC_FAILED') }) }
    }
  }
  const due = await MailAnalysis.find({
    enabled: true,
    version: 1,
    pushPending: true,
    provider: { $in: ['gmail', 'outlook'] },
    status: { $nin: topKActive },
    enrichmentStatus: { $nin: topKActive },
    updatedAt: { $lt: new Date(Date.now() - TOP_K_PUSH_DEBOUNCE_MS) },
  }).select('_id userId provider').limit(limit)
  for (const analysis of due) {
    const claimed = await MailAnalysis.updateOne({ _id: analysis._id, pushPending: true }, { $set: { pushPending: false } }, { timestamps: false })
    if (!claimed.modifiedCount) continue
    try { await startTopKScan(analysis.userId, analysis.provider, { push: true }) }
    catch (error) { logEvent('warn', 'top_k_push_replay_failed', { errorCode: errorCodeOf(error, 'MAIL_ANALYSIS_FAILED') }) }
  }
}

// Safety net for lost or misconfigured provider pushes: refresh every mailbox
// whose last refresh is older than staleBefore. Only mailboxes the user already
// scanned once are polled, and a mailbox whose job or analysis changed since
// staleBefore is skipped, so a failing mailbox retries at most once per interval.
// A mailbox whose safety poll throws before any state changes (for example a
// stale connection status) would otherwise stay the oldest row and fill every
// batch, so it is left out for a while after a failure.
const POLL_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000
const pollFailures = new Map()

function recentPollFailures(kind) {
  const now = Date.now()
  const ids = []
  for (const [key, at] of pollFailures) {
    if (now - at >= POLL_FAILURE_BACKOFF_MS) pollFailures.delete(key)
    else if (key.startsWith(`${kind}:`)) ids.push(key.slice(kind.length + 1))
  }
  return ids
}

async function pollStaleMailboxes({ staleBefore, limit = 50 }) {
  const analyses = await MailAnalysis.find({
    userId: { $nin: recentPollFailures('topk') },
    enabled: true,
    version: 1,
    provider: { $in: ['gmail', 'outlook'] },
    status: { $in: ['COMPLETED', 'FAILED'] },
    enrichmentStatus: { $nin: topKActive },
    updatedAt: { $lt: staleBefore },
  }).sort({ updatedAt: 1 }).select('userId provider').limit(limit)
  for (const analysis of analyses) {
    try { await startTopKScan(analysis.userId, analysis.provider, { push: true }) }
    catch (error) {
      pollFailures.set(`topk:${analysis.userId}`, Date.now())
      logEvent('warn', 'top_k_safety_poll_failed', { errorCode: errorCodeOf(error, 'MAIL_ANALYSIS_FAILED') })
    }
  }

  // Top K users never run metadata scans, so their lastSyncAt stays old; they
  // are excluded in the query so they cannot fill the batch.
  const analysisUsers = await MailAnalysis.distinct('userId', { enabled: true, version: 1 })
  for (const [provider, entry] of Object.entries(jobs)) {
    const connections = await entry.Connection.find({
      userId: { $nin: [...analysisUsers, ...recentPollFailures(provider)] },
      status: { $in: ['CONNECTED', 'ERROR'] },
      lastSyncAt: { $ne: null, $lt: staleBefore },
    }).sort({ lastSyncAt: 1 }).select('userId').limit(limit)
    if (!connections.length) continue
    const userIds = connections.map((connection) => connection.userId)
    const recentJobUsers = await entry.Model.distinct('userId', { userId: { $in: userIds }, $or: [{ status: { $in: active } }, { updatedAt: { $gte: staleBefore } }] })
    const skip = new Set(recentJobUsers.map(String))
    for (const connection of connections) {
      if (skip.has(String(connection.userId))) continue
      try { await queuePushSync(provider, connection.userId) }
      catch (error) {
        pollFailures.set(`${provider}:${connection.userId}`, Date.now())
        logEvent('warn', 'mail_safety_poll_failed', { provider, errorCode: errorCodeOf(error, 'MAIL_SYNC_FAILED') })
      }
    }
  }
}

export { pollStaleMailboxes, queuePushSync, runPendingPushSync, runStrandedPushSyncs }
