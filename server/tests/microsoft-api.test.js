import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import Account from '../src/models/account.model.js'
import AccountEvidence from '../src/models/account-evidence.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import MicrosoftSignal from '../src/models/microsoft-signal.model.js'
import MicrosoftSyncJob from '../src/models/microsoft-sync-job.model.js'
import MicrosoftSubscription from '../src/models/microsoft-subscription.model.js'
import Subscription from '../src/models/subscription.model.js'
import User from '../src/models/user.model.js'
import { decryptSecret, encryptSecret } from '../src/utils/encryption.js'

const password = 'microsoft API test password'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function register(email) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({ email, name: 'Microsoft API Test', password }).expect(201)
  return { agent, userId: response.body.user.id }
}

describe('Microsoft integration API', () => {
  it.each(['original-account', 'different-account'])('does not reuse another Microsoft identity\'s refresh token: %s', async (identity) => {
    const { agent, userId } = await register('microsoft-reconnect@example.com')
    await MicrosoftConnection.create({ userId, microsoftAccountId: 'original-account', email: 'microsoft-reconnect@example.com', encryptedAccessToken: encryptSecret('original-access'), encryptedRefreshToken: encryptSecret('original-refresh'), scopes: ['Mail.ReadBasic'], tokenExpiresAt: new Date(Date.now() + 3_600_000) })
    const start = await agent.get('/api/microsoft/oauth/start').expect(302)
    const state = new URL(start.headers.location).searchParams.get('state')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'replacement-access', expires_in: 3600, scope: 'Mail.ReadBasic' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: identity, mail: 'microsoft-reconnect@example.com' }))))
    const callback = await agent.get(`/api/microsoft/oauth/callback?code=synthetic-code&state=${encodeURIComponent(state)}`).expect(302)
    expect(callback.headers.location).toContain(identity === 'original-account' ? 'microsoft=connected' : 'microsoft=microsoft_account_mismatch')
    const stored = await MicrosoftConnection.findOne({ userId }).select('+encryptedAccessToken +encryptedRefreshToken')
    expect(stored.microsoftAccountId).toBe('original-account')
    expect(decryptSecret(stored.encryptedRefreshToken)).toBe('original-refresh')
    expect(decryptSecret(stored.encryptedAccessToken)).toBe(identity === 'original-account' ? 'replacement-access' : 'original-access')
  })

  it('requires authentication for every Microsoft integration route', async () => {
    await Promise.all([
      request(app).get('/api/microsoft/connection').expect(401),
      request(app).get('/api/microsoft/sync').expect(401),
      request(app).post('/api/microsoft/sync').expect(401),
      request(app).post('/api/microsoft/sync/next').expect(401),
      request(app).delete('/api/microsoft/sync').expect(401),
      request(app).delete('/api/microsoft/connection').expect(401),
      request(app).get('/api/microsoft/subscriptions').expect(401),
    ])
  })

  it('serializes only safe connection data and scopes subscriptions to the signed-in user', async () => {
    const first = await register('microsoft-api-first@example.com')
    const second = await register('microsoft-api-second@example.com')
    await MicrosoftConnection.create({
      userId: first.userId, microsoftAccountId: 'microsoft-api-account', email: 'microsoft-api-first@example.com',
      encryptedAccessToken: encryptSecret('private-access-token'), encryptedRefreshToken: encryptSecret('private-refresh-token'),
      scopes: ['Mail.ReadBasic'], tokenExpiresAt: new Date(Date.now() + 3_600_000),
    })
    await Promise.all([
      MicrosoftSubscription.create({ userId: first.userId, serviceKey: 'private.example', serviceName: 'Private Service', primaryDomain: 'private.example', basis: ['SUBSCRIPTION'], confidenceLevel: 'POSSIBLE', confidenceScore: 35, evidenceCount: 1, firstSeenAt: new Date('2026-02-01'), lastSeenAt: new Date('2026-02-01') }),
      Subscription.create({ userId: first.userId, serviceKey: 'private.example', serviceName: 'Private Service', primaryDomain: 'private.example', basis: ['PAYMENT'], billingCycle: 'MONTHLY', confidenceLevel: 'POSSIBLE', confidenceScore: 35, evidenceCount: 2, firstSeenAt: new Date('2026-01-01'), lastPaymentAt: new Date('2026-01-20'), lastSeenAt: new Date('2026-01-20') }),
      MicrosoftSubscription.create({ userId: second.userId, serviceKey: 'other.example', serviceName: 'Other Service', primaryDomain: 'other.example', confidenceLevel: 'POSSIBLE', confidenceScore: 35, evidenceCount: 1, firstSeenAt: new Date(), lastSeenAt: new Date() }),
    ])

    const connection = await first.agent.get('/api/microsoft/connection').expect(200)
    expect(connection.body.microsoft.connection).toMatchObject({ email: 'microsoft-api-first@example.com', status: 'CONNECTED' })
    expect(JSON.stringify(connection.body)).not.toContain('private-access-token')
    expect(JSON.stringify(connection.body)).not.toContain('private-refresh-token')
    expect(connection.body.microsoft.connection).not.toHaveProperty('microsoftAccountId')

    const subscriptions = await first.agent.get('/api/microsoft/subscriptions?page=1&limit=1').expect(200)
    expect(subscriptions.body.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 })
    expect(subscriptions.body.subscriptions[0].serviceName).toBe('Private Service')
    expect(JSON.stringify(subscriptions.body)).not.toContain('Other Service')
    await first.agent.get('/api/microsoft/subscriptions?limit=51').expect(400)
    await first.agent.get('/api/microsoft/subscriptions?unexpected=value').expect(400)

    const unifiedSubscriptions = await first.agent.get('/api/subscriptions?page=1&limit=12').expect(200)
    expect(unifiedSubscriptions.body.pagination).toMatchObject({ total: 1 })
    expect(unifiedSubscriptions.body.subscriptions).toMatchObject([
      { basis: ['PAYMENT', 'SUBSCRIPTION'], billingCycle: 'MONTHLY', confidenceLevel: 'LIKELY', confidenceScore: 95, evidenceCount: 3, firstSeenAt: '2026-01-01T00:00:00.000Z', lastPaymentAt: '2026-01-20T00:00:00.000Z', lastSeenAt: '2026-02-01T00:00:00.000Z', serviceName: 'Private Service', source: 'MULTI_PROVIDER_METADATA' },
    ])
  })

  it('completes session-bound OAuth and records Microsoft as a connected provider', async () => {
    const first = await register('microsoft-oauth@example.com')
    const start = await first.agent.get('/api/microsoft/oauth/start').expect(302)
    const authorizationUrl = new URL(start.headers.location)
    const state = authorizationUrl.searchParams.get('state')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, scope: 'openid profile email offline_access User.Read Mail.ReadBasic' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'microsoft-account', mail: 'microsoft-oauth@example.com' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const callback = await first.agent.get(`/api/microsoft/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`).expect(302)
    expect(callback.headers.location).toBe('http://localhost:5173/connect/microsoft?microsoft=connected')
    expect((await User.findById(first.userId)).authProviders).toContain('microsoft')
    expect(await MicrosoftConnection.countDocuments({ userId: first.userId })).toBe(1)
  })

  it('atomically rejects a second active sync start and stores one metadata batch', async () => {
    const first = await register('microsoft-sync@example.com')
    await MicrosoftConnection.create({
      userId: first.userId, microsoftAccountId: 'microsoft-sync-account', email: 'microsoft-sync@example.com',
      encryptedAccessToken: encryptSecret('private-access-token'), encryptedRefreshToken: encryptSecret('private-refresh-token'),
      scopes: ['Mail.ReadBasic'], tokenExpiresAt: new Date(Date.now() + 3_600_000),
    })
    const starts = await Promise.all([
      first.agent.post('/api/microsoft/sync'),
      first.agent.post('/api/microsoft/sync'),
    ])
    expect(starts.map((response) => response.status).sort()).toEqual([202, 409])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      value: [{
        id: 'provider-message', conversationId: 'provider-thread',
        from: { emailAddress: { address: 'billing@example.com' } },
        receivedDateTime: '2026-08-01T00:00:00Z', subject: 'Monthly payment receipt USD 12.99',
      }],
    }), { status: 200 })))
    const batch = await first.agent.post('/api/microsoft/sync/next').expect(200)
    expect(batch.body.sync).toMatchObject({ processedCount: 1, storedCount: 1, status: 'COMPLETED' })
    expect(await MicrosoftSignal.countDocuments({ userId: first.userId })).toBe(1)
    expect(await Account.countDocuments({ userId: first.userId })).toBe(1)
    expect(await AccountEvidence.countDocuments({ userId: first.userId })).toBe(1)
    expect(await MicrosoftSyncJob.countDocuments({ userId: first.userId })).toBe(1)
  })

  it('cancels a scan by removing only signals inserted by its run', async () => {
    const first = await register('microsoft-cancel@example.com')
    const connection = await MicrosoftConnection.create({
      userId: first.userId, microsoftAccountId: 'microsoft-cancel-account', email: 'microsoft-cancel@example.com',
      encryptedAccessToken: encryptSecret('private-access-token'), encryptedRefreshToken: encryptSecret('private-refresh-token'),
      scopes: ['Mail.ReadBasic'], tokenExpiresAt: new Date(Date.now() + 3_600_000),
    })
    await first.agent.post('/api/microsoft/sync').expect(202)
    const job = await MicrosoftSyncJob.findOne({ userId: first.userId }).select('+runId')
    await MicrosoftSignal.create([
      { userId: first.userId, connectionId: connection.id, messageIdHash: 'current-run', threadIdHash: 'current-thread', occurredAt: new Date(), syncRunId: job.runId },
      { userId: first.userId, connectionId: connection.id, messageIdHash: 'previous-run', threadIdHash: 'previous-thread', occurredAt: new Date(), syncRunId: 'completed-earlier-run' },
    ])

    const cancelled = await first.agent.delete('/api/microsoft/sync').expect(200)
    expect(cancelled.body.sync.status).toBe('CANCELLED')
    expect(await MicrosoftSignal.countDocuments({ userId: first.userId, messageIdHash: 'current-run' })).toBe(0)
    expect(await MicrosoftSignal.countDocuments({ userId: first.userId, messageIdHash: 'previous-run' })).toBe(1)
  })
})
