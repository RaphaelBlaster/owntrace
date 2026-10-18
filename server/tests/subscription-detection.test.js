import mongoose from 'mongoose'
import { describe, expect, it } from 'vitest'
import GmailSignal from '../src/models/gmail-signal.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import Subscription from '../src/models/subscription.model.js'
import User from '../src/models/user.model.js'
import { deriveSignal } from '../src/services/gmail-sync.service.js'
import {
  addBillingCycle,
  extractBillingMetadata,
  inferBillingCycle,
  removeSubscriptionsForUser,
  syncSubscriptionsForUser,
} from '../src/services/subscription-detection.service.js'

async function createUser(email) {
  return User.create({
    email,
    name: 'Subscription Test',
    passwordHash: 'not-a-real-password-hash',
  })
}

async function createConnection(userId, googleAccountId) {
  return GoogleConnection.create({
    email: `${googleAccountId}@example.com`,
    encryptedAccessToken: 'v1.test.test.test',
    encryptedRefreshToken: 'v1.test.test.test',
    googleAccountId,
    scopes: ['https://www.googleapis.com/auth/gmail.metadata'],
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    userId,
  })
}

async function createSignal({ connectionId, index, occurredAt, senderDomain, subject, userId }) {
  const billing = extractBillingMetadata(subject)
  return GmailSignal.create({
    billingAmountMinor: billing.amountMinor,
    billingCurrency: billing.currency,
    billingCycle: billing.billingCycle,
    connectionId,
    messageIdHash: `subscription-message-${userId}-${index}`,
    occurredAt,
    senderDomain,
    senderEmail: `billing@${senderDomain}`,
    subjectSignal: subject.toLowerCase(),
    threadIdHash: `subscription-thread-${userId}-${index}`,
    userId,
  })
}

describe('subscription detection', () => {
  it('extracts structured billing facts before masking long numbers in subject metadata', () => {
    const signal = deriveSignal(
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      {
        id: 'provider-message-id',
        internalDate: String(Date.parse('2026-08-01T00:00:00Z')),
        payload: {
          headers: [
            { name: 'From', value: 'Billing <billing@example.com>' },
            { name: 'Subject', value: 'Monthly payment receipt INR 1299' },
          ],
        },
        threadId: 'provider-thread-id',
      },
    )

    expect(signal).toMatchObject({
      billingAmountMinor: 129_900,
      billingCurrency: 'INR',
      billingCycle: 'MONTHLY',
      subjectSignal: 'monthly payment receipt inr [number]',
    })
    expect(JSON.stringify(signal)).not.toContain('provider-message-id')
    expect(signal.subjectSignal).not.toContain('1299')
  })

  it.each([
    ['Monthly payment receipt INR 499.00', { amountMinor: 49_900, billingCycle: 'MONTHLY', currency: 'INR' }],
    ['Payment complete: GBP 14.99.', { amountMinor: 1_499, billingCycle: null, currency: 'GBP' }],
    ['Annual renewal €1.299,99', { amountMinor: 129_999, billingCycle: 'YEARLY', currency: 'EUR' }],
    ['Invoice 12.50 USD every month', { amountMinor: 1_250, billingCycle: 'MONTHLY', currency: 'USD' }],
    ['Payment receipt $9.99', { amountMinor: null, billingCycle: null, currency: null }],
  ])('extracts only explainable billing facts from %s', (subject, expected) => {
    expect(extractBillingMetadata(subject)).toEqual(expected)
  })

  it('infers bounded billing intervals and clamps calendar renewal dates', () => {
    expect(inferBillingCycle([
      new Date('2026-01-15T00:00:00Z'),
      new Date('2026-02-15T00:00:00Z'),
    ])).toBe('MONTHLY')
    expect(inferBillingCycle([new Date('2026-01-15T00:00:00Z')])).toBeNull()
    expect(addBillingCycle(new Date('2026-01-31T00:00:00Z'), 'MONTHLY'))
      .toEqual(new Date('2026-02-28T00:00:00Z'))
  })

  it('creates idempotent, user-scoped subscription records from minimized evidence', async () => {
    const firstUser = await createUser('subscription-first@example.com')
    const secondUser = await createUser('subscription-second@example.com')
    const firstConnection = await createConnection(firstUser.id, 'subscription-google-one')
    const secondConnection = await createConnection(secondUser.id, 'subscription-google-two')

    await Promise.all([
      createSignal({
        connectionId: firstConnection.id,
        index: 1,
        occurredAt: new Date('2026-01-20T00:00:00Z'),
        senderDomain: 'billing.netflix.com',
        subject: 'Monthly payment receipt INR 499',
        userId: firstUser.id,
      }),
      createSignal({
        connectionId: firstConnection.id,
        index: 2,
        occurredAt: new Date('2026-02-20T00:00:00Z'),
        senderDomain: 'mail.netflix.com',
        subject: 'Your monthly membership renewal notice INR 499',
        userId: firstUser.id,
      }),
      createSignal({
        connectionId: firstConnection.id,
        index: 3,
        occurredAt: new Date('2026-02-21T00:00:00Z'),
        senderDomain: 'offers.example.com',
        subject: 'Newsletter subscription discount offer INR 99',
        userId: firstUser.id,
      }),
      createSignal({
        connectionId: secondConnection.id,
        index: 1,
        occurredAt: new Date('2026-02-10T00:00:00Z'),
        senderDomain: 'billing.spotify.com',
        subject: 'Monthly payment receipt EUR 10.99',
        userId: secondUser.id,
      }),
    ])

    const firstRun = await syncSubscriptionsForUser(firstUser.id)
    const repeatedRun = await syncSubscriptionsForUser(firstUser.id)
    await syncSubscriptionsForUser(secondUser.id)

    expect(firstRun).toEqual({ processedSignalCount: 3, subscriptionCount: 1 })
    expect(repeatedRun).toEqual(firstRun)
    expect(await Subscription.countDocuments({ userId: firstUser.id })).toBe(1)
    expect(await Subscription.countDocuments({ userId: secondUser.id })).toBe(1)

    const subscription = await Subscription.findOne({ userId: firstUser.id })
    expect(subscription).toMatchObject({
      amountMinor: 49_900,
      basis: ['PAYMENT', 'SUBSCRIPTION'],
      billingCycle: 'MONTHLY',
      confidenceLevel: 'LIKELY',
      currency: 'INR',
      evidenceCount: 2,
      primaryDomain: 'netflix.com',
      renewalIsEstimated: true,
      serviceName: 'Netflix',
    })
    expect(subscription.nextRenewalAt).toEqual(new Date('2026-03-20T00:00:00Z'))
    expect(subscription.toJSON()).not.toHaveProperty('userId')
    expect(subscription.toJSON()).not.toHaveProperty('evidenceSignalIds')

    await removeSubscriptionsForUser(firstUser.id)
    expect(await Subscription.countDocuments({ userId: firstUser.id })).toBe(0)
    expect(await Subscription.countDocuments({ userId: secondUser.id })).toBe(1)
  })

  it('rejects invalid subscription records at the model boundary', async () => {
    const invalidId = new mongoose.Types.ObjectId()
    await expect(Subscription.create({
      confidenceLevel: 'CERTAIN',
      confidenceScore: 101,
      evidenceCount: 0,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      primaryDomain: 'example.com',
      serviceKey: 'example.com',
      serviceName: 'Example',
      userId: invalidId,
    })).rejects.toThrow()
  })
})
