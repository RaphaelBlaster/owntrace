import { google } from 'googleapis'
import mongoose from 'mongoose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GMAIL_METADATA_SCOPE } from '../src/config/google.js'
import GmailSignal from '../src/models/gmail-signal.model.js'
import GmailSyncJob from '../src/models/gmail-sync-job.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import { processNextBatch, startIncrementalSync, startSync } from '../src/services/gmail-sync.service.js'
import { ensureGmailPush } from '../src/services/google-push.service.js'
import { queuePushSync } from '../src/services/mail-push-sync.service.js'
import { encryptSecret } from '../src/utils/encryption.js'

beforeAll(async () => { await Promise.all([GoogleConnection.init(), GmailSyncJob.init(), GmailSignal.init()]) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function connect(extra = {}) {
  const userId = new mongoose.Types.ObjectId()
  await GoogleConnection.create({
    userId,
    email: 'history@example.com',
    googleAccountId: `history-${userId}`,
    scopes: [GMAIL_METADATA_SCOPE],
    encryptedAccessToken: encryptSecret('synthetic-access'),
    encryptedRefreshToken: encryptSecret('synthetic-refresh'),
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    ...extra,
  })
  return userId
}

const metadata = (id) => ({ id, threadId: `thread-${id}`, internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'billing@netflix.com' }, { name: 'Subject', value: `Receipt ${id}` }] } })
const added = (id, labelIds = ['INBOX']) => ({ messagesAdded: [{ message: { id, threadId: `thread-${id}`, labelIds } }] })

function mockGmail({ history, list, get, getProfile } = {}) {
  const api = {
    getProfile: getProfile || vi.fn().mockResolvedValue({ data: { historyId: '500' } }),
    history: { list: history || vi.fn() },
    messages: {
      list: list || vi.fn().mockResolvedValue({ data: { messages: [{ id: 'full-1' }, { id: 'full-2' }], resultSizeEstimate: 2 } }),
      get: get || vi.fn(({ id }) => Promise.resolve({ data: metadata(id) })),
    },
  }
  vi.spyOn(google, 'gmail').mockReturnValue({ users: api })
  return api
}

async function runToEnd(userId) {
  let job
  for (let index = 0; index < 20; index += 1) {
    job = await processNextBatch(userId)
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return job
  }
  return job
}

const storedHistoryId = async (userId) => (await GoogleConnection.findOne({ userId }).select('+gmailHistoryId')).gmailHistoryId

describe('Gmail history-based incremental sync', () => {
  it('records a baseline on a full scan and then reads only added messages on a push', async () => {
    const userId = await connect()
    const api = mockGmail()
    await startSync(userId)
    expect(await runToEnd(userId)).toMatchObject({ status: 'COMPLETED', syncMode: 'FULL', processedCount: 2 })
    expect(api.getProfile).toHaveBeenCalledTimes(1)
    expect(await storedHistoryId(userId)).toBe('500')

    api.messages.list.mockClear()
    api.messages.get.mockClear()
    api.history.list
      .mockResolvedValueOnce({ data: { history: [added('new-1'), added('new-1'), added('spam-1', ['SPAM'])], nextPageToken: 'h2', historyId: '510' } })
      .mockResolvedValueOnce({ data: { history: [added('new-2')], historyId: '520' } })

    const queued = await startSync(userId, { trigger: 'push' })
    expect(queued.syncMode).toBe('INCREMENTAL')
    const job = await runToEnd(userId)
    expect(job).toMatchObject({ status: 'COMPLETED', syncMode: 'INCREMENTAL', processedCount: 2, lastErrorCode: null })
    expect(api.messages.list).not.toHaveBeenCalled()
    expect(api.messages.get.mock.calls.map(([args]) => args.id)).toEqual(['new-1', 'new-2'])
    expect(api.messages.get.mock.calls.every(([args]) => args.format === 'metadata')).toBe(true)
    expect(api.history.list.mock.calls.map(([args]) => [args.startHistoryId, args.pageToken, args.historyTypes])).toEqual([
      ['500', undefined, ['messageAdded']],
      ['500', 'h2', ['messageAdded']],
    ])
    expect(await storedHistoryId(userId)).toBe('520')
    expect(job.toJSON()).not.toHaveProperty('historyStartId')
  })

  it('falls back to the full scan when Gmail rejects the stored historyId', async () => {
    const userId = await connect({ gmailHistoryId: '42', lastSyncAt: new Date(Date.now() - 3_600_000) })
    const expired = Object.assign(new Error('Requested entity was not found.'), { code: 404, response: { status: 404 } })
    const api = mockGmail({ history: vi.fn().mockRejectedValue(expired), getProfile: vi.fn().mockResolvedValue({ data: { historyId: '900' } }) })
    await startIncrementalSync(userId)
    const job = await runToEnd(userId)
    expect(job).toMatchObject({ status: 'COMPLETED', syncMode: 'FULL', processedCount: 2 })
    expect(api.history.list).toHaveBeenCalledTimes(1)
    expect(api.messages.list).toHaveBeenCalledTimes(1)
    expect(await storedHistoryId(userId)).toBe('900')
  })

  it('keeps the existing full scan for pushes when no historyId is stored', async () => {
    const userId = await connect({ lastSyncAt: new Date(Date.now() - 3_600_000) })
    const api = mockGmail({ getProfile: vi.fn().mockRejectedValue(new Error('profile unavailable')) })
    await queuePushSync('gmail', userId)
    const job = await runToEnd(userId)
    expect(job).toMatchObject({ status: 'COMPLETED', syncMode: 'FULL', processedCount: 2 })
    expect(api.history.list).not.toHaveBeenCalled()
    expect(api.messages.list).toHaveBeenCalledTimes(1)
    expect(await storedHistoryId(userId)).toBeNull()
  })

  it('routes pushes and safety polls through the incremental path once a baseline exists', async () => {
    const userId = await connect({ gmailHistoryId: '700', lastSyncAt: new Date(Date.now() - 3_600_000) })
    const api = mockGmail({ history: vi.fn().mockResolvedValue({ data: { historyId: '701' } }) })
    await queuePushSync('gmail', userId)
    expect(await runToEnd(userId)).toMatchObject({ status: 'COMPLETED', syncMode: 'INCREMENTAL', processedCount: 0 })
    expect(api.messages.list).not.toHaveBeenCalled()
    expect(api.messages.get).not.toHaveBeenCalled()
    expect(await storedHistoryId(userId)).toBe('701')
  })

  it('does not advance the baseline when added messages could not be fetched', async () => {
    const userId = await connect({ gmailHistoryId: '300', lastSyncAt: new Date(Date.now() - 3_600_000) })
    const get = vi.fn(({ id }) => id === 'broken' ? Promise.reject(Object.assign(new Error('backend'), { response: { status: 500 } })) : Promise.resolve({ data: metadata(id) }))
    mockGmail({ get, history: vi.fn().mockResolvedValue({ data: { history: [added('ok'), added('broken')], historyId: '310' } }) })
    await startSync(userId, { trigger: 'push' })
    expect(await runToEnd(userId)).toMatchObject({ status: 'COMPLETED', lastErrorCode: 'PARTIAL_METADATA_RESULTS' })
    expect(await storedHistoryId(userId)).toBe('300')
  })

  it('drops the baseline when the message limit truncates an incremental run', async () => {
    vi.stubEnv('GMAIL_SYNC_MESSAGE_LIMIT', '25')
    const userId = await connect({ gmailHistoryId: '400', lastSyncAt: new Date(Date.now() - 3_600_000) })
    const api = mockGmail({ history: vi.fn().mockResolvedValue({ data: { history: Array.from({ length: 26 }, (_, index) => added(`m-${index}`)), historyId: '450' } }) })
    await startSync(userId, { trigger: 'push' })
    expect(await runToEnd(userId)).toMatchObject({ status: 'COMPLETED', syncMode: 'INCREMENTAL', processedCount: 25, lastErrorCode: 'MESSAGE_LIMIT_REACHED' })
    expect(await storedHistoryId(userId)).toBeNull()
    expect((await startSync(userId, { trigger: 'push' })).syncMode).toBe('FULL')
    await runToEnd(userId)
    expect(api.messages.list).toHaveBeenCalledTimes(1)
    expect(await storedHistoryId(userId)).toBe('500')
  })

  it('still records the baseline when a full scan has failed metadata fetches', async () => {
    const userId = await connect({ lastSyncAt: new Date(Date.now() - 3_600_000) })
    const get = vi.fn(({ id }) => id === 'full-2' ? Promise.reject(Object.assign(new Error('backend'), { response: { status: 500 } })) : Promise.resolve({ data: metadata(id) }))
    mockGmail({ get })
    await startSync(userId)
    expect(await runToEnd(userId)).toMatchObject({ status: 'COMPLETED', syncMode: 'FULL', lastErrorCode: 'PARTIAL_METADATA_RESULTS' })
    expect(await storedHistoryId(userId)).toBe('500')
  })

  it('keeps user-started scans as full scans even with a stored baseline', async () => {
    const userId = await connect({ gmailHistoryId: '100', lastSyncAt: new Date(Date.now() - 3_600_000) })
    const api = mockGmail()
    expect((await startSync(userId)).syncMode).toBe('FULL')
    await runToEnd(userId)
    expect(api.history.list).not.toHaveBeenCalled()
    expect(await storedHistoryId(userId)).toBe('500')
  })

  it('stores the users.watch historyId without replacing the sync baseline', async () => {
    vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/test-project/topics/mail')
    vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', 'https://api.example.test/api/provider-notifications/google')
    vi.stubEnv('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL', 'push@test-project.iam.gserviceaccount.com')
    const userId = await connect({ gmailHistoryId: '100' })
    const watch = vi.fn().mockResolvedValue({ data: { historyId: '800', expiration: String(Date.now() + 86_400_000) } })
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { watch } })
    await ensureGmailPush(userId)
    const connection = await GoogleConnection.findOne({ userId }).select('+gmailHistoryId +gmailWatchHistoryId')
    expect(connection).toMatchObject({ gmailHistoryId: '100', gmailWatchHistoryId: '800', pushStatus: 'ACTIVE' })
    expect(connection.toJSON()).not.toHaveProperty('gmailWatchHistoryId')
  })
})
