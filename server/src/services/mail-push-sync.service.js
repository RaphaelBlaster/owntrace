import GmailSyncJob from '../models/gmail-sync-job.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import { startSync as startGmailSync } from './gmail-sync.service.js'
import { startSync as startMicrosoftSync } from './microsoft-sync.service.js'
import { MailAnalysis } from '../models/mail-insight.model.js'
import { startTopKScan } from './top-k.service.js'
import { logEvent } from '../utils/logger.js'

const jobs = {
  gmail: { Model: GmailSyncJob, start: startGmailSync },
  microsoft: { Model: MicrosoftSyncJob, start: startMicrosoftSync },
}
const active = ['QUEUED', 'SCANNING', 'PROCESSING']

async function queuePushSync(provider, userId) {
  const insightProvider = provider === 'microsoft' ? 'outlook' : provider
  if (await MailAnalysis.exists({ userId, enabled: true, version: 1 })) {
    try { await startTopKScan(userId, insightProvider, { push: true }) }
    catch (error) { logEvent('warn', 'top_k_push_enqueue_failed', { errorCode: typeof error.code === 'string' ? error.code : 'MAIL_ANALYSIS_FAILED' }) }
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

export { queuePushSync, runPendingPushSync }
