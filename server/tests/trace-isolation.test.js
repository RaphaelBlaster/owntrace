import { once } from 'node:events'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import Conversation from '../src/models/trace-conversation.model.js'
import { createTraceService } from '../src/trace-service.js'
import { requestRemoteTrace } from '../src/services/trace-execution.service.js'

const token = 'test-internal-trace-token-at-least-32-characters'
const servers = []
beforeEach(() => {
  vi.stubEnv('TRACE_PROVIDER', 'azure')
  vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://trace-test.openai.azure.com')
  vi.stubEnv('AZURE_OPENAI_API_KEY', 'test-provider-key')
  vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'test-deployment')
  vi.stubEnv('TRACE_DECISION_PROVIDER', 'provider')
  vi.stubEnv('TRACE_EXECUTION_MODE', 'local')
})
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  vi.unstubAllEnvs()
})
async function start(engine) {
  vi.stubEnv('TRACE_SERVICE_TOKEN', token)
  const server = createTraceService({ engine }).listen(0, '127.0.0.1')
  servers.push(server); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  vi.stubEnv('TRACE_SERVICE_URL', url)
  return { server, url }
}
async function fixture(email = 'isolation@example.com') {
  const agent = request.agent(app)
  const registered = await agent.post('/api/auth/register').send({ name: 'TRACE isolation', email, password: 'secure isolation test password' }).expect(201)
  const id = registered.body.user.id
  await User.updateOne({ _id: id }, { onboardingStatus: 'COMPLETED' })
  await agent.put('/api/trace/consent').send({ enabled: true }).expect(200)
  const cookie = registered.headers['set-cookie'].map(value => value.split(';')[0]).join('; ')
  const messageId = new mongoose.Types.ObjectId()
  const conversation = await Conversation.create({ userId: id, leaseId: 'test-lease', leaseUntil: new Date(Date.now()+60000), messages: [{ _id: messageId, role: 'user', content: 'hello', status: 'pending' }] })
  const job = { conversationId: conversation.id, messageId: messageId.toString(), leaseId: 'test-lease', responseDetail: 'high', provider: 'azure', deadlineAt: Date.now()+40000 }
  return { agent, id, cookie, job }
}
const reply = { role: 'assistant', content: 'Hello from TRACE.', sources: [], actions: [], grounding: [] }

describe('isolated TRACE execution', () => {
  it('authenticates the private service before accepting a job and never exposes public routes', async () => {
    const { url } = await start(vi.fn())
    await request(url).post('/internal/trace/answer').send({}).expect(401)
    await request(url).get('/api/accounts').set('Authorization', `Bearer ${token}`).expect(404)
    await request(url).get('/api/health/ready').set('Authorization', `Bearer ${token}`).expect(200)
  })
  it('loads only the authenticated owned leased turn and rechecks consent during execution', async () => {
    const engine = vi.fn(async (userId, history, content, signal, emit, checkConsent) => {
      expect(content).toBe('hello'); expect(history.at(-1).content).toBe('hello')
      await checkConsent(); emit('delta', { text: reply.content }); return reply
    })
    await start(engine)
    const owner = await fixture()
    const events=[]
    const result = await requestRemoteTrace(owner.job, owner.cookie, new AbortController().signal, (type,data)=>events.push({type,data}))
    expect(result).toEqual(reply); expect(events).toEqual([{type:'delta',data:{text:reply.content}}])
    const other = await fixture('other-isolation@example.com')
    await expect(requestRemoteTrace(owner.job, other.cookie, new AbortController().signal)).rejects.toMatchObject({ code: 'TRACE_NOT_FOUND' })
    await expect(requestRemoteTrace({...owner.job,leaseId:'stale'}, owner.cookie, new AbortController().signal)).rejects.toMatchObject({ code: 'TRACE_NOT_FOUND' })
    await User.updateOne({ _id: owner.id }, { $unset: { traceAiConsent: 1 } })
    await expect(requestRemoteTrace(owner.job, owner.cookie, new AbortController().signal)).rejects.toMatchObject({ code: 'TRACE_CONSENT_REQUIRED' })
    expect(engine).toHaveBeenCalledTimes(1)
  })
  it('aborts child work when the upstream caller cancels and releases admission', async () => {
    let started, stopped
    const running = new Promise(resolve => { started=resolve })
    const cancelled = new Promise(resolve => { stopped=resolve })
    const engine = vi.fn(async (_u,_h,_c,signal) => {
      started(); await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true})); stopped(); signal.throwIfAborted()
    })
    await start(engine); const owner=await fixture()
    const controller=new AbortController()
    const pending=requestRemoteTrace(owner.job,owner.cookie,controller.signal)
    const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'})
    await running; controller.abort(); await rejection; await cancelled
  })
  it('rejects excess work and returns typed provider errors without fallback', async () => {
    vi.stubEnv('TRACE_MAX_CONCURRENT','1')
    let started, finish
    const running=new Promise(resolve=>{started=resolve})
    const held=new Promise(resolve=>{finish=resolve})
    const engine=vi.fn(async ()=>{started();await held;return reply})
    await start(engine); const owner=await fixture(); const other=await fixture('capacity@example.com')
    const first=requestRemoteTrace(owner.job,owner.cookie,new AbortController().signal)
    await running
    await expect(requestRemoteTrace(other.job,other.cookie,new AbortController().signal)).rejects.toMatchObject({code:'TRACE_CAPACITY',statusCode:503})
    finish(); await expect(first).resolves.toEqual(reply)
  })
  it('keeps public ownership/history lifecycle and SSE contract when remote mode is selected', async () => {
    await start(async (_u,_h,_c,_s,emit)=>{emit('delta',{text:reply.content});return reply})
    const owner=await fixture()
    vi.stubEnv('TRACE_EXECUTION_MODE','remote')
    const created=await owner.agent.post('/api/trace/conversations').send({}).expect(201)
    const response=await owner.agent.post(`/api/trace/conversations/${created.body.conversation.id}/messages`).set('Accept','text/event-stream').send({content:'hello'}).expect(200)
    expect(response.text).toContain('event: delta'); expect(response.text).toContain('event: complete')
    const stored=await Conversation.findById(created.body.conversation.id).select('+leaseId')
    expect(stored.messages.at(-1).content).toBe(reply.content);expect(stored.leaseId).toBeNull()
  })
})
