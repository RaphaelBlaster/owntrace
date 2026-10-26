import { afterEach, expect, it, vi } from 'vitest'
import { traceCompletion } from '../src/services/trace-provider.service.js'
import { answerTrace } from '../src/services/trace-assistant.service.js'
import request from 'supertest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import Conversation from '../src/models/trace-conversation.model.js'

const config = { provider: 'inception', url: 'https://api.inceptionlabs.ai/v1/chat/completions', key: 'test', model: 'mercury-2', label: 'Inception Labs' }
const filtered = () => new Response('data: {"error":{"code":"content_filter","type":"content_filter_error"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
const history = [{ role: 'assistant', status: 'completed', content: 'PRIVATE OLD RECORD TEXT', grounding: [{ tool: 'query_mail_insights', query: { category: 'jobs', kind: 'applications' } }] }]
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('distinguishes a provider moderation refusal from a transport failure without retrying it', async () => {
  const fetch = vi.fn().mockImplementation(filtered)
  vi.stubGlobal('fetch', fetch)
  await expect(traceCompletion([], [], new AbortController().signal, vi.fn(), config)).rejects.toMatchObject({ code: 'TRACE_PROVIDER_CONTENT_FILTER' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('completes the filtered jobs followup with a safe page reference and location clarification', async () => {
  const fetch = vi.fn().mockImplementation(filtered), event = vi.fn(), consent = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const result = await answerTrace('owner', history, 'can u show where r they located ??', new AbortController().signal, event, consent, config)
  expect(result.content).toContain('Top K')
  expect(result.content).toMatch(/location/i)
  expect(result.content).toMatch(/provider declined/i)
  expect(result.content).not.toContain('PRIVATE OLD RECORD TEXT')
  expect(result.sources).toEqual([{ label: 'Saved email insights', action: { type: 'navigate_to_page', page: 'top-k' } }])
  expect(result.actions).toEqual([])
  expect(event).toHaveBeenCalledWith('delta', { text: result.content })
  expect(consent).toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not reuse failed context or bypass withdrawn consent on a filtered request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(filtered))
  const result = await answerTrace('owner', [{ ...history[0], status: 'failed' }], 'where?', new AbortController().signal, vi.fn(), undefined, config)
  expect(result.sources).toEqual([])
  await expect(answerTrace('owner', history, 'where?', new AbortController().signal, vi.fn(), async () => { throw Object.assign(new Error('Withdrawn'), { code: 'TRACE_CONSENT_REQUIRED' }) }, config)).rejects.toMatchObject({ code: 'TRACE_CONSENT_REQUIRED' })
})

it('streams and persists a completed followup instead of another failed user turn', async () => {
  vi.stubEnv('TRACE_PROVIDER', 'inception'); vi.stubEnv('INCEPTION_API_KEY', 'test')
  const agent = request.agent(app)
  const registered = await agent.post('/api/auth/register').send({ name: 'Followup tester', email: 'followup@example.com', password: 'a secure test password' }).expect(201)
  await User.updateOne({ _id: registered.body.user.id }, { onboardingStatus: 'COMPLETED' })
  await agent.put('/api/trace/consent').send({ enabled: true }).expect(200)
  const created = await agent.post('/api/trace/conversations').send({}).expect(201)
  const id = created.body.conversation.id
  await Conversation.updateOne({ _id: id }, { $push: { messages: { $each: [{ role: 'user', status: 'completed', content: 'Summarize my applications' }, history[0]] } } })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(filtered))
  const reply = await agent.post(`/api/trace/conversations/${id}/messages`).set('Accept', 'text/event-stream').send({ content: 'can u show where r they located ??' }).expect(200)
  expect(reply.text).toContain('event: complete')
  expect(reply.text).not.toContain('event: error')
  const saved = await Conversation.findById(id)
  expect(saved.messages.at(-2).status).toBe('completed')
  expect(saved.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'completed' })
  expect(saved.messages.at(-1).content).toContain('Top K')
})
