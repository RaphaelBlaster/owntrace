import mongoose from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import AccountEvidence from '../src/models/account-evidence.model.js'
import Account from '../src/models/account.model.js'
import User from '../src/models/user.model.js'
import { evaluateDormancy } from '../src/services/account-dormancy.service.js'

const password = 'a secure account test password'

async function registerUser(email) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    email,
    name: 'Account Test User',
    password,
  }).expect(201)

  return { agent, userId: response.body.user.id }
}

async function createAccount(userId, overrides = {}) {
  const lastSeenAt = overrides.lastSeenAt || new Date()
  const ownershipEvidenceCount = overrides.ownershipEvidenceCount ?? 1

  return Account.create({
    confidenceLevel: 'LIKELY',
    confidenceScore: 76,
    evidenceClasses: ['LOGIN_ALERT'],
    evidenceCount: 1,
    firstSeenAt: lastSeenAt,
    lastEvaluatedAt: new Date(),
    lastOwnershipEvidenceAt: ownershipEvidenceCount ? lastSeenAt : null,
    lastSeenAt,
    ownershipEvidenceCount,
    primaryDomain: 'example.com',
    serviceKey: 'example.com',
    serviceName: 'Example',
    userId,
    ...overrides,
  })
}

beforeAll(async () => {
  await Promise.all([User.init(), Account.init(), AccountEvidence.init()])
})

describe('account API', () => {
  it('requires authentication for list, summary, and detail routes', async () => {
    const id = new mongoose.Types.ObjectId()

    await request(app).get('/api/accounts').expect(401)
    await request(app).get('/api/accounts/summary').expect(401)
    await request(app).get(`/api/accounts/${id}`).expect(401)
  })

  it('lists only the current user accounts with bounded filters, search, sort, and pagination', async () => {
    const { agent, userId } = await registerUser('accounts-list@example.com')
    const other = await registerUser('accounts-other@example.com')
    const now = Date.now()

    await Promise.all([
      createAccount(userId, {
        confidenceLevel: 'CONFIRMED',
        confidenceScore: 94,
        lastSeenAt: new Date(now - 1_000),
        primaryDomain: 'github.com',
        serviceKey: 'github.com',
        serviceName: 'GitHub',
      }),
      createAccount(userId, {
        confidenceLevel: 'POSSIBLE',
        confidenceScore: 54,
        lastSeenAt: new Date(now - 2_000),
        primaryDomain: 'figma.com',
        serviceKey: 'figma.com',
        serviceName: 'Figma',
      }),
      createAccount(other.userId, {
        primaryDomain: 'private.example',
        serviceKey: 'private.example',
        serviceName: 'Private account',
      }),
    ])

    const response = await agent
      .get('/api/accounts?confidence=confirmed&search=git&sort=serviceName&direction=asc&page=1&limit=1')
      .expect(200)

    expect(response.body.accounts).toHaveLength(1)
    expect(response.body.accounts[0]).toMatchObject({
      confidenceLevel: 'CONFIRMED',
      serviceName: 'GitHub',
    })
    expect(response.body.accounts[0]).not.toHaveProperty('userId')
    expect(response.body.pagination).toEqual({ limit: 1, page: 1, pages: 1, total: 1 })

    const literalSearch = await agent.get('/api/accounts?search=%2B').expect(200)
    expect(literalSearch.body.accounts).toHaveLength(0)
    await agent.get('/api/accounts?limit=101').expect(400)
    await agent.get('/api/accounts?sort=unsupported').expect(400)
  })

  it('returns minimized evidence and prevents cross-user account access', async () => {
    const first = await registerUser('account-detail@example.com')
    const second = await registerUser('account-intruder@example.com')
    const account = await createAccount(first.userId)
    const internalId = new mongoose.Types.ObjectId()

    await AccountEvidence.create({
      accountId: account.id,
      connectionId: internalId,
      evidenceClass: 'LOGIN_ALERT',
      evidenceWeight: 76,
      gmailSignalId: new mongoose.Types.ObjectId(),
      occurredAt: account.lastSeenAt,
      ownershipSignal: true,
      reasonCode: 'LOGIN_ACTIVITY_LANGUAGE',
      sourceDomain: 'mail.example.com',
      userId: first.userId,
    })

    const response = await first.agent.get(`/api/accounts/${account.id}`).expect(200)
    expect(response.body.account.id).toBe(account.id)
    expect(response.body.evidence).toHaveLength(1)
    expect(response.body.evidence[0]).not.toHaveProperty('userId')
    expect(response.body.evidence[0]).not.toHaveProperty('connectionId')
    expect(response.body.evidence[0]).not.toHaveProperty('gmailSignalId')
    expect(response.body.evidence[0]).not.toHaveProperty('subjectSignal')

    await second.agent.get(`/api/accounts/${account.id}`).expect(404)
    await first.agent.get('/api/accounts/not-an-object-id').expect(404)
  })

  it('refreshes explainable dormant states and returns a user-scoped summary', async () => {
    const { agent, userId } = await registerUser('account-summary@example.com')
    const active = new Date()
    const possiblyDormant = new Date()
    possiblyDormant.setUTCMonth(possiblyDormant.getUTCMonth() - 18)
    const dormant = new Date()
    dormant.setUTCMonth(dormant.getUTCMonth() - 30)

    await Promise.all([
      createAccount(userId, {
        confidenceLevel: 'CONFIRMED',
        confidenceScore: 93,
        lastOwnershipEvidenceAt: active,
        lastSeenAt: active,
        primaryDomain: 'active.example',
        serviceKey: 'active.example',
      }),
      createAccount(userId, {
        lastOwnershipEvidenceAt: possiblyDormant,
        lastSeenAt: possiblyDormant,
        primaryDomain: 'possible.example',
        serviceKey: 'possible.example',
      }),
      createAccount(userId, {
        lastOwnershipEvidenceAt: dormant,
        lastSeenAt: dormant,
        primaryDomain: 'dormant.example',
        serviceKey: 'dormant.example',
      }),
      createAccount(userId, {
        confidenceLevel: 'UNKNOWN',
        confidenceScore: 5,
        ownershipEvidenceCount: 0,
        primaryDomain: 'unknown.example',
        serviceKey: 'unknown.example',
      }),
    ])

    const response = await agent.get('/api/accounts/summary').expect(200)
    expect(response.body.summary).toEqual({
      dormant: 1,
      highConfidence: 3,
      possiblyDormant: 1,
      recentlySeen: 2,
      total: 4,
    })

    const accounts = await Account.find({ userId }).lean()
    expect(accounts.find((item) => item.serviceKey === 'active.example').dormantStatus).toBe('ACTIVE')
    expect(accounts.find((item) => item.serviceKey === 'possible.example').dormantStatus).toBe('POSSIBLY_DORMANT')
    expect(accounts.find((item) => item.serviceKey === 'dormant.example').dormantStatus).toBe('DORMANT')
    expect(accounts.find((item) => item.serviceKey === 'unknown.example').dormantStatus).toBe('UNKNOWN')
  })
})

describe('dormancy evaluation', () => {
  const now = new Date('2026-08-20T00:00:00Z')

  it.each([
    [new Date('2026-01-01T00:00:00Z'), 1, 'ACTIVE'],
    [new Date('2025-02-01T00:00:00Z'), 1, 'POSSIBLY_DORMANT'],
    [new Date('2023-01-01T00:00:00Z'), 1, 'DORMANT'],
    [null, 0, 'UNKNOWN'],
  ])('classifies %s with %i ownership evidence as %s', (lastActivity, count, expected) => {
    expect(evaluateDormancy({
      lastOwnershipEvidenceAt: lastActivity,
      ownershipEvidenceCount: count,
    }, now).dormantStatus).toBe(expected)
  })
})
