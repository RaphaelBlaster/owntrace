import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import Account from '../src/models/account.model.js'
import BreachReport from '../src/models/breach-report.model.js'
import PrivacyRequest from '../src/models/privacy-request.model.js'
import Subscription from '../src/models/subscription.model.js'
import User from '../src/models/user.model.js'
import {
  HOURLY_CHECK_LIMIT,
  reserveProviderCheck,
  resetProviderCheckRateLimitForTests,
} from '../src/services/breach-provider-rate-limit.service.js'

const password = 'a secure privacy feature password'

function mockBreachProvider({ payload = { breaches: [] }, status = 200 } = {}) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function registerUser(email) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    email,
    name: 'Privacy Feature User',
    password,
  }).expect(201)
  return { agent, userId: response.body.user.id }
}

async function createAccount(userId, overrides = {}) {
  const observedAt = overrides.lastSeenAt || new Date()
  return Account.create({
    confidenceLevel: 'LIKELY',
    confidenceScore: 78,
    dormantReason: 'Recent account evidence exists.',
    dormantStatus: 'ACTIVE',
    evidenceClasses: ['SUBSCRIPTION'],
    evidenceCount: 1,
    firstSeenAt: observedAt,
    lastEvaluatedAt: observedAt,
    lastOwnershipEvidenceAt: observedAt,
    lastSeenAt: observedAt,
    ownershipEvidenceCount: 1,
    primaryDomain: 'example.com',
    serviceKey: 'example.com',
    serviceName: 'Example',
    userId,
    ...overrides,
  })
}

async function createSubscription(userId, overrides = {}) {
  const observedAt = overrides.lastSeenAt || new Date()
  return Subscription.create({
    amountMinor: 1_299,
    basis: ['PAYMENT', 'SUBSCRIPTION'],
    billingCycle: 'MONTHLY',
    confidenceLevel: 'LIKELY',
    confidenceScore: 85,
    currency: 'USD',
    evidenceCount: 2,
    firstSeenAt: observedAt,
    lastPaymentAt: observedAt,
    lastSeenAt: observedAt,
    nextRenewalAt: new Date(observedAt.getTime() + 30 * 86_400_000),
    primaryDomain: 'music.example',
    renewalIsEstimated: true,
    serviceKey: 'music.example',
    serviceName: 'Music Example',
    userId,
    ...overrides,
  })
}

beforeAll(async () => {
  await Promise.all([
    User.init(),
    Account.init(),
    BreachReport.init(),
    PrivacyRequest.init(),
    Subscription.init(),
  ])
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetProviderCheckRateLimitForTests()
})

describe('Raphael-owned website feature APIs', () => {
  it('requires authentication on every feature route', async () => {
    const routes = [
      '/api/subscriptions',
      '/api/breaches',
      '/api/exposures',
      '/api/privacy-health',
      '/api/notifications',
      '/api/privacy-requests',
    ]
    await Promise.all(routes.map((route) => request(app).get(route).expect(401)))
    await request(app).post('/api/breaches/check').send({ consent: true }).expect(401)
    await request(app).post('/api/privacy-requests').send({}).expect(401)
    await request(app).patch('/api/privacy-requests/not-an-id').send({ status: 'READY' }).expect(401)
  })

  it('returns bounded subscription records for only the authenticated user', async () => {
    const first = await registerUser('subscriptions-first@example.com')
    const second = await registerUser('subscriptions-second@example.com')
    await Promise.all([
      createSubscription(first.userId),
      createSubscription(second.userId, {
        primaryDomain: 'private.example',
        serviceKey: 'private.example',
        serviceName: 'Private Subscription',
      }),
    ])

    const response = await first.agent.get('/api/subscriptions?page=1&limit=1').expect(200)
    expect(response.body.pagination).toEqual({ limit: 1, page: 1, pages: 1, total: 1 })
    expect(response.body.subscriptions[0]).toMatchObject({
      amountMinor: 1_299,
      basis: ['PAYMENT', 'SUBSCRIPTION'],
      billingCycle: 'MONTHLY',
      confidenceLevel: 'LIKELY',
      currency: 'USD',
      serviceName: 'Music Example',
      source: 'GMAIL_METADATA',
    })
    expect(JSON.stringify(response.body)).not.toContain('Private Subscription')
    expect(response.body.subscriptions[0]).not.toHaveProperty('userId')
    await first.agent.get('/api/subscriptions?limit=101').expect(400)
    await first.agent.get('/api/subscriptions?page[$gt]=0').expect(400)
  })

  it('keeps verified breaches empty before an explicit check and labels metadata-derived security signals truthfully', async () => {
    const { agent, userId } = await registerUser('breach-signals@example.com')
    await createAccount(userId, {
      evidenceClasses: ['PASSWORD_RESET', 'SECURITY_ALERT'],
      primaryDomain: 'security.example',
      serviceKey: 'security.example',
      serviceName: 'Security Example',
    })

    const response = await agent.get('/api/breaches').expect(200)
    expect(response.body.breaches).toEqual([])
    expect(response.body.provider.status).toBe('NOT_CHECKED')
    expect(response.body.securitySignals).toHaveLength(1)
    expect(response.body.securitySignals[0]).toMatchObject({
      serviceName: 'Security Example',
      verifiedBreach: false,
    })
  })

  it('requires consent, caches verified breach names, and never exposes the checked email', async () => {
    const { agent } = await registerUser('breach-cache@example.com')
    const fetchMock = mockBreachProvider({ payload: { breaches: [['Adobe', 'LinkedIn', 'Adobe']] } })

    const withoutConsent = await agent.post('/api/breaches/check').send({}).expect(400)
    expect(withoutConsent.body.code).toBe('BREACH_CHECK_CONSENT_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()

    const first = await agent.post('/api/breaches/check').send({ consent: true }).expect(200)
    expect(first.body.reused).toBe(false)
    expect(first.body.report.breaches).toEqual([{ name: 'Adobe' }, { name: 'LinkedIn' }])
    expect(JSON.stringify(first.body)).not.toContain('breach-cache@example.com')

    const second = await agent.post('/api/breaches/check').send({ consent: true }).expect(200)
    expect(second.body.reused).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resetProviderCheckRateLimitForTests()
    for (let index = 0; index < HOURLY_CHECK_LIMIT; index += 1) {
      reserveProviderCheck(3_600_000 + index * 1_000)
    }
    const cachedWhileQuotaIsFull = await agent.post('/api/breaches/check').send({ consent: true }).expect(200)
    expect(cachedWhileQuotaIsFull.body.reused).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const listed = await agent.get('/api/breaches').expect(200)
    expect(listed.body.breaches).toEqual([{ name: 'Adobe' }, { name: 'LinkedIn' }])
    expect(listed.body.provider).toMatchObject({
      attribution: 'Verified results are supplied by XposedOrNot.',
      id: 'XPOSED_OR_NOT',
    })
    expect(listed.body.provider.status).toBe('BREACHES_FOUND')
    expect(JSON.stringify(listed.body)).not.toContain('breach-cache@example.com')
  })

  it('paginates verified breaches and security signals independently', async () => {
    const { agent, userId } = await registerUser('breach-pagination@example.com')
    const older = new Date('2025-01-01T00:00:00.000Z')
    const newer = new Date('2025-02-01T00:00:00.000Z')
    await Promise.all([
      createAccount(userId, {
        evidenceClasses: ['SECURITY_ALERT'],
        firstSeenAt: older,
        lastEvaluatedAt: older,
        lastOwnershipEvidenceAt: older,
        lastSeenAt: older,
        primaryDomain: 'older-security.example',
        serviceKey: 'older-security.example',
        serviceName: 'Older Security Signal',
      }),
      createAccount(userId, {
        evidenceClasses: ['PASSWORD_RESET'],
        firstSeenAt: newer,
        lastEvaluatedAt: newer,
        lastOwnershipEvidenceAt: newer,
        lastSeenAt: newer,
        primaryDomain: 'newer-security.example',
        serviceKey: 'newer-security.example',
        serviceName: 'Newer Security Signal',
      }),
    ])
    await BreachReport.create({
      breaches: [{ name: 'Alpha Breach' }, { name: 'Beta Breach' }],
      lastCheckedAt: newer,
      nextCheckAt: new Date(newer.getTime() + 86_400_000),
      userId,
    })

    const first = await agent.get('/api/breaches?breachPage=2&breachLimit=1&signalPage=1&signalLimit=1').expect(200)
    expect(first.body.breaches).toEqual([{ name: 'Beta Breach' }])
    expect(first.body.securitySignals).toMatchObject([{ serviceName: 'Newer Security Signal' }])

    const second = await agent.get('/api/breaches?breachPage=1&breachLimit=1&signalPage=2&signalLimit=1').expect(200)
    expect(second.body.breaches).toEqual([{ name: 'Alpha Breach' }])
    expect(second.body.securitySignals).toMatchObject([{ serviceName: 'Older Security Signal' }])
    await agent.get('/api/breaches?breachPage=0').expect(400)
    await agent.get('/api/breaches?signalPage=0').expect(400)
    await agent.get('/api/breaches?unexpectedControl=1').expect(400)
  })

  it('isolates verified breach reports and maps provider failures to safe errors', async () => {
    const first = await registerUser('breach-private-first@example.com')
    const second = await registerUser('breach-private-second@example.com')
    mockBreachProvider({ payload: { breaches: [['Private Breach']] } })
    await first.agent.post('/api/breaches/check').send({ consent: true }).expect(200)

    const secondResult = await second.agent.get('/api/breaches').expect(200)
    expect(secondResult.body.breaches).toEqual([])
    expect(JSON.stringify(secondResult.body)).not.toContain('Private Breach')

    resetProviderCheckRateLimitForTests()
    const provider429Fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', provider429Fetch)
    const rateLimited = await second.agent.post('/api/breaches/check').send({ consent: true }).expect(429)
    expect(rateLimited.body.code).toBe('BREACH_CHECK_RATE_LIMITED')
    expect(provider429Fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(rateLimited.body)).not.toContain('breach-private-second@example.com')
  })

  it('applies the shared burst allowance across different users before outbound checks', async () => {
    const first = await registerUser('burst-first@example.com')
    const second = await registerUser('burst-second@example.com')
    const fetchMock = mockBreachProvider({ payload: { breaches: [] } })

    const responses = await Promise.all([
      first.agent.post('/api/breaches/check').send({ consent: true }),
      second.agent.post('/api/breaches/check').send({ consent: true }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('adds verified breaches to Privacy Health and derived notifications', async () => {
    const { agent } = await registerUser('breach-risk@example.com')
    mockBreachProvider({ payload: { breaches: [['Known Breach']] } })
    await agent.post('/api/breaches/check').send({ consent: true }).expect(200)

    const health = await agent.get('/api/privacy-health').expect(200)
    expect(health.body.health.confidence).toBe('DERIVED_FROM_CURRENT_SIGNALS')
    expect(health.body.health.factors).toContainEqual({ id: 'verifiedBreaches', penalty: 10 })

    const notifications = await agent.get('/api/notifications').expect(200)
    expect(notifications.body.notifications).toContainEqual(expect.objectContaining({
      kind: 'VERIFIED_BREACH',
      priority: 'HIGH',
      target: '/breaches',
      title: 'Known breach: Known Breach',
    }))
  })

  it('returns bounded exposure review signals without claiming public exposure', async () => {
    const first = await registerUser('exposure-first@example.com')
    const second = await registerUser('exposure-second@example.com')
    const dormantDate = new Date()
    dormantDate.setUTCMonth(dormantDate.getUTCMonth() - 30)
    await Promise.all([
      createAccount(first.userId, {
        dormantStatus: 'DORMANT',
        firstSeenAt: dormantDate,
        lastOwnershipEvidenceAt: dormantDate,
        lastSeenAt: dormantDate,
        primaryDomain: 'old.example',
        serviceKey: 'old.example',
        serviceName: 'Old Account',
      }),
      createAccount(second.userId, {
        primaryDomain: 'other.example',
        serviceKey: 'other.example',
        serviceName: 'Other User Account',
      }),
    ])

    const response = await first.agent.get('/api/exposures?limit=10').expect(200)
    expect(response.body.exposureSignals).toHaveLength(1)
    expect(response.body.exposureSignals[0]).toMatchObject({
      level: 'MEDIUM',
      serviceName: 'Old Account',
      verifiedPublicExposure: false,
    })
    expect(JSON.stringify(response.body)).not.toContain('Other User Account')
  })

  it('calculates deterministic Privacy Health from current account and action summaries', async () => {
    const empty = await registerUser('health-empty@example.com')
    const emptyResponse = await empty.agent.get('/api/privacy-health').expect(200)
    expect(emptyResponse.body.health).toMatchObject({
      confidence: 'NOT_ENOUGH_DATA',
      score: null,
    })

    const populated = await registerUser('health-populated@example.com')
    await createAccount(populated.userId, {
      confidenceLevel: 'CONFIRMED',
      confidenceScore: 92,
      evidenceClasses: ['SECURITY_ALERT'],
      primaryDomain: 'risk.example',
      serviceKey: 'risk.example',
      serviceName: 'Risk Example',
    })
    const first = await populated.agent.get('/api/privacy-health').expect(200)
    const second = await populated.agent.get('/api/privacy-health').expect(200)
    expect(first.body.health).toEqual(second.body.health)
    expect(first.body.health.confidence).toBe('DERIVED_FROM_CURRENT_SIGNALS')
    expect(first.body.health.score).toBeGreaterThanOrEqual(0)
    expect(first.body.health.score).toBeLessThanOrEqual(100)
  })

  it('validates and user-scopes the privacy request lifecycle', async () => {
    const first = await registerUser('requests-first@example.com')
    const second = await registerUser('requests-second@example.com')
    await first.agent.post('/api/privacy-requests').send({ requestType: 'DELETE' }).expect(400)

    const created = await first.agent.post('/api/privacy-requests').send({
      notes: 'Use the official privacy form.',
      requestType: 'DELETE',
      serviceName: 'Example Service',
    }).expect(201)
    expect(created.body.privacyRequest).toMatchObject({
      requestType: 'DELETE',
      serviceName: 'Example Service',
      status: 'DRAFT',
    })
    expect(created.body.privacyRequest).not.toHaveProperty('userId')

    await second.agent
      .patch(`/api/privacy-requests/${created.body.privacyRequest.id}`)
      .send({ status: 'READY' })
      .expect(404)
    await first.agent
      .patch(`/api/privacy-requests/${created.body.privacyRequest.id}`)
      .send({ status: 'COMPLETED' })
      .expect(409)
    const ready = await first.agent
      .patch(`/api/privacy-requests/${created.body.privacyRequest.id}`)
      .send({ status: 'READY' })
      .expect(200)
    expect(ready.body.privacyRequest.status).toBe('READY')
  })

  it('paginates privacy requests and rejects invalid query controls', async () => {
    const { agent } = await registerUser('request-list@example.com')
    await Promise.all(['One', 'Two'].map((serviceName) => agent.post('/api/privacy-requests').send({
      requestType: 'ACCESS',
      serviceName,
    }).expect(201)))

    const response = await agent.get('/api/privacy-requests?page=1&limit=1').expect(200)
    expect(response.body.requests).toHaveLength(1)
    expect(response.body.pagination).toEqual({ limit: 1, page: 1, pages: 2, total: 2 })
    await agent.get('/api/privacy-requests?status=unknown').expect(400)
    await agent.get('/api/privacy-requests?page=0').expect(400)
  })

  it('derives bounded notifications without exposing another user records', async () => {
    const first = await registerUser('notifications-first@example.com')
    const second = await registerUser('notifications-second@example.com')
    const firstRequest = await first.agent.post('/api/privacy-requests').send({
      requestType: 'OPT_OUT',
      serviceName: 'Visible Service',
    }).expect(201)
    await first.agent.patch(`/api/privacy-requests/${firstRequest.body.privacyRequest.id}`)
      .send({ status: 'READY' }).expect(200)
    await second.agent.post('/api/privacy-requests').send({
      requestType: 'ACCESS',
      serviceName: 'Private Service',
    }).expect(201)

    const response = await first.agent.get('/api/notifications?limit=10').expect(200)
    expect(response.body.notifications.some((item) => item.title.includes('Visible Service'))).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain('Private Service')
    expect(JSON.stringify(response.body)).not.toContain(first.userId)
    await first.agent.get('/api/notifications?limit=51').expect(400)
  })

  it('removes Raphael-owned persistent records during permanent account deletion', async () => {
    const { agent, userId } = await registerUser('privacy-delete@example.com')
    await agent.post('/api/privacy-requests').send({
      requestType: 'DELETE',
      serviceName: 'Deletion Example',
    }).expect(201)
    await BreachReport.create({
      breaches: [{ name: 'Deletion Breach' }],
      lastCheckedAt: new Date(),
      nextCheckAt: new Date(Date.now() + 86_400_000),
      userId,
    })
    await createSubscription(userId)
    expect(await PrivacyRequest.countDocuments({ userId })).toBe(1)
    expect(await BreachReport.countDocuments({ userId })).toBe(1)
    expect(await Subscription.countDocuments({ userId })).toBe(1)

    await agent.delete('/api/auth/account').send({ confirmation: 'DELETE', password }).expect(200)
    expect(await PrivacyRequest.countDocuments({ userId })).toBe(0)
    expect(await BreachReport.countDocuments({ userId })).toBe(0)
    expect(await Subscription.countDocuments({ userId })).toBe(0)
    expect(await User.countDocuments({ _id: userId })).toBe(0)
  })
})
