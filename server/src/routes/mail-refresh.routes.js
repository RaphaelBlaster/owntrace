import { Router } from 'express'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'
import AppError from '../utils/app-error.js'
import GmailSyncJob from '../models/gmail-sync-job.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { MailAnalysis } from '../models/mail-insight.model.js'
import { queuePushSync } from '../services/mail-push-sync.service.js'
import { logEvent } from '../utils/logger.js'
import { MAIL_SYNC, enqueue, redisQueueEnabled } from '../shared/queue.js'

// POST /api/mail/sync-now: the workspace asks for a refresh when it opens or
// regains focus. It only enqueues through queuePushSync (trigger 'push'), so
// Gmail takes the history-based incremental path and Outlook its delta /
// metadata path; nothing runs inline in the request.
const COALESCE_MS = 30_000
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 6
const MAX_TRACKED_USERS = 10_000
const ACTIVE_JOB = ['QUEUED', 'SCANNING', 'PROCESSING']
const ACTIVE_TOP_K = ['QUEUED', 'RUNNING']

const providers = [
  { provider: 'gmail', insight: 'gmail', Connection: GoogleConnection, Job: GmailSyncJob },
  { provider: 'microsoft', insight: 'outlook', Connection: MicrosoftConnection, Job: MicrosoftSyncJob },
]

// Single app container: per-user state lives in memory and is bounded.
const requestLog = new Map()
const lastQueued = new Map()

function prune(map, now, ttl) {
  if (map.size < MAX_TRACKED_USERS) return
  for (const [key, value] of map) {
    const at = Array.isArray(value) ? value[value.length - 1] : value
    if (now - at >= ttl) map.delete(key)
  }
  while (map.size >= MAX_TRACKED_USERS) map.delete(map.keys().next().value)
}

function rateLimited(userId, now) {
  const recent = (requestLog.get(userId) || []).filter((at) => now - at < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) { requestLog.set(userId, recent); return true }
  recent.push(now)
  requestLog.delete(userId)
  prune(requestLog, now, RATE_WINDOW_MS)
  requestLog.set(userId, recent)
  return false
}

async function recentlyRefreshed(userId, { Job, insight }, analysis, since) {
  if (analysis && (!analysis.provider || analysis.provider === insight)) {
    return ACTIVE_TOP_K.includes(analysis.status) || ACTIVE_TOP_K.includes(analysis.enrichmentStatus) || analysis.updatedAt >= since
  }
  return Boolean(await Job.exists({ userId, $or: [{ status: { $in: ACTIVE_JOB } }, { updatedAt: { $gte: since } }] }))
}

// With REDIS_URL set the mail worker runs the sync; a still-pending job for
// the same user absorbs double clicks. A Redis failure falls back inline.
async function queueRefresh(provider, userId) {
  if (redisQueueEnabled()) {
    try {
      await enqueue(MAIL_SYNC, { provider, userId }, { dedupeId: `${provider}-${userId}` })
      return true
    } catch (error) { logEvent('warn', 'mail_sync_now_redis_failed', { provider, errorName: error?.name || 'Error' }) }
  }
  return queuePushSync(provider, userId)
}

const router = Router()
router.use(requireAuth)
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

router.post('/sync-now', validate(Joi.object({})), async (req, res) => {
  const body = req.body ?? {}
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
    throw new AppError('Invalid mailbox refresh request.', 400, 'MAIL_INVALID_INPUT')
  }
  const userId = String(req.auth.userId)
  const now = Date.now()
  if (rateLimited(userId, now)) {
    throw new AppError('Too many requests. Please wait and try again.', 429, 'RATE_LIMITED')
  }
  if (now - (lastQueued.get(userId) || 0) < COALESCE_MS) return res.status(202).json({ queued: false, reason: 'recent' })
  // Reserve the window before any await so concurrent requests (two tabs, a
  // focus and visibility event together) cannot both enqueue.
  lastQueued.delete(userId)
  prune(lastQueued, now, COALESCE_MS)
  lastQueued.set(userId, now)

  const since = new Date(now - COALESCE_MS)
  const [connections, analysis] = await Promise.all([
    Promise.all(providers.map((entry) => entry.Connection.exists({ userId: req.auth.userId, status: 'CONNECTED' }))),
    MailAnalysis.findOne({ userId: req.auth.userId, enabled: true, version: 1 }).select('provider status enrichmentStatus updatedAt').lean(),
  ])
  const connected = providers.filter((_entry, index) => connections[index])
  if (!connected.length) return res.status(202).json({ queued: false, reason: 'no_mailbox' })

  let queued = 0
  for (const entry of connected) {
    if (await recentlyRefreshed(req.auth.userId, entry, analysis, since)) continue
    try {
      if (await queueRefresh(entry.provider, userId)) queued += 1
    } catch (error) {
      logEvent('warn', 'mail_sync_now_enqueue_failed', { provider: entry.provider, errorCode: typeof error?.code === 'string' ? error.code : 'MAIL_SYNC_FAILED' })
    }
  }
  if (!queued) return res.status(202).json({ queued: false, reason: 'recent' })
  return res.status(202).json({ queued: true })
})

function resetMailRefreshState() { requestLog.clear(); lastQueued.clear() }

export { resetMailRefreshState }
export default router
