import { afterEach, describe, expect, it, vi } from 'vitest'
import User from '../src/models/user.model.js'
import OrderEvent from '../src/models/order-event.model.js'
import OrderReceipt from '../src/models/order-receipt.model.js'
import OrderScan from '../src/models/order-scan.model.js'
import OrderPreference from '../src/models/order-preference.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import { encryptSecret } from '../src/utils/encryption.js'
import { enqueueDaily, processOrderScan, startOrderScan } from '../src/services/order-scan.service.js'
import OrderBudget from '../src/models/order-budget.model.js'
import { cancelOrderWork, removeOrderSource } from '../src/services/order-control.service.js'
import { orderGraphUrl } from '../src/services/order-mail.service.js'
const choice = (selected, keys) => ({ type: 'choice', choice: selected, probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? 1 : 0])) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function setup() {
  vi.stubEnv('INCEPTION_API_KEY', 'synthetic-order-key')
  const user = await User.create({ name: 'Order Worker', email: 'order-worker@example.com', passwordHash: 'synthetic-hash' })
  await OrderPreference.create({ userId: user.id, enabled: true, version: 1, acceptedAt: new Date() })
  const connection = await MicrosoftConnection.create({ userId: user.id, microsoftAccountId: 'worker', email: user.email, encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })
  return { user, connection }
}
function mockProvider(subjects, { next = false, invalidIndex = -1 } = {}) {
  const messages = subjects.map((subject, index) => ({ id: 'message-' + index, from: { emailAddress: { address: 'orders@shop.example' } }, subject, receivedDateTime: new Date(Date.now() - 60000).toISOString() }))
  const mock = vi.fn(async (url, options) => {
    if (String(url).startsWith('https://graph.microsoft.com')) {
      expect(String(url)).not.toMatch(/body|attachments/)
      return new Response(JSON.stringify({ value: messages, ...(next ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id,from,subject,receivedDateTime&$top=25&$skiptoken=next' } : {}) }))
    }
    const body = JSON.parse(options.body)
    if (String(url).endsWith('/decisions')) {
      const answers = {}
      body.state.messages.forEach((message, index) => {
        answers['kind_' + index] = choice(message.subject.includes('birthday') ? 'personal' : 'transactional', ['personal','transactional','unknown'])
        answers['category_' + index] = choice('order', ['order','subscription','marketing','other','unknown'])
      })
      return new Response(JSON.stringify({ answers }))
    }
    const inputs = JSON.parse(body.messages[1].content).messages
    const cards = inputs.map((input, index) => ({ index, merchantName: 'Shop', status: 'shipped', orderReference: null, amountMinor: index === invalidIndex ? 123 : null, currency: index === invalidIndex ? 'USD' : null, expectedDelivery: null, summary: 'Shipment reported.', statusEvidence: 'shipped', referenceEvidence: null, amountEvidence: null, deliveryEvidence: null }))
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'emit_order_cards', arguments: JSON.stringify({ cards }) } }] } }] }))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
describe('durable metadata-first order worker', () => {
  it('stores card JSON, skips personal/verification mail and deduplicates repeat scans', async () => {
    const { user } = await setup()
    const mock = mockProvider(['Your order shipped', 'Happy birthday from a friend', 'Your verification code is 123456'])
    const scan = await startOrderScan(user.id, 'outlook', 'initial')
    await processOrderScan(scan.id)
    expect(await OrderEvent.countDocuments({ userId: user.id })).toBe(1)
    expect(await OrderReceipt.countDocuments({ userId: user.id })).toBe(3)
    expect((await OrderScan.findById(scan.id)).status).toBe('COMPLETED')
    const aiCalls = mock.mock.calls.filter(([url]) => !String(url).startsWith('https://graph'))
    expect(JSON.stringify(aiCalls)).not.toContain('123456')
    expect(JSON.stringify(aiCalls)).not.toContain('orders@shop.example')
    const retry = await startOrderScan(user.id, 'outlook', 'on_demand')
    await processOrderScan(retry.id)
    expect(mock.mock.calls.filter(([url]) => !String(url).startsWith('https://graph'))).toHaveLength(aiCalls.length)
    expect(await OrderEvent.countDocuments()).toBe(1)
  })
  it('persists good cards independently and sends unsupported extracted items to review', async () => {
    const { user } = await setup()
    mockProvider(['Order one shipped', 'Order two shipped'], { invalidIndex: 1 })
    const scan = await startOrderScan(user.id, 'outlook', 'initial')
    await processOrderScan(scan.id)
    expect(await OrderEvent.countDocuments()).toBe(1)
    expect((await OrderScan.findById(scan.id)).reviewed).toBe(1)
  })
  it('fails closed on classification outage and preserves the checkpoint for retry', async () => {
    const { user } = await setup()
    mockProvider(['Order shipped'])
    const original = fetch
    vi.stubGlobal('fetch', vi.fn((url, options) => String(url).endsWith('/decisions') ? Promise.resolve(new Response('{}', { status: 503 })) : original(url, options)))
    const scan = await startOrderScan(user.id, 'outlook', 'initial')
    await processOrderScan(scan.id)
    expect(await OrderEvent.countDocuments()).toBe(0)
    expect((await OrderScan.findById(scan.id)).status).toBe('FAILED')
    const retry = await startOrderScan(user.id, 'outlook', 'on_demand')
    expect(retry.since.getTime()).toBe(scan.since.getTime())
    expect(retry.until.getTime()).toBe(scan.until.getTime())
  })
  it('invalidates queued work and deletes source-owned order data on disconnection', async () => {
    const { user, connection } = await setup()
    mockProvider(['Order shipped'])
    const scan = await startOrderScan(user.id, 'outlook', 'initial')
    await cancelOrderWork(user.id, 'outlook')
    await processOrderScan(scan.id)
    expect(fetch).not.toHaveBeenCalled()
    await removeOrderSource(user.id, 'outlook', connection.id)
    expect(await OrderScan.countDocuments()).toBe(0)
  })
  it('refuses changed Graph selection fields, unrelated hosts and unsupported pages', () => {
    const base = { cursor: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=body&$top=25' }
    expect(() => orderGraphUrl(base, 25)).toThrow()
    expect(() => orderGraphUrl({ cursor: 'https://evil.example/messages?$select=id,from,subject,receivedDateTime&$top=25' }, 25)).toThrow()
  })
  it('preserves a bounded-page backlog and resumes with the smaller on-demand allowance', async () => {
    const { user } = await setup()
    mockProvider(['Order shipped'], { next: true })
    const scan = await startOrderScan(user.id, 'outlook', 'initial')
    await OrderScan.updateOne({ _id: scan.id }, { $set: { limit: 1 } })
    await Promise.all([processOrderScan(scan.id), processOrderScan(scan.id)])
    const paused = await OrderScan.findById(scan.id).select('+cursor')
    expect(paused.status).toBe('PAUSED')
    expect(paused.cursor).toContain('$skiptoken=next')
    const resumed = await startOrderScan(user.id, 'outlook', 'on_demand')
    expect(resumed.limit).toBe(50)
    expect((await OrderScan.findById(scan.id).select('+cursor')).cursor).toBe(paused.cursor)
    await cancelOrderWork(user.id)
    await expect(startOrderScan(user.id, 'outlook', 'on_demand')).rejects.toMatchObject({ code: 'ORDER_SCAN_COOLDOWN' })
  })
  it('pauses before provider calls once the global analysis allowance is exhausted', async () => {
    const { user } = await setup()
    mockProvider(['Order shipped'])
    await OrderBudget.create({ owner: 'global', day: new Date().toISOString().slice(0,10), modelUnits: 500000, expiresAt: new Date(Date.now() + 86400000) })
    const scan = await startOrderScan(user.id, 'outlook', 'initial')
    await processOrderScan(scan.id)
    expect(fetch.mock.calls).toHaveLength(1)
    expect((await OrderScan.findById(scan.id)).lastErrorCode).toBe('ORDER_DAILY_BUDGET')
    expect(await OrderEvent.countDocuments()).toBe(0)
  })
  it('enqueues only opted-in daily jobs and does not duplicate them on repeated ticks', async () => {
    const { user } = await setup()
    await OrderPreference.updateOne({ userId: user.id }, { $set: { daily: true, nextDailyAt: new Date(Date.now() - 1000) } })
    await enqueueDaily()
    await enqueueDaily()
    expect(await OrderScan.countDocuments({ userId: user.id })).toBe(1)
    expect((await OrderScan.findOne({ userId: user.id })).mode).toBe('daily')
    expect((await OrderPreference.findOne({ userId: user.id })).nextDailyAt.getTime()).toBeGreaterThan(Date.now())
  })
})
