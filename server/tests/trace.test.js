import mongoose from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import Account from '../src/models/account.model.js'
import Conversation from '../src/models/trace-conversation.model.js'
import Subscription from '../src/models/subscription.model.js'
import { executeTraceTool } from '../src/services/trace-tools.service.js'
import { awaitTraceOperation } from '../src/services/trace-abort.js'

async function user(email, enabled = true) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({ name: 'TRACE tester', email, password: 'secure trace test password' }).expect(201)
  await User.updateOne({ _id: response.body.user.id }, { onboardingStatus: 'COMPLETED' })
  if (enabled) await agent.put('/api/trace/consent').send({ enabled: true }).expect(200)
  return { agent, id: response.body.user.id }
}
async function account(userId) {
  return Account.create({ userId, serviceKey: 'spotify.com', serviceName: 'Spotify', primaryDomain: 'spotify.com', confidenceScore: 80, confidenceLevel: 'LIKELY', evidenceCount: 1, ownershipEvidenceCount: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), lastEvaluatedAt: new Date() })
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
beforeEach(() => vi.stubEnv('TRACE_PROVIDER', 'azure'))
function mockProvider(provider, families=[]) {
  vi.stubGlobal('fetch', vi.fn(async (url,options)=>{
    const body=JSON.parse(options.body)
    if(body.tools?.[0]?.function?.name==='plan_trace_retrieval')return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'plan',type:'function',function:{name:'plan_trace_retrieval',arguments:JSON.stringify({requiredFamilies:families})}}]}}]}))
    return provider(url,options)
  }))
}
describe('TRACE authenticated assistant', () => {
  it('stops waiting for slow tools and observes their eventual rejection', async () => {
    const controller = new AbortController()
    let rejectLate
    const waiting = awaitTraceOperation(() => new Promise((_resolve, reject) => { rejectLate = reject }), controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    rejectLate(new Error('Late database error'))
    await new Promise((resolve) => setImmediate(resolve))
    const work = vi.fn()
    expect(() => awaitTraceOperation(work, controller.signal)).toThrow()
    expect(work).not.toHaveBeenCalled()
  })
  it('uses Inception with bearer auth and requires new consent when changing provider', async () => {
    const { agent } = await user('trace-inception@example.com')
    vi.stubEnv('TRACE_PROVIDER', 'inception'); vi.stubEnv('INCEPTION_API_KEY', 'inception-test-key')
    const provider = vi.fn(async (url, options) => {
      expect(url).toBe('https://api.inceptionlabs.ai/v1/chat/completions')
      expect(options.headers.Authorization).toBe('Bearer inception-test-key')
      expect(options.headers['api-key']).toBeUndefined()
      expect(JSON.parse(options.body).model).toBe('mercury-2')
      expect(JSON.parse(options.body).diffusing).toBe(false)
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'General privacy advice from Inception.' } }] }), { status: 200 })
    })
    mockProvider(provider)
    const created = await agent.post('/api/trace/conversations').send({}).expect(201)
    const path = `/api/trace/conversations/${created.body.conversation.id}/messages`
    await agent.post(path).send({ content: 'How do password managers help?' }).expect(403)
    expect(provider).not.toHaveBeenCalled()
    await agent.put('/api/trace/consent').send({ enabled: true }).expect(200)
    await agent.post(path).send({ content: 'How do password managers help?' }).expect(200)
    expect(provider).toHaveBeenCalledTimes(2)
  })
  it('requires recorded Azure processing consent and supports withdrawal', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://trace-test.openai.azure.com')
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key'); vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'test-deployment')
    const { agent } = await user('trace-consent@example.com', false)
    const provider = vi.fn(); vi.stubGlobal('fetch', provider)
    const created = await agent.post('/api/trace/conversations').send({}).expect(201)
    const path = `/api/trace/conversations/${created.body.conversation.id}/messages`
    await agent.post(path).send({ content: 'My accounts?' }).expect(403)
    await agent.put('/api/trace/consent').send({ enabled: true }).expect(200)
    await agent.put('/api/trace/consent').send({ enabled: false }).expect(200)
    await agent.post(path).send({ content: 'My accounts?' }).expect(403)
    expect(provider).not.toHaveBeenCalled()
  })
  it('requires a session and rejects unfinished onboarding', async () => {
    await request(app).get('/api/trace/conversations').expect(401)
    const { agent, id } = await user('trace-onboarding@example.com')
    await User.updateOne({ _id: id }, { onboardingStatus: 'NOT_STARTED' })
    await agent.get('/api/trace/conversations').expect(403)
  })
  it('persists private conversations and hides them from other users', async () => {
    const owner = await user('trace-owner@example.com')
    const other = await user('trace-other@example.com')
    const created = await owner.agent.post('/api/trace/conversations').send({}).expect(201)
    const id = created.body.conversation.id
    await other.agent.get(`/api/trace/conversations/${id}`).expect(404)
    await other.agent.post(`/api/trace/conversations/${id}/messages`).send({ content: 'hello' }).expect(404)
    const list = await owner.agent.get('/api/trace/conversations').expect(200)
    expect(list.body.conversations[0].id).toBe(id)
  })
  it('reports missing Azure configuration without creating a fake answer', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', '')
    const { agent } = await user('trace-config@example.com')
    const created = await agent.post('/api/trace/conversations').send({}).expect(201)
    const id = created.body.conversation.id
    const error = await agent.post(`/api/trace/conversations/${id}/messages`).send({ content: 'Show my subscriptions' }).expect(503)
    expect(error.body.code).toBe('TRACE_NOT_CONFIGURED')
    const saved = await agent.get(`/api/trace/conversations/${id}`).expect(200)
    expect(saved.body.conversation.messages).toHaveLength(0)
  })
  it('executes real scoped account tools, stores evidence and opens a validated account', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://trace-test.openai.azure.com')
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key')
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'test-deployment')
    const owner = await user('trace-tools@example.com')
    const other = await user('trace-tools-other@example.com')
    const own = await account(owner.id)
    const foreign = await account(other.id)
    const payloads = []
    mockProvider(vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body); payloads.push(body)
      const turn = payloads.length
      const message = turn === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 'lookup', type: 'function', function: { name: 'query_accounts', arguments: JSON.stringify({ search: 'Spotify', page: 1 }) } }] }
        : turn === 2 ? { role: 'assistant', content: null, tool_calls: [{ id: 'open', type: 'function', function: { name: 'open_account', arguments: JSON.stringify({ accountId: own.id }) } }] }
          : { role: 'assistant', content: 'Your Spotify account has likely confidence. See its evidence.' }
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
    }), ['accounts'])
    const created = await owner.agent.post('/api/trace/conversations').send({}).expect(201)
    const response = await owner.agent.post(`/api/trace/conversations/${created.body.conversation.id}/messages`).send({ content: 'Show my Spotify account' }).expect(200)
    const reply = response.body.conversation.messages.at(-1)
    expect(reply.content).toContain('Spotify')
    expect(reply.actions).toContainEqual({ type: 'open_account', accountId: own.id })
    expect(reply.sources.some((source) => source.label.includes('Spotify'))).toBe(true)
    expect(JSON.stringify(payloads)).not.toContain(foreign.id)
    expect(payloads[0].model).toBe('test-deployment')
  })
  it('validates input size and unknown conversation IDs', async () => {
    const { agent } = await user('trace-input@example.com')
    await agent.get('/api/trace/conversations/bad-id').expect(404)
    await agent.get(`/api/trace/conversations/${new mongoose.Types.ObjectId()}`).expect(404)
    const created = await agent.post('/api/trace/conversations').send({}).expect(201)
    await agent.post(`/api/trace/conversations/${created.body.conversation.id}/messages`).send({ content: 'x'.repeat(8001) }).expect(400)
  })
  it('revalidates navigation ownership and rejects executable or arbitrary navigation inputs', async () => {
    const owner = await user('trace-navigation@example.com'), other = await user('trace-navigation-other@example.com')
    const own = await account(owner.id), foreign = await account(other.id)
    await owner.agent.post('/api/trace/resolve-action').send({ type: 'open_account', accountId: foreign.id }).expect(404)
    await owner.agent.post('/api/trace/resolve-action').send({ type: 'open_account', accountId: own.id }).expect(200)
    await owner.agent.post('/api/trace/resolve-action').send({ type: 'navigate_to_page', page: 'https://attacker.example' }).expect(400)
    await owner.agent.post('/api/trace/resolve-action').send({ type: 'navigate_to_page', page: 'accounts', selector: 'body' }).expect(400)
    await owner.agent.post('/api/trace/resolve-action').send({ type: 'delete_account', accountId: own.id }).expect(400)
  })
  it('resolves subscription focus using the same actual merged list order and pagination', async () => {
    const owner = await user('trace-subscriptions@example.com'), other = await user('trace-subscriptions-other@example.com')
    const records = []
    for (let i = 0; i < 14; i++) records.push(await Subscription.create({ userId: owner.id, serviceKey: `service${i}.com`, serviceName: `Service ${i}`, primaryDomain: `service${i}.com`, confidenceLevel: 'LIKELY', confidenceScore: 80, evidenceCount: 2, basis: ['PAYMENT'], firstSeenAt: new Date(), lastSeenAt: new Date(Date.now() - i * 10000) }))
    const result = await executeTraceTool(owner.id, 'focus_entity', { entityType: 'subscription', entityId: records.at(-1).id })
    expect(result.actions[0].page).toBe(2)
    const second = await executeTraceTool(owner.id, 'query_subscriptions', { page: 2 })
    expect(second.data.subscriptions.map((item) => item.id)).toContain(records.at(-1).id)
    expect(second.data.pagination.total).toBe(14)
    expect(second.resultSummary).toContainEqual({ resource: 'subscriptions', totalRecords: 14, returnedRecords: 2, page: 2, pages: 2, partial: true, interpretation: 'Recurring-service metadata signals; active billing is not established.' })
    await expect(executeTraceTool(other.id, 'focus_entity', { entityType: 'subscription', entityId: records[0].id })).rejects.toMatchObject({ statusCode: 404 })
  })
  it('reconciles an expired processing lease and marks its question retryable', async () => {
    const { agent, id } = await user('trace-lease@example.com')
    const created = await Conversation.create({ userId: id, leaseId: 'expired-run', leaseUntil: new Date(Date.now() - 1000), messages: [{ role: 'user', content: 'A question', status: 'pending' }] })
    const reconciled = await agent.get(`/api/trace/conversations/${created.id}`).expect(200)
    expect(reconciled.body.conversation.messages[0].status).toBe('failed')
    const stored = await Conversation.findById(created.id).select('+leaseId +leaseUntil')
    expect(stored.leaseId).toBe(null)
  })
  it('persists failed turns and retries the same turn without duplicate questions', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://trace-test.openai.azure.com'); vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key'); vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'test-deployment')
    const { agent } = await user('trace-retry@example.com')
    const created = await agent.post('/api/trace/conversations').send({}).expect(201)
    const path = `/api/trace/conversations/${created.body.conversation.id}`
    mockProvider(vi.fn(async () => new Response('{}', { status: 500 })))
    await agent.post(`${path}/messages`).send({ content: 'Explain privacy health' }).expect(502)
    const failed = await agent.get(path).expect(200)
    expect(failed.body.conversation.messages).toHaveLength(1)
    expect(failed.body.conversation.messages[0].status).toBe('failed')
    mockProvider(vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Privacy health is a derived OwnTrace estimate.' } }] }), { status: 200 })))
    const retried = await agent.post(`${path}/messages`).send({ content: 'Explain privacy health', retryMessageId: failed.body.conversation.messages[0]._id }).expect(200)
    expect(retried.body.conversation.messages).toHaveLength(2)
    expect(retried.body.conversation.messages[0].status).toBe('completed')
  })
  it('streams actual provider text and a persisted completion event over SSE', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://trace-test.openai.azure.com'); vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-key'); vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'test-deployment')
    const { agent } = await user('trace-stream@example.com')
    const chunks = ['Privacy ', 'health is derived.']
    mockProvider(vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body).stream).toBe(true)
      return new Response(chunks.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }))
    const created = await agent.post('/api/trace/conversations').send({}).expect(201)
    const result = await agent.post(`/api/trace/conversations/${created.body.conversation.id}/messages`).set('Accept', 'text/event-stream').send({ content: 'Explain privacy health' }).expect(200)
    expect(result.headers['content-type']).toContain('text/event-stream')
    expect(result.text).toContain('event: delta')
    expect(result.text).toContain('event: complete')
    expect(result.text).toContain('Privacy health is derived.')
  })
})
