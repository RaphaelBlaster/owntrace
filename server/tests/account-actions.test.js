import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import AccountAction from '../src/models/account-action.model.js'
import Account from '../src/models/account.model.js'
import User from '../src/models/user.model.js'
import { syncAccountActionsForUser } from '../src/services/account-action.service.js'

async function registerUser(email) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    email,
    name: 'Cleanup Test User',
    password: 'a secure cleanup test password',
  }).expect(201)
  return { agent, userId: response.body.user.id }
}

async function createAccount(userId, overrides = {}) {
  const lastSeenAt = overrides.lastSeenAt || new Date()
  return Account.create({
    confidenceLevel: 'CONFIRMED',
    confidenceScore: 93,
    dormantReason: 'Account-related evidence was detected within the last 12 months.',
    dormantStatus: 'ACTIVE',
    evidenceClasses: ['ACCOUNT_VERIFICATION'],
    evidenceCount: 1,
    firstSeenAt: lastSeenAt,
    lastEvaluatedAt: lastSeenAt,
    lastOwnershipEvidenceAt: lastSeenAt,
    lastSeenAt,
    ownershipEvidenceCount: 1,
    primaryDomain: 'example.com',
    serviceKey: 'example.com',
    serviceName: 'Example',
    userId,
    ...overrides,
  })
}

beforeAll(async () => {
  await Promise.all([User.init(), Account.init(), AccountAction.init()])
})

describe('account action API', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/account-actions').expect(401)
    await request(app).get('/api/account-actions/summary').expect(401)
    await request(app).patch('/api/account-actions/000000000000000000000000').send({ status: 'COMPLETED' }).expect(401)
  })

  it('generates deterministic prioritized recommendations without duplicates', async () => {
    const { agent, userId } = await registerUser('cleanup-list@example.com')
    const dormantDate = new Date()
    dormantDate.setUTCMonth(dormantDate.getUTCMonth() - 30)

    await Promise.all([
      createAccount(userId, {
        dormantReason: 'No account-related evidence was detected in the last 24 months.',
        dormantStatus: 'DORMANT',
        evidenceClasses: ['LOGIN_ALERT', 'PASSWORD_RESET', 'SECURITY_ALERT'],
        lastOwnershipEvidenceAt: dormantDate,
        lastSeenAt: dormantDate,
        primaryDomain: 'secure.example',
        serviceKey: 'secure.example',
        serviceName: 'Secure Example',
      }),
      createAccount(userId, {
        confidenceLevel: 'UNKNOWN',
        confidenceScore: 5,
        evidenceClasses: ['OTHER'],
        ownershipEvidenceCount: 0,
        lastOwnershipEvidenceAt: null,
        primaryDomain: 'weak.example',
        serviceKey: 'weak.example',
        serviceName: 'Weak Example',
      }),
    ])

    const [first, concurrentSummary] = await Promise.all([
      agent.get('/api/account-actions?status=open').expect(200),
      agent.get('/api/account-actions/summary').expect(200),
    ])
    const second = await agent.get('/api/account-actions?status=OPEN').expect(200)

    expect(first.body.actions).toHaveLength(5)
    expect(second.body.actions).toHaveLength(5)
    expect(await AccountAction.countDocuments({ userId })).toBe(5)
    expect(first.body.actions[0]).toMatchObject({ priority: 'HIGH', type: 'SECURE_ACCOUNT' })
    expect(first.body.actions.every((action) => action.account?.serviceName)).toBe(true)
    expect(JSON.stringify(first.body)).not.toContain('priorityRank')
    expect(JSON.stringify(first.body)).not.toContain('userId')
    expect(concurrentSummary.body.summary.open).toBe(5)

    const summary = await agent.get('/api/account-actions/summary').expect(200)
    expect(summary.body.summary).toEqual({
      completed: 0,
      dismissed: 0,
      highPriority: 1,
      inProgress: 0,
      open: 5,
    })
    await agent.get('/api/account-actions?limit=101').expect(400)
    await agent.get('/api/account-actions?accountId=invalid').expect(400)
  })

  it('tracks supported states and prevents cross-user action access', async () => {
    const owner = await registerUser('cleanup-owner@example.com')
    const other = await registerUser('cleanup-other@example.com')
    await createAccount(owner.userId)
    await syncAccountActionsForUser(owner.userId)
    const action = await AccountAction.findOne({ userId: owner.userId })

    const started = await owner.agent
      .patch(`/api/account-actions/${action.id}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200)
    expect(started.body.action.status).toBe('IN_PROGRESS')

    await other.agent
      .patch(`/api/account-actions/${action.id}`)
      .send({ status: 'COMPLETED' })
      .expect(404)

    const completed = await owner.agent
      .patch(`/api/account-actions/${action.id}`)
      .send({ status: 'COMPLETED' })
      .expect(200)
    expect(completed.body.action.completedAt).toBeTruthy()

    await owner.agent
      .patch(`/api/account-actions/${action.id}`)
      .send({ status: 'DISMISSED' })
      .expect(409)

    const reopened = await owner.agent
      .patch(`/api/account-actions/${action.id}`)
      .send({ status: 'OPEN' })
      .expect(200)
    expect(reopened.body.action.completedAt).toBeNull()
  })

  it('removes obsolete open recommendations while preserving the base review action', async () => {
    const { userId } = await registerUser('cleanup-refresh@example.com')
    const dormantDate = new Date()
    dormantDate.setUTCMonth(dormantDate.getUTCMonth() - 30)
    const account = await createAccount(userId, {
      evidenceClasses: ['LOGIN_ALERT'],
      lastOwnershipEvidenceAt: dormantDate,
      lastSeenAt: dormantDate,
    })

    await syncAccountActionsForUser(userId)
    expect(await AccountAction.countDocuments({ accountId: account.id, userId })).toBe(4)

    await Account.updateOne(
      { _id: account.id, userId },
      {
        $set: {
          evidenceClasses: ['ACCOUNT_VERIFICATION'],
          lastOwnershipEvidenceAt: new Date(),
          lastSeenAt: new Date(),
        },
      },
    )
    await syncAccountActionsForUser(userId)

    const remaining = await AccountAction.find({ accountId: account.id, userId }).lean()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].type).toBe('REVIEW_ACCOUNT')
  })
})
