import mongoose from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import MicrosoftSignal from '../src/models/microsoft-signal.model.js'
import MicrosoftSubscription from '../src/models/microsoft-subscription.model.js'
import User from '../src/models/user.model.js'
import { listMicrosoftSubscriptionsForUser, syncMicrosoftSubscriptions } from '../src/services/microsoft-subscription.service.js'
import { disconnectMicrosoft, withMicrosoftAccessToken } from '../src/services/microsoft-oauth.service.js'
import { deriveSignal, getGraphPageUrl } from '../src/services/microsoft-sync.service.js'
import MicrosoftSyncJob from '../src/models/microsoft-sync-job.model.js'
import { decryptSecret, encryptSecret } from '../src/utils/encryption.js'

async function createUser(email) {
  return User.create({ email, name: 'Microsoft Test', passwordHash: 'not-a-real-password-hash' })
}

async function createConnection(userId, accountId) {
  return MicrosoftConnection.create({
    userId, microsoftAccountId: accountId, email: `${accountId}@example.com`,
    encryptedAccessToken: 'v1.test.test.test', encryptedRefreshToken: 'v1.test.test.test',
    scopes: ['Mail.ReadBasic'], tokenExpiresAt: new Date(Date.now() + 3_600_000),
  })
}

describe('Microsoft metadata subscriptions', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('only accepts Graph pagination links and never uses an arbitrary stored URL', () => {
    expect(getGraphPageUrl(null)).toContain('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages')
    expect(getGraphPageUrl('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=safe')).toContain('$skiptoken=safe')
    expect(getGraphPageUrl("https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages?$skiptoken=safe")).toContain('$skiptoken=safe')
    expect(() => getGraphPageUrl('https://graph.microsoft.com/v1.0/me/messages?$skiptoken=safe')).toThrow('invalid mailbox page')
    expect(() => getGraphPageUrl('https://attacker.example/collect')).toThrow('invalid mailbox page')
    expect(() => getGraphPageUrl('https://graph.microsoft.com/beta/me/messages')).toThrow('invalid mailbox page')
  })

  it('derives a metadata-only signal without retaining Microsoft provider IDs', () => {
    const signal = deriveSignal(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), {
      id: 'provider-message-id', conversationId: 'provider-conversation-id',
      from: { emailAddress: { address: 'billing@example.com' } },
      receivedDateTime: '2026-08-01T00:00:00Z', subject: 'Monthly payment receipt INR 1299',
    })
    expect(signal).toMatchObject({ billingAmountMinor: 129_900, billingCurrency: 'INR', billingCycle: 'MONTHLY', subjectSignal: 'monthly payment receipt inr [number]' })
    expect(JSON.stringify(signal)).not.toContain('provider-message-id')
    expect(JSON.stringify(signal)).not.toContain('provider-conversation-id')
  })

  it('projects user-scoped, paginated subscriptions and removes stale projections', async () => {
    const first = await createUser('microsoft-first@example.com')
    const second = await createUser('microsoft-second@example.com')
    const firstConnection = await createConnection(first.id, 'microsoft-one')
    const secondConnection = await createConnection(second.id, 'microsoft-two')
    await MicrosoftSignal.create([
      { userId: first.id, connectionId: firstConnection.id, messageIdHash: 'first-1', threadIdHash: 'first-thread-1', senderEmail: 'billing@netflix.com', senderDomain: 'billing.netflix.com', subjectSignal: 'monthly payment receipt inr [number]', billingAmountMinor: 49_900, billingCurrency: 'INR', billingCycle: 'MONTHLY', occurredAt: new Date('2026-01-20') },
      { userId: first.id, connectionId: firstConnection.id, messageIdHash: 'first-2', threadIdHash: 'first-thread-2', senderEmail: 'notice@netflix.com', senderDomain: 'notice.netflix.com', subjectSignal: 'monthly subscription renewal', billingCycle: 'MONTHLY', occurredAt: new Date('2026-02-20') },
      { userId: second.id, connectionId: secondConnection.id, messageIdHash: 'second-1', threadIdHash: 'second-thread-1', senderEmail: 'billing@spotify.com', senderDomain: 'billing.spotify.com', subjectSignal: 'monthly payment receipt usd [number]', billingAmountMinor: 999, billingCurrency: 'USD', billingCycle: 'MONTHLY', occurredAt: new Date('2026-02-20') },
    ])
    expect(await syncMicrosoftSubscriptions(first.id)).toEqual({ processedSignalCount: 2, subscriptionCount: 1 })
    await syncMicrosoftSubscriptions(second.id)
    const page = await listMicrosoftSubscriptionsForUser(first.id, { page: '1', limit: '1' })
    expect(page.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 })
    expect(page.subscriptions[0]).toMatchObject({ source: 'MICROSOFT_METADATA', serviceName: 'Netflix', amountMinor: 49_900, currency: 'INR', billingCycle: 'MONTHLY', evidenceCount: 2 })
    expect(JSON.stringify(page)).not.toContain('Spotify')
    expect(page.subscriptions[0]).not.toHaveProperty('userId')
    await MicrosoftSignal.deleteMany({ userId: first.id })
    await syncMicrosoftSubscriptions(first.id)
    expect(await MicrosoftSubscription.countDocuments({ userId: first.id })).toBe(0)
    expect(await MicrosoftSubscription.countDocuments({ userId: second.id })).toBe(1)
  })

  it('deletes only the disconnected user’s Microsoft-derived data', async () => {
    const first = await createUser('microsoft-cleanup-first@example.com')
    const second = await createUser('microsoft-cleanup-second@example.com')
    const firstConnection = await createConnection(first.id, 'microsoft-cleanup-one')
    const secondConnection = await createConnection(second.id, 'microsoft-cleanup-two')
    await Promise.all([
      MicrosoftSignal.create({ userId: first.id, connectionId: firstConnection.id, messageIdHash: 'cleanup-one', threadIdHash: 'cleanup-thread-one', occurredAt: new Date() }),
      MicrosoftSignal.create({ userId: second.id, connectionId: secondConnection.id, messageIdHash: 'cleanup-two', threadIdHash: 'cleanup-thread-two', occurredAt: new Date() }),
      MicrosoftSyncJob.create({ userId: first.id, connectionId: firstConnection.id }),
      MicrosoftSubscription.create({ userId: first.id, serviceKey: 'cleanup.example', serviceName: 'Cleanup', primaryDomain: 'cleanup.example', confidenceLevel: 'POSSIBLE', confidenceScore: 35, evidenceCount: 1, firstSeenAt: new Date(), lastSeenAt: new Date() }),
    ])
    await disconnectMicrosoft(first.id)
    expect(await MicrosoftConnection.countDocuments({ userId: first.id })).toBe(0)
    expect(await MicrosoftSignal.countDocuments({ userId: first.id })).toBe(0)
    expect(await MicrosoftSyncJob.countDocuments({ userId: first.id })).toBe(0)
    expect(await MicrosoftSubscription.countDocuments({ userId: first.id })).toBe(0)
    expect(await MicrosoftConnection.countDocuments({ userId: second.id })).toBe(1)
    expect(await MicrosoftSignal.countDocuments({ userId: second.id })).toBe(1)
  })

  it('serializes refresh-token rotation and marks an invalid grant as reconnect-required', async () => {
    const user = await createUser('microsoft-refresh@example.com')
    const connection = await createConnection(user.id, 'microsoft-refresh')
    await MicrosoftConnection.updateOne({ _id: connection.id }, { $set: { encryptedAccessToken: encryptSecret('expired-access'), encryptedRefreshToken: encryptSecret('old-refresh'), tokenExpiresAt: new Date(Date.now() - 60_000) } })
    const refreshFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), { status: 200 }))
    vi.stubGlobal('fetch', refreshFetch)
    const results = await Promise.all([
      withMicrosoftAccessToken(user.id, ({ accessToken }) => accessToken),
      withMicrosoftAccessToken(user.id, ({ accessToken }) => accessToken),
    ])
    expect(results).toEqual(['new-access', 'new-access'])
    expect(refreshFetch).toHaveBeenCalledTimes(1)
    const stored = await MicrosoftConnection.findById(connection.id).select('+encryptedRefreshToken')
    expect(decryptSecret(stored.encryptedRefreshToken)).toBe('new-refresh')

    await MicrosoftConnection.updateOne({ _id: connection.id }, { $set: { tokenExpiresAt: new Date(Date.now() - 60_000) } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(withMicrosoftAccessToken(user.id, () => null)).rejects.toMatchObject({ code: 'MICROSOFT_RECONNECT_REQUIRED' })
    expect((await MicrosoftConnection.findById(connection.id)).status).toBe('NEEDS_RECONNECT')
  })
})
