import GmailSyncJob from '../models/gmail-sync-job.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { processNextBatch as processGmailBatch } from './gmail-sync.service.js'
import { processNextBatch as processMicrosoftBatch } from './microsoft-sync.service.js'
import { ensureGmailPush } from './google-push.service.js'
import { ensureMicrosoftPush } from './microsoft-push.service.js'
import { pollStaleMailboxes, runPendingPushSync, runStrandedPushSyncs } from './mail-push-sync.service.js'
import { logEvent } from '../utils/logger.js'

const DONE = ['COMPLETED', 'FAILED', 'CANCELLED']
const SWEEP_MS = 5 * 60 * 1000
const PENDING_REPLAY_MS = 15 * 1000
const DEFAULT_SAFETY_POLL_MINUTES = 15

// Periodic refresh that keeps mailboxes current even when Gmail Pub/Sub or
// Microsoft Graph notifications stop arriving. MAIL_SAFETY_POLL_MINUTES=0 disables it.
function getSafetyPollMs() {
  const raw = process.env.MAIL_SAFETY_POLL_MINUTES?.trim()
  if (raw === '0') return 0
  const minutes = Number(raw)
  return (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : DEFAULT_SAFETY_POLL_MINUTES) * 60 * 1000
}

// Metadata batches are claimed by processNextBatch, which treats a SCANNING or
// PROCESSING job whose updatedAt is older than 5 minutes as abandoned. While
// this process is running a batch it keeps updatedAt fresh, so a slow batch is
// never claimed by a second worker process; a crashed process stops renewing
// and its job is reclaimed after the timeout. Nothing else moves while the
// batch runs, so only updatedAt is touched.
// The heartbeat is capped: a batch stuck on a provider request that never
// returns stops renewing after BATCH_HEARTBEAT_MAX_MS, so the job is reclaimed
// (and startSync can reset it) instead of being held forever by a hung process.
export const BATCH_HEARTBEAT_MS = 60 * 1000
export const BATCH_HEARTBEAT_MAX_MS = 20 * 60 * 1000
export function holdBatchLease(Model, jobId, intervalMs = BATCH_HEARTBEAT_MS, maxMs = BATCH_HEARTBEAT_MAX_MS) {
  let renewalsLeft = Math.max(1, Math.floor(maxMs / intervalMs))
  const timer = setInterval(() => {
    if (renewalsLeft-- <= 0) {
      clearInterval(timer)
      logEvent('warn', 'mail_sync_lease_heartbeat_expired', { errorCode: 'MAIL_SYNC_BATCH_STALLED' })
      return
    }
    Model.updateOne({ _id: jobId, status: { $in: ['SCANNING', 'PROCESSING'] } }, { $currentDate: { updatedAt: true } }, { timestamps: false })
      .catch(() => logEvent('warn', 'mail_sync_lease_renewal_failed', { errorCode: 'MAIL_SYNC_LEASE_RENEWAL_FAILED' }))
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function startMailSyncWorker() {
  let stopped = false
  let running = false
  let lastSweep = 0
  let lastReplay = 0
  let lastPoll = 0
  let current = Promise.resolve()

  async function processQueue(Model, processBatch, provider) {
    const staleAt = new Date(Date.now() - 5 * 60 * 1000)
    const job = await Model.findOne({ $or: [
      { status: 'QUEUED' },
      { status: { $in: ['SCANNING', 'PROCESSING'] }, updatedAt: { $lt: staleAt } },
    ] }).sort({ updatedAt: 1 }).select('userId')
    if (!job) return
    const stopHeartbeat = holdBatchLease(Model, job._id)
    try {
      const result = await processBatch(job.userId)
      stopHeartbeat()
      if (DONE.includes(result?.status)) await runPendingPushSync(provider, job.userId)
    } catch (error) {
      if (!['GMAIL_SYNC_IN_PROGRESS', 'MICROSOFT_SYNC_IN_PROGRESS'].includes(error?.code)) {
        logEvent('warn', 'mail_sync_worker_batch_failed', { provider, errorCode: error?.code || 'MAIL_SYNC_FAILED' })
      }
    } finally { stopHeartbeat() }
  }

  async function renewPushSubscriptions() {
    const now = new Date(Date.now() + 24 * 60 * 60 * 1000)
    // ERROR is included: a failed metadata scan must not let the 7-day Gmail watch lapse.
    const google = await GoogleConnection.find({ status: { $in: ['CONNECTED', 'SYNCING', 'ERROR'] }, $or: [{ pushStatus: { $ne: 'ACTIVE' } }, { pushExpiresAt: { $lte: now } }] }).sort({ pushExpiresAt: 1 }).select('userId').limit(100)
    const microsoft = await MicrosoftConnection.find({ status: { $in: ['CONNECTED', 'SYNCING', 'ERROR'] }, $or: [{ pushStatus: { $ne: 'ACTIVE' } }, { graphSubscriptionExpiresAt: { $lte: now } }] }).sort({ graphSubscriptionExpiresAt: 1 }).select('userId').limit(100)
    for (const connection of google) {
      try { await ensureGmailPush(connection.userId) }
      catch { logEvent('warn', 'gmail_push_renewal_failed', { errorCode: 'GMAIL_PUSH_SETUP_FAILED' }) }
    }
    for (const connection of microsoft) {
      try { await ensureMicrosoftPush(connection.userId) }
      catch { logEvent('warn', 'microsoft_push_renewal_failed', { errorCode: 'MICROSOFT_PUSH_SETUP_FAILED' }) }
    }
  }

  async function tick() {
    if (stopped || running) return
    running = true
    current = (async () => {
      await Promise.all([
        processQueue(GmailSyncJob, processGmailBatch, 'gmail'),
        processQueue(MicrosoftSyncJob, processMicrosoftBatch, 'microsoft'),
      ])
      if (Date.now() - lastReplay >= PENDING_REPLAY_MS) {
        lastReplay = Date.now()
        try { await runStrandedPushSyncs() }
        catch { logEvent('warn', 'mail_push_replay_failed', { errorCode: 'MAIL_PUSH_REPLAY_FAILED' }) }
      }
      if (Date.now() - lastSweep >= SWEEP_MS) {
        lastSweep = Date.now()
        try { await renewPushSubscriptions() }
        catch { logEvent('warn', 'mail_push_renewal_sweep_failed', { errorCode: 'MAIL_PUSH_RENEWAL_FAILED' }) }
      }
      const pollMs = getSafetyPollMs()
      if (pollMs && Date.now() - lastPoll >= pollMs) {
        lastPoll = Date.now()
        try { await pollStaleMailboxes({ staleBefore: new Date(Date.now() - pollMs) }) }
        catch { logEvent('warn', 'mail_safety_poll_failed', { errorCode: 'MAIL_SAFETY_POLL_FAILED' }) }
      }
    })().catch(() => logEvent('warn', 'mail_sync_worker_failed', { errorCode: 'MAIL_SYNC_WORKER_FAILED' }))
    await current
    running = false
  }

  const timer = setInterval(tick, 1000)
  timer.unref()
  void tick()
  return async () => { stopped = true; clearInterval(timer); await current }
}
