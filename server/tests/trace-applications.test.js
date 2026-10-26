import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import { MailAnalysis, MailInsight } from '../src/models/mail-insight.model.js'
import { answerTrace } from '../src/services/trace-assistant.service.js'
import { getTraceProviderConfig } from '../src/services/trace-provider.service.js'
import { executeTraceTool } from '../src/services/trace-tools.service.js'

beforeEach(() => {
  vi.stubEnv('TRACE_PROVIDER', 'inception')
  vi.stubEnv('INCEPTION_API_KEY', 'mercury-test-key')
  vi.stubEnv('TRACE_DECISION_PROVIDER', 'typesafe')
  vi.stubEnv('TYPESAFE_API_KEY', '')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function session(email) {
  const agent = request.agent(app)
  const registered = await agent.post('/api/auth/register').send({ name: 'TRACE test', email, password: 'secure trace test password' }).expect(201)
  await User.updateOne({ _id: registered.body.user.id }, { onboardingStatus: 'COMPLETED' })
  await agent.put('/api/trace/consent').send({ enabled: true }).expect(200)
  const conversation = await agent.post('/api/trace/conversations').send({}).expect(201)
  return { agent, userId: registered.body.user.id, path: `/api/trace/conversations/${conversation.body.conversation.id}/messages` }
}

async function scan(userId, { runId = 'run-current', status = 'COMPLETED', processed = 20 } = {}) {
  return MailAnalysis.create({ userId, enabled: true, version: 1, acceptedAt: new Date(), provider: 'gmail', runId, status, processed, limit: 250 })
}

async function jobInsight(userId, { messageHash = 'job-1', status = 'rejected', runId = 'run-current', companyName = 'Acme', roleName = 'Engineer' } = {}) {
  return MailInsight.create({ userId, provider: 'gmail', connectionId: '64a0e3f11a7432839fcf5a09', messageHash, fingerprint: `${messageHash}-fingerprint`, runId, category: 'jobs', eventKind: 'application', enrichmentVersion: 2, senderDomain: 'jobs.example', companyName, companyDomain: 'acme.com', roleName, applicationReference: 'APP-17', referenceType: 'application', title: `${companyName} application`, status, summary: `Application status: ${status}`, evidence: `Your application was ${status}.`, occurredAt: new Date(), analyzedBy: 'mercury' })
}

function mockMercury({ plan = ['applications'], afterPlan, afterQuery, final = 'Your saved application status is supported by its timeline.' } = {}) {
  const bodies = []
  let toolRound = 0
  const fetch = vi.fn(async (url, options) => {
    expect(String(url)).toBe('https://api.inceptionlabs.ai/v1/chat/completions')
    const body = JSON.parse(options.body); bodies.push(body)
    if (body.tools?.[0]?.function?.name === 'plan_trace_retrieval') return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'plan_trace_retrieval', arguments: JSON.stringify({ requiredFamilies: plan }) } }] } }] }))
    if (body.tools?.length) {
      toolRound += 1
      if (toolRound === 1) return afterPlan?.(body, bodies) || new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'query', type: 'function', function: { name: 'query_mail_insights', arguments: JSON.stringify({ category: 'jobs', status: 'rejected', search: '', page: 1, kind: 'applications' }) } }] } }] }))
      if (toolRound === 2) return afterQuery?.(body, bodies) || new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'finish', type: 'function', function: { name: 'finish_answer', arguments: JSON.stringify({ presentation: 'chat', view: 'none', entityId: '' }) } }] } }] }))
      if (afterQuery) return afterQuery(body, bodies)
      throw new Error('Unexpected additional tool round')
    }
    toolRound += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: final } }] }))
  })
  return { fetch, bodies }
}

describe('TRACE saved application retrieval', () => {
  it('includes current Top K scan status without exposing its cursor or lease', async () => {
    const { userId } = await session('trace-topk-status@example.com')
    await scan(userId, { status: 'RUNNING', processed: 25 })
    await MailAnalysis.updateOne({ userId }, { $set: { cursor: 'private-provider-cursor', leaseId: 'private-lease' } })
    const result = await executeTraceTool(userId, 'workspace_status', {})
    expect(result.data.mailAnalysis).toMatchObject({ status: 'RUNNING', processed: 25, limit: 250 })
    expect(JSON.stringify(result)).not.toMatch(/private-provider-cursor|private-lease/)
  })
  it('answers job-status questions from the authenticated user’s fresh grouped application data', async () => {
    const owner = await session('trace-applicant@example.com'), other = await session('trace-applicant-other@example.com')
    await scan(owner.userId); await scan(other.userId)
    await jobInsight(owner.userId)
    await jobInsight(other.userId, { messageHash: 'foreign-job', companyName: 'Private Co' })
    const { fetch, bodies } = mockMercury({ final: 'Your Acme Engineer application is marked rejected in the saved timeline.' })
    vi.stubGlobal('fetch', fetch)

    let result
    try { result = await answerTrace(owner.userId, [], 'Show my jobs and application rejections.', new AbortController().signal, undefined, async () => {}, getTraceProviderConfig(), 'high') }
    catch (error) { throw new Error(error.stack || String(error)) }
    const assistant = result
    expect(assistant.content).toContain('Acme')
    const queryRequest = bodies.find(body => body.tools?.some(tool => tool.function.name === 'query_mail_insights'))
    expect(queryRequest).toBeDefined()
    expect(queryRequest.tools.find(tool => tool.function.name === 'query_mail_insights').function.parameters.properties.kind.enum).toEqual(['applications', 'opportunities', 'all'])
    const exposedToolResult = bodies.flatMap(body => body.messages).find(message => message.role === 'tool' && message.content?.includes('Acme'))
    expect(exposedToolResult?.content).not.toContain('Private Co')
    expect(assistant.grounding.map(item => item.tool)).toContain('query_mail_insights')
    expect(fetch.mock.calls.every(([url]) => String(url) === 'https://api.inceptionlabs.ai/v1/chat/completions')).toBe(true)
  })

  it('does not read records for a greeting and does not require the Jev key', async () => {
    const { agent, path } = await session('trace-greeting-no-jev@example.com')
    const lookup = vi.spyOn(MailInsight, 'find')
    const { fetch, bodies } = mockMercury({ plan: [], afterPlan: () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'finish', type: 'function', function: { name: 'finish_answer', arguments: JSON.stringify({ presentation: 'chat', view: 'none', entityId: '' }) } }] } }] })), final: 'Hello! How can I help with OwnTrace?' })
    vi.stubGlobal('fetch', fetch)

    const status = await agent.get('/api/trace/status').expect(200)
    expect(status.body.configured).toBe(true)
    await agent.post(path).send({ content: 'Hi there' }).expect(200)
    expect(lookup).not.toHaveBeenCalled()
    expect(bodies.some(body => body.tools?.some(tool => tool.function.name === 'query_mail_insights'))).toBe(false)
    expect(fetch.mock.calls.every(([url]) => String(url) === 'https://api.inceptionlabs.ai/v1/chat/completions')).toBe(true)
  })

  it('retrieves applications and opportunities independently in the same turn', async () => {
    const { userId } = await session('trace-mixed-jobs@example.com')
    await scan(userId)
    await jobInsight(userId)
    const { fetch, bodies } = mockMercury({ plan: ['applications', 'opportunities'], afterPlan: () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: ['applications', 'opportunities'].map(kind => ({ id: kind, type: 'function', function: { name: 'query_mail_insights', arguments: JSON.stringify({ category: 'jobs', status: '', search: '', page: 1, kind }) } })) } }] })) })
    vi.stubGlobal('fetch', fetch)
    const result = await answerTrace(userId, [], 'Show my applications and job alerts separately.', new AbortController().signal, undefined, async () => {}, getTraceProviderConfig())
    expect(result.grounding.filter(item => item.tool === 'query_mail_insights').map(item => item.query.kind)).toEqual(['applications', 'opportunities'])
    const toolResults = bodies.at(-1).messages.filter(item => ['applications', 'opportunities'].includes(item.tool_call_id)).map(item => JSON.parse(item.content))
    expect(toolResults.every(item => !item.error)).toBe(true)
  })

  it.each(['jobs', ''])('a combined %s lookup satisfies both application and opportunity retrieval without repeated calls', async category => {
    const { userId } = await session(`trace-combined-${category || 'all'}@example.com`)
    await scan(userId)
    await jobInsight(userId)
    const { fetch } = mockMercury({ plan: ['applications', 'opportunities'], afterPlan: () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'query', type: 'function', function: { name: 'query_mail_insights', arguments: JSON.stringify({ category, status: '', search: '', page: 1, kind: 'all' }) } }] } }] })) })
    vi.stubGlobal('fetch', fetch)
    const result = await answerTrace(userId, [], 'Compare my applications and job opportunities.', new AbortController().signal, undefined, async () => {}, getTraceProviderConfig())
    expect(result.grounding.filter(item => item.tool === 'query_mail_insights')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each(['NOT_SCANNED', 'RUNNING'])('passes %s coverage to the final answer rather than presenting an empty lookup as absence', async status => {
    const { userId } = await session(`trace-coverage-${status.toLowerCase()}@example.com`)
    if (status !== 'NOT_SCANNED') await scan(userId, { status, processed: 25 })
    const { fetch, bodies } = mockMercury({ final: 'Saved analysis is incomplete; I cannot conclude there are no applications.' })
    vi.stubGlobal('fetch', fetch)
    const result = await answerTrace(userId, [], 'Do I have rejected applications?', new AbortController().signal, undefined, async () => {}, getTraceProviderConfig())
    expect(result.content).toContain('Scan coverage is '+status.toLowerCase().replaceAll('_', ' '))
    expect(result.content).not.toContain('no applications')
  })

  it('exposes unresolved jobs and pending enrichment even when application filtering returns nothing', async () => {
    const { userId } = await session('trace-unresolved-jobs@example.com')
    await scan(userId)
    await jobInsight(userId, { status: 'unknown' })
    await MailInsight.updateMany({ userId }, { $set: { eventKind: 'other', enrichmentVersion: 1 } })
    const { fetch, bodies } = mockMercury({ final: 'Some job messages still need classification; no confirmed rejection is saved.' })
    vi.stubGlobal('fetch', fetch)
    const result = await answerTrace(userId, [], 'Have I applied anywhere?', new AbortController().signal, undefined, async () => {}, getTraceProviderConfig())
    expect(result.content).toContain('1 job messages across the saved scan have ambiguous linkage')
    expect(result.content).toContain('1 saved job messages have not received')
  })

  it('grounds status answers across the saved result set instead of only the first page', async () => {
    const { userId } = await session('trace-status-pagination@example.com')
    await scan(userId)
    for (let index = 0; index < 7; index += 1) {
      const record = await jobInsight(userId, { messageHash: `status-${index}`, status: index === 0 ? 'rejected' : 'application_received' })
      await MailInsight.updateOne({ _id: record._id }, { $set: { applicationReference: `APP-${index}`, occurredAt: new Date(2026, 9, index + 1) } })
    }
    const { fetch, bodies } = mockMercury({ afterPlan: () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'query', type: 'function', function: { name: 'query_mail_insights', arguments: JSON.stringify({ category: 'jobs', status: '', search: '', page: 1, kind: 'applications' }) } }] } }] })) })
    vi.stubGlobal('fetch', fetch)
    const result = await answerTrace(userId, [], 'Show my jobs and any rejections.', new AbortController().signal, undefined, async () => {}, getTraceProviderConfig())
    expect(result.content).toContain('Rejected: 1')
    expect(result.content).toContain('6 of 7 matching groups')
    expect(result.content).toContain('not a verified application count')
    expect(result.sources).toEqual([{ label: 'Saved email insights', action: { type: 'navigate_to_page', page: 'top-k' } }])
  })

  it('never emits fabricated model prose after a job-result lookup, including SSE output', async () => {
    const { userId } = await session('trace-grounded-renderer@example.com')
    await scan(userId)
    await jobInsight(userId, { status: 'interview' })
    const fabricated = 'There are no interviews or rejections. Your confirmed company is FakeCorp.'
    const { fetch } = mockMercury({ afterPlan: () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'query', type: 'function', function: { name: 'query_mail_insights', arguments: JSON.stringify({ category: 'jobs', status: '', search: '', page: 1, kind: 'all' }) } }] } }] })), afterQuery: () => new Response(JSON.stringify({ choices: [{ message: { content: fabricated } }] })), final: fabricated })
    vi.stubGlobal('fetch', fetch)
    const onEvent = vi.fn()
    const result = await answerTrace(userId, [], 'Show applications and interview replies.', new AbortController().signal, onEvent, async () => {}, getTraceProviderConfig())
    expect(result.content).toContain('Interview: 1')
    expect(result.content).toContain('Acme — Engineer: Interview')
    expect(result.content).not.toContain(fabricated)
    expect(result.content).not.toContain('FakeCorp')
    expect(onEvent).toHaveBeenCalledWith('delta', { text: result.content })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('requires actual application retrieval before finalizing a personal jobs answer', async () => {
    const { agent, path } = await session('trace-app-coverage@example.com')
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetch } = mockMercury({ afterPlan: () => new Response(JSON.stringify({ choices: [{ message: { content: 'You have several rejected applications.' } }] })), afterQuery: () => new Response(JSON.stringify({ choices: [{ message: { content: 'You have several rejected applications.' } }] })) })
    vi.stubGlobal('fetch', fetch)

    await agent.post(path).send({ content: 'How many applications were rejected?' }).expect(422)
    expect(fetch).toHaveBeenCalledTimes(8)
    expect(diagnostic).toHaveBeenCalledWith('[trace] tool_limit', { missingFamilies: ['applications'], tools: [], errorCodes: [] })
  })

  it('keeps a successful empty query distinct from an unavailable read', async () => {
    const { agent, userId, path } = await session('trace-no-apps@example.com')
    await scan(userId)
    const { fetch } = mockMercury({ final: 'The completed scan found no saved matching application records.' })
    vi.stubGlobal('fetch', fetch)

    const result = await agent.post(path).send({ content: 'Any saved application rejections?' }).expect(200)
    expect(result.body.conversation.messages.at(-1).grounding.map(item => item.tool)).toContain('query_mail_insights')
    expect(JSON.stringify(result.body.conversation.messages.at(-1))).toContain('query_mail_insights')
  })

  it('fails closed when the relevant mail-insight lookup is unavailable', async () => {
    const { agent, userId, path } = await session('trace-app-query-failure@example.com')
    await scan(userId)
    vi.spyOn(MailInsight, 'find').mockImplementation(() => { throw new Error('database unavailable') })
    const { fetch } = mockMercury()
    vi.stubGlobal('fetch', fetch)

    await agent.post(path).send({ content: 'Show my application status.' }).expect(502)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
