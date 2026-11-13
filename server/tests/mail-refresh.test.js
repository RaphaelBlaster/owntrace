import request from 'supertest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import GmailSyncJob from '../src/models/gmail-sync-job.model.js'
import { queuePushSync } from '../src/services/mail-push-sync.service.js'
import { resetMailRefreshState } from '../src/routes/mail-refresh.routes.js'

vi.mock('../src/services/mail-push-sync.service.js', async (original) => ({ ...(await original()), queuePushSync: vi.fn(async () => true) }))

beforeEach(() => { resetMailRefreshState(); queuePushSync.mockClear() })
afterEach(() => vi.useRealTimers())

let counter = 0
async function signedIn() {
  const agent = request.agent(app)
  const email = `refresh${counter += 1}@example.com`
  await agent.post('/api/auth/register').send({ name: 'Refresh Tester', email, password: 'StrongPass123!' }).expect(201)
  const user = await User.findOne({ email })
  return { agent, userId: user._id }
}

async function connectGmail(userId) {
  await GoogleConnection.collection.insertOne({ userId, googleAccountId: `g-${userId}`, email: 'a@gmail.com', status: 'CONNECTED', createdAt: new Date(), updatedAt: new Date() })
}

it('requires authentication', async () => {
  await request(app).post('/api/mail/sync-now').send({}).expect(401)
  expect(queuePushSync).not.toHaveBeenCalled()
})

it('rejects requests from an untrusted origin', async () => {
  const { agent } = await signedIn()
  await agent.post('/api/mail/sync-now').set('Origin', 'https://evil.example').send({}).expect(403)
  expect(queuePushSync).not.toHaveBeenCalled()
})

it('reports no mailbox when nothing is connected', async () => {
  const { agent } = await signedIn()
  const response = await agent.post('/api/mail/sync-now').send({}).expect(202)
  expect(response.body).toEqual({ queued: false, reason: 'no_mailbox' })
})

it('enqueues an incremental push sync once and coalesces repeats within 30s', async () => {
  const { agent, userId } = await signedIn()
  await connectGmail(userId)
  const first = await agent.post('/api/mail/sync-now').send({}).expect(202)
  expect(first.body).toEqual({ queued: true })
  expect(queuePushSync).toHaveBeenCalledTimes(1)
  expect(String(queuePushSync.mock.calls[0][1])).toBe(String(userId))
  expect(queuePushSync.mock.calls[0][0]).toBe('gmail')
  const second = await agent.post('/api/mail/sync-now').send({}).expect(202)
  expect(second.body).toEqual({ queued: false, reason: 'recent' })
  expect(queuePushSync).toHaveBeenCalledTimes(1)
})

it('skips a mailbox whose sync job ran in the last 30s', async () => {
  const { agent, userId } = await signedIn()
  await connectGmail(userId)
  await GmailSyncJob.collection.insertOne({ userId, status: 'COMPLETED', createdAt: new Date(), updatedAt: new Date() })
  const response = await agent.post('/api/mail/sync-now').send({}).expect(202)
  expect(response.body).toEqual({ queued: false, reason: 'recent' })
  expect(queuePushSync).not.toHaveBeenCalled()
})

it('rate limits a user to 6 requests a minute and rejects a body', async () => {
  const { agent } = await signedIn()
  await agent.post('/api/mail/sync-now').send({ force: true }).expect(400)
  for (let index = 0; index < 6; index += 1) await agent.post('/api/mail/sync-now').send({}).expect(202)
  await agent.post('/api/mail/sync-now').send({}).expect(429)
})

it('enqueues only once when two requests arrive concurrently', async () => {
  const { agent, userId } = await signedIn()
  await connectGmail(userId)
  const responses = await Promise.all([agent.post('/api/mail/sync-now').send({}), agent.post('/api/mail/sync-now').send({})])
  expect(responses.map((r) => r.status)).toEqual([202, 202])
  expect(queuePushSync).toHaveBeenCalledTimes(1)
})
