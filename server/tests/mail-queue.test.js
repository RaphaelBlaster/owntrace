import request from 'supertest'
import { google } from 'googleapis'
import mongoose from 'mongoose'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('../src/shared/queue.js', () => ({
  MAIL_SYNC: 'mail-sync',
  redisQueueEnabled: vi.fn(() => Boolean(process.env.REDIS_URL)),
  enqueue: vi.fn(async () => ({})),
  startWorker: vi.fn(),
  closeQueues: vi.fn(async () => {}),
}))
vi.mock('../src/services/mail-push-sync.service.js', async (original) => ({ ...await original(), queuePushSync: vi.fn(async () => true) }))

const { default: app } = await import('../src/app.js')
const { default: GoogleConnection } = await import('../src/models/google-connection.model.js')
const { enqueue } = await import('../src/shared/queue.js')
const { queuePushSync } = await import('../src/services/mail-push-sync.service.js')

let userId
beforeEach(async () => {
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/test-project/topics/mail')
  vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', 'https://api.example.test/api/provider-notifications/google')
  vi.stubEnv('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL', 'push@test-project.iam.gserviceaccount.com')
  vi.spyOn(google.auth.OAuth2.prototype, 'verifyIdToken').mockResolvedValue({
    getPayload: () => ({ email: 'push@test-project.iam.gserviceaccount.com', email_verified: true }),
  })
  userId = new mongoose.Types.ObjectId()
  await GoogleConnection.create({
    userId,
    googleAccountId: 'gmail-queue-user',
    email: 'gmail-queue@example.com',
    encryptedAccessToken: 'encrypted-access',
    encryptedRefreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); enqueue.mockClear(); queuePushSync.mockClear() })

const push = () => request(app).post('/api/provider-notifications/google').set('Authorization', 'Bearer signed-push-token')
  .send({ message: { data: Buffer.from(JSON.stringify({ emailAddress: 'gmail-queue@example.com', historyId: '987' })).toString('base64') } })

it('enqueues a verified Gmail push with a per-user dedupe id and returns 204', async () => {
  vi.stubEnv('REDIS_URL', 'redis://queue.test:6379')
  await push().expect(204)
  expect(enqueue).toHaveBeenCalledWith('mail-sync', { provider: 'gmail', userId: String(userId) }, { dedupeId: `gmail-${userId}` })
  expect(queuePushSync).not.toHaveBeenCalled()
})

it('falls back to queuePushSync when the enqueue fails', async () => {
  vi.stubEnv('REDIS_URL', 'redis://queue.test:6379')
  enqueue.mockRejectedValueOnce(new Error('ECONNREFUSED'))
  await push().expect(204)
  expect(queuePushSync).toHaveBeenCalledWith('gmail', userId)
})

it('keeps the inline path when REDIS_URL is unset', async () => {
  vi.stubEnv('REDIS_URL', '')
  await push().expect(204)
  expect(enqueue).not.toHaveBeenCalled()
  expect(queuePushSync).toHaveBeenCalledWith('gmail', userId)
})

it('rejects an unverified push before any enqueue', async () => {
  vi.stubEnv('REDIS_URL', 'redis://queue.test:6379')
  await request(app).post('/api/provider-notifications/google').send({ message: { data: 'e30=' } }).expect(401)
  expect(enqueue).not.toHaveBeenCalled()
})
