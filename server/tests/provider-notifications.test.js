import crypto from 'node:crypto'
import request from 'supertest'
import { google } from 'googleapis'
import mongoose from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import GmailSyncJob from '../src/models/gmail-sync-job.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import MicrosoftSyncJob from '../src/models/microsoft-sync-job.model.js'
import MicrosoftSignal from '../src/models/microsoft-signal.model.js'
import { getTokenEncryptionKey } from '../src/config/google.js'
import { encryptSecret } from '../src/utils/encryption.js'
import { processNextBatch as processMicrosoftBatch, startSync as startMicrosoftSync } from '../src/services/microsoft-sync.service.js'
import { deleteMicrosoftPush, ensureMicrosoftPush } from '../src/services/microsoft-push.service.js'
import { getConnectionForUser } from '../src/services/microsoft-oauth.service.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('provider push notifications', () => {
  it('renews and deletes the existing Microsoft subscription using its hidden identifier', async () => {
    vi.stubEnv('PUBLIC_API_URL', 'https://api.example.test')
    const userId = new mongoose.Types.ObjectId()
    await MicrosoftConnection.create({
      userId,
      microsoftAccountId: 'microsoft-renew-user',
      email: 'microsoft-renew@example.com',
      encryptedAccessToken: encryptSecret('access-token'),
      encryptedRefreshToken: encryptSecret('refresh-token'),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      graphSubscriptionId: 'existing-subscription',
      graphSubscriptionExpiresAt: new Date(Date.now() + 60_000),
      pushStatus: 'ACTIVE',
    })
    const expires = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ expirationDateTime: expires })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await ensureMicrosoftPush(userId)
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/subscriptions/existing-subscription')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    const connection = await getConnectionForUser(userId, true)
    expect(connection.toJSON()).not.toHaveProperty('graphSubscriptionId')
    await deleteMicrosoftPush(connection)
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('validates Microsoft Graph webhook challenges without browser auth', async () => {
    const response = await request(app).post('/api/provider-notifications/microsoft?validationToken=challenge-123').expect(200)
    expect(response.text).toBe('challenge-123')
    expect(response.headers['content-type']).toContain('text/plain')
  })

  it('rejects Gmail Pub/Sub pushes without an OIDC bearer token', async () => {
    vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/test-project/topics/mail')
    vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', 'https://api.example.test/api/provider-notifications/google')
    vi.stubEnv('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL', 'push@test-project.iam.gserviceaccount.com')
    await request(app).post('/api/provider-notifications/google').send({ message: { data: 'e30=' } }).expect(401)
  })

  it('queues Gmail sync after validating Pub/Sub OIDC and mailbox identity', async () => {
    vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/test-project/topics/mail')
    vi.stubEnv('GMAIL_PUBSUB_AUDIENCE', 'https://api.example.test/api/provider-notifications/google')
    vi.stubEnv('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL', 'push@test-project.iam.gserviceaccount.com')
    vi.spyOn(google.auth.OAuth2.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ email: 'push@test-project.iam.gserviceaccount.com', email_verified: true }),
    })
    const userId = new mongoose.Types.ObjectId()
    const connection = await GoogleConnection.create({
      userId,
      googleAccountId: 'gmail-push-user',
      email: 'gmail-push@example.com',
      encryptedAccessToken: 'encrypted-access',
      encryptedRefreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    })
    const data = Buffer.from(JSON.stringify({ emailAddress: 'GMAIL-PUSH@example.com', historyId: '123' })).toString('base64')

    await request(app).post('/api/provider-notifications/google').set('Authorization', 'Bearer signed-push-token').send({ message: { data } }).expect(204)
    const job = await GmailSyncJob.findOne({ userId }).lean()
    expect(job.status).toBe('QUEUED')
    expect(job.connectionId.toString()).toBe(connection.id)
  })

  it('validates Microsoft clientState before queuing a scan', async () => {
    const userId = new mongoose.Types.ObjectId()
    const clientState = crypto.randomBytes(32).toString('base64url')
    const hash = crypto.createHmac('sha256', getTokenEncryptionKey()).update(clientState).digest('hex')
    await MicrosoftConnection.create({
      userId,
      microsoftAccountId: 'microsoft-push-user',
      email: 'microsoft-push@example.com',
      encryptedAccessToken: 'encrypted-access',
      encryptedRefreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      graphSubscriptionId: 'graph-subscription-1',
      graphClientStateHash: hash,
    })

    await request(app).post('/api/provider-notifications/microsoft').send({ value: [{ subscriptionId: 'graph-subscription-1', clientState: 'wrong-state' }] }).expect(202)
    expect(await MicrosoftSyncJob.countDocuments({ userId })).toBe(0)
    await request(app).post('/api/provider-notifications/microsoft').send({ value: [{ subscriptionId: 'graph-subscription-1', clientState }] }).expect(202)
    expect(await MicrosoftSyncJob.findOne({ userId })).toMatchObject({ status: 'QUEUED' })
  })

  it('respects the remaining Microsoft message budget on the final page', async () => {
    vi.stubEnv('MICROSOFT_SYNC_MESSAGE_LIMIT', '37')
    const userId = new mongoose.Types.ObjectId()
    await MicrosoftConnection.create({
      userId,
      microsoftAccountId: 'microsoft-budget-user',
      email: 'microsoft-budget@example.com',
      encryptedAccessToken: encryptSecret('access-token'),
      encryptedRefreshToken: encryptSecret('refresh-token'),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    })
    const messages = (start, count) => Array.from({ length: count }, (_, index) => ({
      id: `message-${start + index}`,
      conversationId: `thread-${start + index}`,
      from: { emailAddress: { address: `sender${start + index}@example.org` } },
      receivedDateTime: '2026-10-25T10:00:00Z',
      subject: 'Monthly billing receipt',
    }))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: messages(0, 25), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: messages(25, 25), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=remaining' }))))

    await startMicrosoftSync(userId)
    await processMicrosoftBatch(userId)
    const lastPage = await processMicrosoftBatch(userId)
    expect(lastPage).toMatchObject({ processedCount: 37, status: 'COMPLETED', lastErrorCode: 'MESSAGE_LIMIT_REACHED' })
    expect(await MicrosoftSignal.countDocuments({ userId })).toBe(37)
  })
})
