import mongoose from 'mongoose'
import { describe, expect, it } from 'vitest'
import AccountAction from '../src/models/account-action.model.js'
import AccountEvidence from '../src/models/account-evidence.model.js'
import Account from '../src/models/account.model.js'
import GmailSignal from '../src/models/gmail-signal.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import MicrosoftSignal from '../src/models/microsoft-signal.model.js'
import User from '../src/models/user.model.js'
import {
  classifyEvidence,
  discoverAccountsForUser,
  normalizeServiceDomain,
  removeConnectionDiscoveries,
  scoreEvidence,
} from '../src/services/account-discovery.service.js'

async function createUser(email) {
  return User.create({
    email,
    name: 'Discovery Test',
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

async function createSignal({
  connectionId,
  index,
  occurredAt,
  senderDomain,
  subjectSignal,
  userId,
}) {
  return GmailSignal.create({
    connectionId,
    messageIdHash: `message-${userId}-${index}`,
    occurredAt,
    senderDomain,
    senderEmail: `account@${senderDomain}`,
    subjectSignal,
    threadIdHash: `thread-${userId}-${index}`,
    userId,
  })
}

describe('account discovery', () => {
  it.each([
    ['Your account was created successfully', 'ACCOUNT_CREATED', 90],
    ['Verify your email address', 'ACCOUNT_VERIFICATION', 86],
    ['Welcome to Canva', 'WELCOME', 72],
    ['New sign-in detected', 'LOGIN_ALERT', 76],
    ['Your verification code is [number]', 'OTP', 68],
    ['Reset your password', 'PASSWORD_RESET', 82],
    ['Security alert for your account', 'SECURITY_ALERT', 82],
    ['Your membership renewal notice', 'SUBSCRIPTION', 54],
    ['Payment receipt', 'PAYMENT', 58],
    ['Your account deletion is complete', 'ACCOUNT_DELETION', 78],
  ])('classifies %s as %s', (subject, evidenceClass, evidenceWeight) => {
    expect(classifyEvidence(subject)).toMatchObject({ evidenceClass, evidenceWeight })
  })

  it('keeps marketing-only and unclassified evidence below ownership confidence', () => {
    const marketing = classifyEvidence('Newsletter sale and discount offer')
    const marketingSubscription = classifyEvidence('Newsletter subscription offer')
    const unclassified = classifyEvidence('Product updates for August')

    expect(marketing).toMatchObject({
      evidenceClass: 'OTHER',
      evidenceWeight: 5,
      ownershipSignal: false,
      reasonCode: 'MARKETING_ONLY_LANGUAGE',
    })
    expect(marketingSubscription).toEqual(marketing)
    expect(unclassified.ownershipSignal).toBe(false)
    expect(scoreEvidence([marketing, unclassified])).toEqual({
      confidenceLevel: 'UNKNOWN',
      confidenceScore: 12,
    })
  })

  it('normalizes complex sender domains with the public suffix list', () => {
    expect(normalizeServiceDomain('mail.accounts.google.com')).toBe('google.com')
    expect(normalizeServiceDomain('updates.example.co.uk')).toBe('example.co.uk')
    expect(normalizeServiceDomain('tenant.github.io')).toBe('tenant.github.io')
    expect(normalizeServiceDomain('not a domain')).toBeNull()
  })

  it('aggregates explainable evidence into idempotent user-scoped account records', async () => {
    const user = await createUser('first@example.com')
    const connection = await createConnection(user.id, 'google-account-one')
    const dates = [
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-04-01T00:00:00Z'),
    ]
    await Promise.all([
      createSignal({
        connectionId: connection.id,
        index: 1,
        occurredAt: dates[0],
        senderDomain: 'accounts.canva.com',
        subjectSignal: 'Verify your account email',
        userId: user.id,
      }),
      createSignal({
        connectionId: connection.id,
        index: 2,
        occurredAt: dates[1],
        senderDomain: 'mail.canva.com',
        subjectSignal: 'Welcome to Canva',
        userId: user.id,
      }),
      createSignal({
        connectionId: connection.id,
        index: 3,
        occurredAt: dates[2],
        senderDomain: 'news.canva.com',
        subjectSignal: 'Newsletter discount offer',
        userId: user.id,
      }),
      createSignal({
        connectionId: connection.id,
        index: 4,
        occurredAt: dates[3],
        senderDomain: 'offers.example.co.uk',
        subjectSignal: 'Newsletter sale',
        userId: user.id,
      }),
    ])

    const firstRun = await discoverAccountsForUser(user.id)
    const secondRun = await discoverAccountsForUser(user.id)
    const accounts = await Account.find({ userId: user.id }).sort({ serviceKey: 1 }).lean()
    const canva = accounts.find((account) => account.serviceKey === 'canva.com')
    const marketingOnly = accounts.find((account) => account.serviceKey === 'example.co.uk')
    const evidence = await AccountEvidence.find({ userId: user.id }).lean()
    const serializedEvidence = (await AccountEvidence.findOne({ userId: user.id })).toJSON()

    expect(firstRun).toEqual({ accountCount: 2, evidenceCount: 4, processedSignalCount: 4 })
    expect(secondRun).toEqual(firstRun)
    expect(accounts).toHaveLength(2)
    expect(canva).toMatchObject({
      confidenceLevel: 'CONFIRMED',
      confidenceScore: 93,
      evidenceCount: 3,
      ownershipEvidenceCount: 2,
      primaryDomain: 'canva.com',
      serviceName: 'Canva',
    })
    expect(canva.evidenceClasses).toEqual(['ACCOUNT_VERIFICATION', 'OTHER', 'WELCOME'])
    expect(canva.firstSeenAt).toEqual(dates[0])
    expect(canva.lastSeenAt).toEqual(dates[2])
    expect(marketingOnly).toMatchObject({
      confidenceLevel: 'UNKNOWN',
      confidenceScore: 5,
      evidenceCount: 1,
      ownershipEvidenceCount: 0,
    })
    expect(evidence).toHaveLength(4)
    expect(evidence.every((item) => !('subjectSignal' in item))).toBe(true)
    expect(serializedEvidence).not.toHaveProperty('userId')
    expect(serializedEvidence).not.toHaveProperty('connectionId')
    expect(serializedEvidence).not.toHaveProperty('gmailSignalId')
    expect((await User.findById(user.id)).onboardingStatus).toBe('COMPLETED')
  })

  it('isolates identical services between users and removes only one connection provenance', async () => {
    const firstUser = await createUser('first@example.com')
    const secondUser = await createUser('second@example.com')
    const firstConnection = await createConnection(firstUser.id, 'google-account-one')
    const secondConnection = await createConnection(secondUser.id, 'google-account-two')
    await Promise.all([
      createSignal({
        connectionId: firstConnection.id,
        index: 1,
        occurredAt: new Date(),
        senderDomain: 'accounts.github.com',
        subjectSignal: 'New sign-in detected',
        userId: firstUser.id,
      }),
      createSignal({
        connectionId: secondConnection.id,
        index: 1,
        occurredAt: new Date(),
        senderDomain: 'accounts.github.com',
        subjectSignal: 'Reset your password',
        userId: secondUser.id,
      }),
    ])

    await Promise.all([
      discoverAccountsForUser(firstUser.id),
      discoverAccountsForUser(secondUser.id),
    ])
    expect(await Account.countDocuments({ serviceKey: 'github.com' })).toBe(2)

    await removeConnectionDiscoveries(firstUser.id, firstConnection.id)

    expect(await Account.countDocuments({ userId: firstUser.id })).toBe(0)
    expect(await AccountAction.countDocuments({ userId: firstUser.id })).toBe(0)
    expect(await AccountEvidence.countDocuments({ userId: firstUser.id })).toBe(0)
    expect(await Account.countDocuments({ userId: secondUser.id })).toBe(1)
    expect(await AccountAction.countDocuments({ userId: secondUser.id })).toBeGreaterThan(0)
    expect(await AccountEvidence.countDocuments({ userId: secondUser.id })).toBe(1)
  })

  it('combines both mail providers idempotently and preserves Gmail evidence after Microsoft cleanup', async () => {
    const user = await createUser('dual-provider@example.com')
    const gmailConnection = await createConnection(user.id, 'dual-google-account')
    const microsoftConnection = await MicrosoftConnection.create({
      email: 'dual-provider@outlook.example',
      encryptedAccessToken: 'v1.test.test.test',
      encryptedRefreshToken: 'v1.test.test.test',
      microsoftAccountId: 'dual-microsoft-account',
      scopes: ['Mail.ReadBasic'],
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      userId: user.id,
    })
    await Promise.all([
      createSignal({
        connectionId: gmailConnection.id,
        index: 1,
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        senderDomain: 'accounts.github.com',
        subjectSignal: 'Verify your account email',
        userId: user.id,
      }),
      MicrosoftSignal.create({
        connectionId: microsoftConnection.id,
        messageIdHash: 'dual-microsoft-message',
        occurredAt: new Date('2026-02-01T00:00:00Z'),
        senderDomain: 'security.github.com',
        senderEmail: 'security@github.com',
        subjectSignal: 'New sign-in detected',
        threadIdHash: 'dual-microsoft-thread',
        userId: user.id,
      }),
    ])

    expect(await discoverAccountsForUser(user.id)).toEqual({
      accountCount: 1,
      evidenceCount: 2,
      processedSignalCount: 2,
    })
    expect(await discoverAccountsForUser(user.id)).toEqual({
      accountCount: 1,
      evidenceCount: 2,
      processedSignalCount: 2,
    })
    const combinedEvidence = await AccountEvidence.find({ userId: user.id }).select('+connectionProvider').lean()
    expect(combinedEvidence.map((item) => item.connectionProvider).sort()).toEqual(['GOOGLE', 'MICROSOFT'])

    await removeConnectionDiscoveries(user.id, microsoftConnection.id)

    const remainingAccount = await Account.findOne({ userId: user.id }).lean()
    expect(remainingAccount).toMatchObject({ evidenceCount: 1, serviceKey: 'github.com' })
    expect(await AccountEvidence.countDocuments({ connectionId: gmailConnection.id, userId: user.id })).toBe(1)
    expect(await AccountEvidence.countDocuments({ connectionId: microsoftConnection.id, userId: user.id })).toBe(0)
  })

  it('rejects invalid account evidence references at the model boundary', async () => {
    const invalidId = new mongoose.Types.ObjectId()

    await expect(AccountEvidence.create({
      accountId: invalidId,
      connectionId: invalidId,
      evidenceClass: 'NOT_SUPPORTED',
      evidenceWeight: 101,
      gmailSignalId: invalidId,
      occurredAt: new Date(),
      ownershipSignal: true,
      reasonCode: 'INVALID',
      sourceDomain: 'example.com',
      userId: invalidId,
    })).rejects.toThrow()
  })
})
