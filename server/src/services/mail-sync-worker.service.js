import GmailSyncJob from '../models/gmail-sync-job.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { processNextBatch as processGmailBatch } from './gmail-sync.service.js'
import { processNextBatch as processMicrosoftBatch } from './microsoft-sync.service.js'
import { ensureGmailPush } from './google-push.service.js'
import { ensureMicrosoftPush } from './microsoft-push.service.js'
import { runPendingPushSync } from './mail-push-sync.service.js'
import { logEvent } from '../utils/logger.js'

const DONE = ['COMPLETED', 'FAILED', 'CANCELLED']
const SWEEP_MS = 5 * 60 * 1000

export function startMailSyncWorker() {
  let stopped = false
  let running = false
  let lastSweep = 0
  let current = Promise.resolve()

  async function processQueue(Model, processBatch, provider) {
    const staleAt = new Date(Date.now() - 5 * 60 * 1000)
    const job = await Model.findOne({ $or: [
      { status: 'QUEUED' },
      { status: { $in: ['SCANNING', 'PROCESSING'] }, updatedAt: { $lt: staleAt } },
    ] }).sort({ updatedAt: 1 }).select('userId')
    if (!job) return
    try {
      const result = await processBatch(job.userId)
      if (DONE.includes(result?.status)) await runPendingPushSync(provider, job.userId)
    } catch (error) {
      if (!['GMAIL_SYNC_IN_PROGRESS', 'MICROSOFT_SYNC_IN_PROGRESS'].includes(error?.code)) {
        logEvent('warn', 'mail_sync_worker_batch_failed', { provider, errorCode: error?.code || 'MAIL_SYNC_FAILED' })
      }
    }
  }

  async function renewPushSubscriptions() {
    const now = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const google = await GoogleConnection.find({ status: { $in: ['CONNECTED', 'SYNCING'] }, $or: [{ pushStatus: { $ne: 'ACTIVE' } }, { pushExpiresAt: { $lte: now } }] }).select('userId').limit(100)
    const microsoft = await MicrosoftConnection.find({ status: { $in: ['CONNECTED', 'SYNCING'] }, $or: [{ pushStatus: { $ne: 'ACTIVE' } }, { graphSubscriptionExpiresAt: { $lte: now } }] }).select('userId').limit(100)
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
      if (Date.now() - lastSweep >= SWEEP_MS) {
        lastSweep = Date.now()
        await renewPushSubscriptions()
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
