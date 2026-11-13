import crypto from 'node:crypto'
import { google } from 'googleapis'
import { getTokenEncryptionKey } from '../config/google.js'
import GmailSyncJob from '../models/gmail-sync-job.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import AppError from '../utils/app-error.js'
import { discoverAccountsForUser } from './account-discovery.service.js'
import {
  extractBillingMetadata,
  syncSubscriptionsForUser,
} from './subscription-detection.service.js'
import { withGoogleClient } from './google-client.service.js'
import { writeSignalPage } from './order-write-batch.service.js'
import { drainBufferedOrderWrites } from './order-write-buffer.service.js'

const BATCH_SIZE = 25
const BATCH_LOCK_TIMEOUT_MS = 5 * 60 * 1000
const METADATA_CONCURRENCY = 5
const DEFAULT_MESSAGE_LIMIT = 2000
const METADATA_HEADERS = ['From', 'Subject', 'Date']
const activeBatchBarriers = new Map()
const JOB_PRIVATE_FIELDS = '+nextPageToken +runId +leaseId +historyStartId +historyLatestId +historyPageCount +metadataFailedCount'

function getMessageLimit() {
  const configured = Number(process.env.GMAIL_SYNC_MESSAGE_LIMIT)
  return Number.isInteger(configured) && configured >= BATCH_SIZE && configured <= 20_000
    ? configured
    : DEFAULT_MESSAGE_LIMIT
}

function getSyncPolicy() {
  return { batchSize: BATCH_SIZE, messageLimit: getMessageLimit() }
}

function hashProviderId(userId, value) {
  return crypto
    .createHmac('sha256', getTokenEncryptionKey())
    .update(`${userId}:${value}`)
    .digest('base64url')
}

function deriveSubjectSignal(subject) {
  if (typeof subject !== 'string' || !subject.trim()) return null

  return subject
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function parseSender(value) {
  if (typeof value !== 'string') return { senderDomain: null, senderEmail: null }

  const angleMatch = value.match(/<([^<>\s]+@[^<>\s]+)>/)
  const simpleMatch = value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)
  const senderEmail = (angleMatch?.[1] || simpleMatch?.[0] || '').toLowerCase()
  const senderDomain = senderEmail.includes('@') ? senderEmail.split('@').pop() : null
  return { senderDomain, senderEmail: senderEmail || null }
}

function getHeader(message, name) {
  return message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
    ?.value
}

function deriveSignal(userId, connectionId, message) {
  const { senderDomain, senderEmail } = parseSender(getHeader(message, 'From'))
  const subject = getHeader(message, 'Subject')
  const billingMetadata = extractBillingMetadata(subject)
  const headerDate = Date.parse(getHeader(message, 'Date'))
  const internalDate = Number(message.internalDate)
  const occurredAt = Number.isFinite(internalDate) && internalDate > 0
    ? new Date(internalDate)
    : new Date(headerDate)

  if (!message.id || !message.threadId || Number.isNaN(occurredAt.getTime())) return null

  return {
    billingAmountMinor: billingMetadata.amountMinor,
    billingCurrency: billingMetadata.currency,
    billingCycle: billingMetadata.billingCycle,
    connectionId,
    messageIdHash: hashProviderId(userId, message.id),
    occurredAt,
    senderDomain,
    senderEmail,
    subjectSignal: deriveSubjectSignal(subject),
    threadIdHash: hashProviderId(userId, message.threadId),
    userId,
  }
}

// Pushes and safety polls (trigger 'push') read only the messages added since
// the stored historyId. User-started scans stay full scans. Pass
// incremental: true/false to override.
function wantsIncremental({ incremental, trigger } = {}) {
  if (typeof incremental === 'boolean') return incremental
  return trigger === 'push'
}

async function startSync(userId, options = {}) {
  const connection = await GoogleConnection.findOne({ userId }).select('+gmailHistoryId +gmailWatchHistoryId')
  if (!connection) throw new AppError('Connect Gmail before starting a scan.', 409, 'GOOGLE_NOT_CONNECTED')
  if (connection.status === 'NEEDS_RECONNECT') {
    throw new AppError('Reconnect Gmail before starting a scan.', 409, 'GOOGLE_RECONNECT_REQUIRED')
  }

  if (connection.status === 'DISCONNECTING') {
    throw new AppError('Gmail is disconnecting. Try again shortly.', 409, 'GOOGLE_DISCONNECT_IN_PROGRESS')
  }
  const incremental = wantsIncremental(options) && Boolean(connection.gmailHistoryId)
  // A full scan records the mailbox historyId on its first page. The watch
  // historyId predates this scan, so it is a safe (older) fallback baseline.
  const fallbackBaseline = !incremental && connection.gmailWatchHistoryId ? connection.gmailWatchHistoryId : null
  let job
  try {
    job = await GmailSyncJob.findOneAndUpdate(
      {
        userId,
        $or: [
          { status: { $nin: ['QUEUED', 'SCANNING', 'PROCESSING'] } },
          { status: { $in: ['SCANNING', 'PROCESSING'] }, updatedAt: { $lt: new Date(Date.now() - BATCH_LOCK_TIMEOUT_MS) } },
        ],
      },
      {
        $set: {
          completedAt: null,
          connectionId: connection.id,
          estimatedTotal: null,
          historyLatestId: incremental ? connection.gmailHistoryId : fallbackBaseline,
          historyPageCount: 0,
          historyStartId: incremental ? connection.gmailHistoryId : null,
          lastErrorCode: null,
          metadataFailedCount: 0,
          nextPageToken: null,
          processedCount: 0,
          pushPending: false,
          runId: crypto.randomUUID(),
          leaseId: null,
          startedAt: new Date(),
          status: 'QUEUED',
          storedCount: 0,
          syncMode: incremental ? 'INCREMENTAL' : 'FULL',
        },
      },
      { returnDocument: 'after', runValidators: true, upsert: true },
    )
  } catch (error) {
    if (error?.code !== 11000) throw error
    throw new AppError('A Gmail metadata scan is already in progress.', 409, 'GMAIL_SYNC_IN_PROGRESS')
  }
  const updatedConnection = await GoogleConnection.updateOne(
    { _id: connection.id, userId, status: { $nin: ['DISCONNECTING', 'NEEDS_RECONNECT'] } },
    { $set: { lastErrorCode: null, status: 'SYNCING' } },
  )
  if (!updatedConnection.matchedCount) {
    await cancelSync(userId)
    throw new AppError('The Gmail connection changed. Refresh before scanning.', 409, 'GOOGLE_NOT_CONNECTED')
  }
  return job
}

// Explicit entry point for callers that always want the history-based path.
// It falls back to a full scan when no baseline is stored or Gmail rejects it.
function startIncrementalSync(userId, options = {}) {
  return startSync(userId, { ...options, incremental: true })
}

async function getSyncJob(userId, { includePageToken = false } = {}) {
  const query = GmailSyncJob.findOne({ userId })
  if (includePageToken) query.select(JOB_PRIVATE_FIELDS)
  return query
}

// Gmail per-user quota answers 429 or 403 rateLimitExceeded when a full scan runs hot.
// Back off and retry instead of failing the whole scan and marking the mailbox ERROR.
export function isGmailRateLimited(error) {
  const status = Number(error?.response?.status ?? error?.code)
  const reasons = (error?.response?.data?.error?.errors || []).map(item => item?.reason)
  return status === 429 || (status === 403 && reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)))
}
const RATE_LIMIT_RETRIES = 4
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function fetchMessageMetadata(gmail, messageId) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await gmail.users.messages.get({
        format: 'metadata',
        id: messageId,
        metadataHeaders: METADATA_HEADERS,
        userId: 'me',
      })
      return { message: response.data }
    } catch (error) {
      if (error?.response?.status === 404) return { deleted: true }
      if (attempt < RATE_LIMIT_RETRIES && isGmailRateLimited(error)) {
        await sleep(Math.min(16000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400))
        continue
      }
      throw error
    }
  }
}

async function fetchMetadataBatch(gmail, messages) {
  const results = new Array(messages.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < messages.length) {
      const currentIndex = nextIndex
      nextIndex += 1

      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await fetchMessageMetadata(gmail, messages[currentIndex].id),
        }
      } catch (reason) {
        results[currentIndex] = { reason, status: 'rejected' }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(METADATA_CONCURRENCY, messages.length) }, () => worker()),
  )
  return results
}

function isHistoryExpired(error) {
  const status = Number(error?.response?.status ?? error?.status)
  return status === 404 || error?.code === 404
}

// Hard stop for history pagination so a mailbox whose added messages are all
// filtered out (spam/trash) cannot page forever.
function getHistoryPageLimit() {
  return Math.ceil(getMessageLimit() / BATCH_SIZE) + 20
}

async function readMailboxHistoryId(gmail) {
  try {
    const response = await gmail.users.getProfile({ userId: 'me' })
    return response?.data?.historyId ? String(response.data.historyId) : null
  } catch {
    // Without a baseline the run behaves exactly like a scan before
    // incremental sync existed; critical auth/rate errors surface on list.
    return null
  }
}

async function listFullPage(gmail, { pageToken, processedBefore, historyLatestId }) {
  // The first page records the mailbox historyId before listing, so mail that
  // arrives during the scan is picked up by the next incremental sync.
  const baseline = pageToken ? historyLatestId : (await readMailboxHistoryId(gmail)) || historyLatestId
  const listResponse = await gmail.users.messages.list({
    maxResults: Math.min(BATCH_SIZE, Math.max(1, getMessageLimit() - processedBefore)),
    pageToken: pageToken || undefined,
    userId: 'me',
  })
  return {
    estimatedTotal: listResponse.data.resultSizeEstimate ?? null,
    historyLatestId: baseline || null,
    messages: (listResponse.data.messages || []).slice(0, Math.min(BATCH_SIZE, Math.max(0, getMessageLimit() - processedBefore))),
    providerNextPageToken: listResponse.data.nextPageToken || null,
    truncated: false,
  }
}

async function listHistoryPage(gmail, { historyStartId, pageToken, processedBefore, historyLatestId }) {
  const response = await gmail.users.history.list({
    historyTypes: ['messageAdded'],
    maxResults: BATCH_SIZE,
    pageToken: pageToken || undefined,
    startHistoryId: historyStartId,
    userId: 'me',
  })
  const seen = new Set()
  const added = []
  for (const record of response.data.history || []) {
    for (const entry of record.messagesAdded || []) {
      const id = entry?.message?.id
      const labels = entry?.message?.labelIds || []
      // messages.list skips spam and trash by default; match the full scan.
      if (!id || seen.has(id) || labels.includes('SPAM') || labels.includes('TRASH')) continue
      seen.add(id)
      added.push({ id })
    }
  }
  const remaining = Math.max(0, getMessageLimit() - processedBefore)
  return {
    estimatedTotal: null,
    historyLatestId: response.data.historyId ? String(response.data.historyId) : historyLatestId,
    messages: added.slice(0, remaining),
    providerNextPageToken: response.data.nextPageToken || null,
    truncated: added.length > remaining,
  }
}

async function processNextBatch(userId) {
  const currentJob = await getSyncJob(userId, { includePageToken: true })

  if (!currentJob) {
    throw new AppError('Start a Gmail scan before processing it.', 409, 'GMAIL_SYNC_NOT_STARTED')
  }
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(currentJob.status)) return currentJob

  const leaseId = crypto.randomUUID()
  const job = await GmailSyncJob.findOneAndUpdate(
    {
      _id: currentJob.id,
      userId,
      $or: [
        { status: 'QUEUED' },
        {
          status: { $in: ['SCANNING', 'PROCESSING'] },
          updatedAt: { $lt: new Date(Date.now() - BATCH_LOCK_TIMEOUT_MS) },
        },
      ],
    },
    { $set: { lastErrorCode: null, leaseId, status: 'SCANNING' } },
    { returnDocument: 'after' },
  ).select(JOB_PRIVATE_FIELDS)

  if (!job) {
    throw new AppError(
      'A Gmail metadata batch is already in progress.',
      409,
      'GMAIL_SYNC_IN_PROGRESS',
    )
  }

  let releaseBarrier
  const barrierKey = `${userId}:${leaseId}`
  activeBatchBarriers.set(barrierKey, new Promise((resolve) => { releaseBarrier = resolve }))
  const ownedLease = { _id: job.id, userId, runId: job.runId, leaseId }
  try {
    const updatedJob = await withGoogleClient(userId, async ({ connection, oauthClient }) => {
      const gmail = google.gmail({ auth: oauthClient, version: 'v1' })
      const state = {
        historyLatestId: job.historyLatestId || null,
        historyPageCount: job.historyPageCount || 0,
        historyStartId: job.historyStartId || null,
        metadataFailedCount: job.metadataFailedCount || 0,
        pageToken: job.nextPageToken || null,
        processedBefore: job.processedCount,
      }
      let incremental = job.syncMode === 'INCREMENTAL' && Boolean(state.historyStartId)
      let page
      if (incremental) {
        try {
          page = await listHistoryPage(gmail, state)
        } catch (error) {
          if (!isHistoryExpired(error)) throw error
          // The stored historyId is too old or invalid: restart this run as
          // the existing full scan and drop the unusable baseline.
          const reset = await GmailSyncJob.updateOne(
            { ...ownedLease, status: 'SCANNING' },
            { $set: { historyLatestId: null, historyPageCount: 0, historyStartId: null, metadataFailedCount: 0, nextPageToken: null, processedCount: 0, storedCount: 0, syncMode: 'FULL' } },
          )
          if (!reset.modifiedCount) return getSyncJob(userId)
          await GoogleConnection.updateOne(
            { _id: connection.id, userId, gmailHistoryId: state.historyStartId },
            { $set: { gmailHistoryId: null, gmailHistoryIdUpdatedAt: null } },
          )
          Object.assign(state, { historyLatestId: null, historyPageCount: 0, historyStartId: null, metadataFailedCount: 0, pageToken: null, processedBefore: 0 })
          incremental = false
        }
      }
      if (!incremental) page = await listFullPage(gmail, state)
      const { messages } = page

      const processingUpdate = await GmailSyncJob.updateOne(
        { ...ownedLease, status: 'SCANNING' },
        { $set: { estimatedTotal: page.estimatedTotal, status: 'PROCESSING' } },
      )

      if (!processingUpdate.modifiedCount) return getSyncJob(userId)

      const results = await fetchMetadataBatch(gmail, messages)
      const criticalFailure = results.find((result) => {
        const status = result.reason?.response?.status || result.reason?.code
        const providerCode = result.reason?.response?.data?.error
        return result.status === 'rejected' && (
          status === 401 || status === 429 || providerCode === 'invalid_grant'
        )
      })

      if (criticalFailure) throw criticalFailure.reason

      const signals = []
      let failedCount = 0

      results.forEach((result) => {
        if (result.status === 'rejected') {
          failedCount += 1
          return
        }

        if (!result.value.deleted) {
          const signal = deriveSignal(userId, connection.id, result.value.message)
          if (signal) signals.push(signal)
        }
      })

      let storedCount = 0
      if (signals.length) {
        const activeLease = await GmailSyncJob.exists({ ...ownedLease, status: 'PROCESSING' })
        const activeConnection = await GoogleConnection.exists({ _id: connection.id, userId, status: 'SYNCING' })
        if (!activeLease || !activeConnection) return getSyncJob(userId)
        // Sanitized page signals go to the Redis write buffer first; the drain
        // worker upserts them. A Redis outage falls back to a direct bulk write.
        storedCount = await writeSignalPage('gmail', signals, userId)
      }

      const processedCount = state.processedBefore + messages.length
      const historyPageCount = state.historyPageCount + (incremental ? 1 : 0)
      const reachedLimit = processedCount >= getMessageLimit() || (incremental && historyPageCount >= getHistoryPageLimit())
      const hasMore = Boolean(page.providerNextPageToken) || page.truncated
      const nextPageToken = reachedLimit ? null : page.providerNextPageToken
      const completed = !nextPageToken
      const lastErrorCode = failedCount
        ? 'PARTIAL_METADATA_RESULTS'
        : reachedLimit && hasMore
          ? 'MESSAGE_LIMIT_REACHED'
          : null

      const updatedJob = await GmailSyncJob.findOneAndUpdate(
        { ...ownedLease, status: 'PROCESSING' },
        {
          $inc: { metadataFailedCount: failedCount, processedCount: messages.length, storedCount },
          $set: {
            completedAt: completed ? new Date() : null,
            historyLatestId: page.historyLatestId,
            historyPageCount,
            lastErrorCode,
            nextPageToken,
            status: completed ? 'COMPLETED' : 'QUEUED',
          },
        },
        { returnDocument: 'after', runValidators: true },
      )

      if (!updatedJob) return getSyncJob(userId)

      if (completed) {
        await drainBufferedOrderWrites()
        // A run with failed metadata fetches keeps the previous baseline so the
        // next incremental sync retries those messages (writes are idempotent).
        // Only incremental runs hold it back: a full scan cannot retry old mail
        // through history, and holding it would force a full rescan per push.
        const runFailed = state.metadataFailedCount + failedCount > 0
        // history.list is oldest-first, so a capped incremental run skipped the
        // newest mail. Drop the baseline so the next push runs the full scan,
        // which reads the newest messages and records a fresh baseline.
        const truncatedHistory = incremental && reachedLimit && hasMore
        let baselineUpdate = {}
        if (truncatedHistory) baselineUpdate = { gmailHistoryId: null, gmailHistoryIdUpdatedAt: null }
        else if (page.historyLatestId && !(incremental && runFailed)) {
          baselineUpdate = { gmailHistoryId: page.historyLatestId, gmailHistoryIdUpdatedAt: new Date() }
        }
        await GoogleConnection.updateOne(
          { _id: connection.id, userId, status: 'SYNCING' },
          { $set: { ...baselineUpdate, lastErrorCode, lastSyncAt: new Date(), status: 'CONNECTED' } },
        )
      }

      return updatedJob
    })

    if (updatedJob?.status === 'COMPLETED') {
      await discoverAccountsForUser(userId)
      await syncSubscriptionsForUser(userId)
    }
    return updatedJob
  } catch (error) {
    const failed = await GmailSyncJob.updateOne(
      { ...ownedLease, status: { $in: ['SCANNING', 'PROCESSING', 'COMPLETED'] } },
      { $set: { lastErrorCode: error.code || 'GMAIL_SYNC_FAILED', status: 'FAILED' } },
    )
    // A rate limit is transient: keep the mailbox usable; the safety poll / next push retries.
    if (failed.matchedCount && error.code === 'GOOGLE_RATE_LIMITED') {
      await GoogleConnection.updateOne(
        { _id: job.connectionId, userId, status: { $ne: 'DISCONNECTING' } },
        { $set: { lastErrorCode: error.code } },
      )
    } else if (failed.matchedCount && error.code !== 'GOOGLE_RECONNECT_REQUIRED') {
      await GoogleConnection.updateOne(
        { _id: job.connectionId, userId, status: { $ne: 'DISCONNECTING' } },
        { $set: { lastErrorCode: error.code || 'GMAIL_SYNC_FAILED', status: 'ERROR' } },
      )
    }
    throw error
  } finally {
    releaseBarrier()
    activeBatchBarriers.delete(barrierKey)
  }
}

async function cancelSync(userId) {
  const job = await GmailSyncJob.findOneAndUpdate(
    { userId, status: { $in: ['QUEUED', 'SCANNING', 'PROCESSING'] } },
    { $set: { completedAt: new Date(), leaseId: crypto.randomUUID(), nextPageToken: null, pushPending: false, status: 'CANCELLED' } },
    { returnDocument: 'after' },
  )

  if (job) {
    await GoogleConnection.updateOne(
      { _id: job.connectionId, userId, status: 'SYNCING' },
      { $set: { lastErrorCode: null, status: 'CONNECTED' } },
    )
  }

  return job
}

async function cancelAndWaitForSync(userId) {
  const job = await cancelSync(userId)
  await Promise.all([...activeBatchBarriers.entries()]
    .filter(([key]) => key.startsWith(`${userId}:`))
    .map(([, barrier]) => barrier))
  return job
}

export {
  cancelAndWaitForSync,
  cancelSync,
  deriveSignal,
  deriveSubjectSignal,
  getSyncPolicy,
  getSyncJob,
  parseSender,
  processNextBatch,
  startIncrementalSync,
  startSync,
}
