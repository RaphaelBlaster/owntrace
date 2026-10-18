import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import OrderEvent from '../src/models/order-event.model.js'
import OrderScan from '../src/models/order-scan.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import { encryptSecret } from '../src/utils/encryption.js'
import { executeTraceTool } from '../src/services/trace-tools.service.js'
beforeEach(() => vi.stubEnv('INCEPTION_API_KEY', 'synthetic-order-key'))
afterEach(() => vi.unstubAllEnvs())

async function register(email) {
  const agent = request.agent(app)
  const result = await agent.post('/api/auth/register').send({ email, password: 'order tests password strong', name: 'Orders Test' }).expect(201)
  return { agent, id: result.body.user.id }
}
describe('Orders ownership, consent and scan limits', () => {
  it('requires authentication and separate versioned consent before scanning', async () => {
    await request(app).get('/api/orders').expect(401)
    const { agent } = await register('order-consent@example.com')
    await agent.post('/api/orders/scans').send({ provider: 'outlook', mode: 'initial' }).expect(403)
    await agent.put('/api/orders/consent').send({ enabled: true, daily: false, version: 1 }).expect(200)
    await agent.post('/api/orders/scans').send({ provider: 'outlook', mode: 'initial', userId: 'arbitrary' }).expect(400)
    await agent.post('/api/orders/scans').send({ provider: 'outlook', mode: 'initial' }).expect(409)
  })
  it('returns only owned cards and source references; rejects invalid filters and foreign events', async () => {
    const a = await register('order-a@example.com'), b = await register('order-b@example.com')
    const connection = await MicrosoftConnection.create({ userId: a.id, microsoftAccountId: 'order-a', email: 'order-a@example.com', encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })
    const event = await OrderEvent.create({ userId: a.id, connectionId: connection.id, provider: 'outlook', messageIdHash: 'test-message', fingerprint: 'test-fingerprint', merchantName: 'Shop', merchantDomain: 'shop.example', status: 'shipped', summary: 'Shipment reported.', occurredAt: new Date(), policyVersion: 1 })
    const own = await a.agent.get('/api/orders').expect(200)
    expect(own.body.pagination.total).toBe(1)
    expect(own.body.orders[0]).toMatchObject({ id: event.id, merchant: { name: 'Shop', domain: 'shop.example' }, status: 'shipped' })
    expect(JSON.stringify(own.body)).not.toMatch(/messageIdHash|fingerprint|userId/)
    expect((await b.agent.get('/api/orders').expect(200)).body.pagination.total).toBe(0)
    await b.agent.get('/api/orders/' + event.id).expect(404)
    expect((await executeTraceTool(a.id, 'query_orders', { page: 1 })).coverage).toEqual(['orders'])
    expect((await executeTraceTool(a.id, 'open_order', { orderId: event.id })).actions).toEqual([{ type: 'open_order', orderId: event.id }])
    await expect(executeTraceTool(b.id, 'open_order', { orderId: event.id })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
    await a.agent.get('/api/orders?limit=999').expect(400)
    await a.agent.get('/api/orders?provider=arbitrary').expect(400)
  })
  it('uses fixed limits, prevents concurrent scans and cancels queued work on consent revocation', async () => {
    const { agent, id } = await register('order-queue@example.com')
    await MicrosoftConnection.create({ userId: id, microsoftAccountId: 'queue', email: 'order-queue@example.com', encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })
    await agent.put('/api/orders/consent').send({ enabled: true, daily: true, version: 1 }).expect(200)
    const started = await agent.post('/api/orders/scans').send({ provider: 'outlook', mode: 'initial' }).expect(202)
    expect(started.body.scan).toMatchObject({ limit: 200, mode: 'initial', status: 'QUEUED' })
    await agent.post('/api/orders/scans').send({ provider: 'outlook', mode: 'on_demand' }).expect(409)
    await agent.put('/api/orders/consent').send({ enabled: false, daily: false, version: 1 }).expect(200)
    expect((await OrderScan.findOne({ userId: id })).status).toBe('CANCELLED')
    expect((await agent.get('/api/orders/status').expect(200)).body.consent.enabled).toBe(false)
  })
})
