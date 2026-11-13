import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import Account from '../src/models/account.model.js'
import AccountAction from '../src/models/account-action.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import OrderEvent from '../src/models/order-event.model.js'
import PrivacyRequest from '../src/models/privacy-request.model.js'
import Conversation from '../src/models/trace-conversation.model.js'
import User from '../src/models/user.model.js'
import { syncAccountActionsForUser } from '../src/services/account-action.service.js'
import { encryptSecret } from '../src/utils/encryption.js'

async function register(email) {
  const agent = request.agent(app)
  const result = await agent.post('/api/auth/register').send({ email, password: 'authz tests password strong', name: 'Authz Test' }).expect(201)
  const id = result.body.user.id
  await User.updateOne({ _id: id }, { onboardingStatus: 'COMPLETED' })
  return { agent, id }
}

async function ownedResources(owner) {
  const now = new Date()
  const account = await Account.create({ confidenceLevel: 'CONFIRMED', confidenceScore: 93, dormantReason: 'Recent evidence.', dormantStatus: 'ACTIVE', evidenceClasses: ['ACCOUNT_VERIFICATION'], evidenceCount: 1, firstSeenAt: now, lastEvaluatedAt: now, lastOwnershipEvidenceAt: now, lastSeenAt: now, ownershipEvidenceCount: 1, primaryDomain: 'example.com', serviceKey: 'example.com', serviceName: 'Example', userId: owner.id })
  await syncAccountActionsForUser(owner.id)
  const action = await AccountAction.findOne({ userId: owner.id })
  const privacy = await owner.agent.post('/api/privacy-requests').send({ requestType: 'ACCESS', serviceName: 'Example', notes: '' }).expect(201)
  const connection = await MicrosoftConnection.create({ userId: owner.id, microsoftAccountId: `ms-${owner.id}`, email: `ms-${owner.id}@example.com`, encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })
  const order = await OrderEvent.create({ userId: owner.id, connectionId: connection.id, provider: 'outlook', messageIdHash: 'authz-message', fingerprint: 'authz-fingerprint', merchantName: 'Shop', merchantDomain: 'shop.example', status: 'shipped', summary: 'Shipment reported.', occurredAt: now, policyVersion: 1 })
  const conversation = await Conversation.create({ userId: owner.id })
  return { account: account.id, action: action.id, privacy: privacy.body.privacyRequest.id, order: order.id, conversation: conversation.id }
}

describe('ownership and input validation', () => {
  it("returns 404 for another user's resources and leaves them unchanged", async () => {
    const a = await register('authz-a@example.com'), b = await register('authz-b@example.com')
    const ids = await ownedResources(a)
    const privacyStatus = (await PrivacyRequest.findById(ids.privacy)).status
    await MicrosoftConnection.create({ userId: b.id, microsoftAccountId: 'ms-b', email: 'ms-b@example.com', encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })

    await b.agent.get(`/api/accounts/${ids.account}`).expect(404)
    await b.agent.patch(`/api/account-actions/${ids.action}`).send({ status: 'COMPLETED' }).expect(404)
    await b.agent.patch(`/api/privacy-requests/${ids.privacy}`).send({ status: 'READY' }).expect(404)
    await b.agent.get(`/api/orders/${ids.order}`).expect(404)
    await b.agent.get(`/api/trace/conversations/${ids.conversation}`).expect(404)
    await b.agent.post(`/api/trace/conversations/${ids.conversation}/messages`).send({ content: 'hello' }).expect(404)
    await b.agent.delete(`/api/trace/conversations/${ids.conversation}`).expect(404)

    await b.agent.post('/api/trace/resolve-action').send({ type: 'open_account', accountId: ids.account }).expect(404)
    await b.agent.post('/api/trace/resolve-action').send({ type: 'focus_entity', entityType: 'account', entityId: ids.account }).expect(404)
    expect((await b.agent.get(`/api/subscriptions?focusId=${ids.account}`).expect(200)).body.focusedPage).toBeNull()
    for (const path of ['orders', 'accounts', 'account-actions', 'privacy-requests']) {
      const body = (await b.agent.get(`/api/${path}`).expect(200)).body
      expect(body.pagination?.total ?? body.total, path).toBe(0)
    }

    expect((await AccountAction.findById(ids.action)).status).toBe('OPEN')
    expect((await PrivacyRequest.findById(ids.privacy)).status).toBe(privacyStatus)
    expect((await Conversation.findById(ids.conversation)).messages).toHaveLength(0)
    await a.agent.get(`/api/accounts/${ids.account}`).expect(200)
    await a.agent.get(`/api/orders/${ids.order}`).expect(200)
    await a.agent.get(`/api/trace/conversations/${ids.conversation}`).expect(200)
  })

  it('answers malformed ids with 404, never 500', async () => {
    const a = await register('authz-ids@example.com')
    for (const id of ['not-an-id', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      await a.agent.get(`/api/accounts/${id}`).expect(404)
      await a.agent.patch(`/api/account-actions/${id}`).send({ status: 'COMPLETED' }).expect(404)
      await a.agent.patch(`/api/privacy-requests/${id}`).send({ status: 'READY' }).expect(404)
      await a.agent.get(`/api/orders/${id}`).expect(404)
      await a.agent.get(`/api/trace/conversations/${id}`).expect(404)
      await a.agent.delete(`/api/trace/conversations/${id}`).expect(404)
    }
    await a.agent.get('/api/account-actions?accountId=not-an-id').expect(400)
  })

  it('rejects one invalid input per validated route with 400', async () => {
    const a = await register('authz-input@example.com')
    const conversation = await Conversation.create({ userId: a.id })
    const cases = [
      ['post', '/api/auth/login', { email: 42, password: 'x' }],
      ['patch', '/api/auth/profile', { name: 'x' }],
      ['delete', '/api/auth/account', { password: ['x'] }],
      ['patch', '/api/onboarding', { status: 7 }],
      ['get', '/api/accounts?limit=abc'],
      ['get', '/api/account-actions?page=-1'],
      ['patch', '/api/account-actions/000000000000000000000000', {}],
      ['get', '/api/subscriptions?limit=x'],
      ['get', '/api/breaches?breachPage=x'],
      ['get', '/api/exposures?page=x'],
      ['get', '/api/notifications?limit=x'],
      ['get', '/api/privacy-requests?page=x'],
      ['post', '/api/privacy-requests', { requestType: 'ACCESS' }],
      ['patch', '/api/privacy-requests/000000000000000000000000', { status: 5 }],
      ['post', '/api/breaches/check', { consent: 'yes' }],
      ['get', '/api/top-k?k=x'],
      ['get', '/api/top-k/groups?limit=x'],
      ['put', '/api/top-k/consent', { enabled: 'true', version: 1 }],
      ['post', '/api/top-k/scans', { provider: 'constructor' }],
      ['post', '/api/top-k/scans', { provider: '__proto__' }],
      ['delete', '/api/top-k/scans/constructor'],
      ['put', '/api/orders/consent', { enabled: true, daily: 'no', version: 1 }],
      ['post', '/api/orders/scans', { provider: 'outlook', mode: 'on_demand', days: '30' }],
      ['delete', '/api/orders/scans/other'],
      ['get', '/api/orders?page=x'],
      ['put', '/api/trace/consent', { enabled: 1 }],
      ['post', '/api/trace/resolve-action', { type: 5 }],
      ['post', `/api/trace/conversations/${conversation.id}/messages`, { content: 'x'.repeat(8001) }],
      ['post', '/api/mail/sync-now', []],
      ['get', '/api/microsoft/subscriptions?page=x'],
    ]
    for (const [method, url, body] of cases) {
      const call = a.agent[method](url)
      const response = await (body === undefined ? call : call.send(body))
      expect(response.status, `${method.toUpperCase()} ${url}`).toBe(400)
      expect(response.body.code, `${method.toUpperCase()} ${url}`).toBe('VALIDATION_ERROR')
      expect(response.body.message).toMatch(/^Invalid [\w.]+\.$/)
    }
  })

  it('lets real client payloads through the Joi gates', async () => {
    const a = await register('authz-ok@example.com')
    const ids = await ownedResources(a)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ breaches: [] }), { status: 200 })))
    const cases = [
      ['post', '/api/breaches/check', { consent: true }],
      ['post', '/api/orders/scans', { provider: 'outlook', mode: 'on_demand', days: 30, merchantDomain: 'shop.example' }],
      ['post', `/api/trace/conversations/${ids.conversation}/messages`, { content: 'hello', responseDetail: 'low', retryMessageId: '000000000000000000000000' }],
      ['post', '/api/trace/resolve-action', { type: 'focus_entity', entityType: 'account', entityId: ids.account }],
    ]
    try {
      for (const [method, url, body] of cases) {
        const response = await a.agent[method](url).send(body)
        expect(response.body.code, `${method.toUpperCase()} ${url}`).not.toBe('VALIDATION_ERROR')
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
