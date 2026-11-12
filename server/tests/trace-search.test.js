import mongoose from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrderEvent from '../src/models/order-event.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import Subscription from '../src/models/subscription.model.js'
import { encryptSecret } from '../src/utils/encryption.js'
import { groupMailInsights, paginateInsights } from '../src/services/mail-insight-query.service.js'
import { executeTraceTool, normalizeToolArgs, traceToolsForCoverage, validateTool, validateTracePlan } from '../src/services/trace-tools.service.js'
import { traceCompletion } from '../src/services/trace-provider.service.js'

afterEach(() => vi.unstubAllGlobals())
const config = { provider: 'inception', url: 'https://api.inceptionlabs.ai/v1/chat/completions', key: 'test', model: 'mercury-2', label: 'Inception Labs' }
const sse = (events, { done = true, trailing = true } = {}) => new Response(events.map(item => `data: ${JSON.stringify(item)}`).join('\n\n') + (trailing ? '\n\n' : '') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } })
const toolChunk = (finish) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'workspace_status', arguments: '{}' } }] }, finish_reason: finish }] })
const tools = [{ type: 'function', function: { name: 'workspace_status', parameters: { type: 'object', properties: {} } } }]

describe('mail insight search', () => {
  const event = (id, overrides = {}) => ({ _id: id, category: 'jobs', companyName: 'Nestlé', roleName: 'Software Engineer Intern', eventKind: 'application', applicationReference: `REF-${id}`, referenceType: 'application', status: 'application_received', occurredAt: new Date('2026-10-01'), summary: 'Application received', senderDomain: 'myworkday.com', ...overrides })
  const groups = groupMailInsights([event('1'), event('2', { companyName: 'Acme', roleName: 'Data Analyst' })])
  it('matches every whitespace token across fields, case- and accent-insensitively', () => {
    expect(paginateInsights(groups, { search: 'nestle engineer' }).insights.map(group => group.company.name)).toEqual(['Nestlé'])
    expect(paginateInsights(groups, { search: 'ACME   analyst' }).insights.map(group => group.company.name)).toEqual(['Acme'])
    expect(paginateInsights(groups, { search: 'acme engineer' }).insights).toHaveLength(0)
    expect(paginateInsights(groups, { search: 'myworkday' }).insights).toHaveLength(2)
    expect(paginateInsights(groups, { search: '   ' }).insights).toHaveLength(2)
  })
})

describe('order and subscription search tools', () => {
  it('narrows orders by merchant or item with an escaped bounded search', async () => {
    const userId = new mongoose.Types.ObjectId().toString()
    const connection = await MicrosoftConnection.create({ userId, microsoftAccountId: `search-${userId}`, email: 'search@example.com', encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })
    const base = { userId, connectionId: connection.id, provider: 'outlook', fingerprint: 'f', status: 'shipped', occurredAt: new Date(), policyVersion: 1 }
    await OrderEvent.create({ ...base, messageIdHash: 'a', merchantName: 'Amazon', merchantDomain: 'amazon.in', summary: 'Kindle Paperwhite shipped.' })
    await OrderEvent.create({ ...base, messageIdHash: 'b', merchantName: 'Flipkart', merchantDomain: 'flipkart.com', summary: 'Headphones shipped.' })
    const amazon = await executeTraceTool(userId, 'query_orders', normalizeToolArgs('query_orders', { search: 'my Amazon order' }))
    expect(amazon.query.search).toBe('Amazon')
    expect(amazon.data.orders.map(order => order.merchant.name)).toEqual(['Amazon'])
    expect((await executeTraceTool(userId, 'query_orders', { search: 'kindle', page: 1 })).data.pagination.total).toBe(1)
    expect((await executeTraceTool(userId, 'query_orders', { search: '.*', page: 1 })).data.pagination.total).toBe(0)
    expect((await executeTraceTool(userId, 'query_orders', normalizeToolArgs('query_orders', { search: 'orders' }))).data.pagination.total).toBe(2)
    expect(() => validateTool('query_orders', { search: 'x'.repeat(81), page: 1 })).toThrow()
  })
  it('narrows merged subscriptions by service name or domain', async () => {
    const userId = new mongoose.Types.ObjectId().toString()
    const row = (name, domain) => ({ userId, serviceKey: domain, serviceName: name, primaryDomain: domain, confidenceLevel: 'LIKELY', confidenceScore: 80, evidenceCount: 1, basis: ['PAYMENT'], firstSeenAt: new Date(), lastSeenAt: new Date() })
    await Subscription.create(row('Netflix', 'netflix.com'))
    await Subscription.create(row('Spotify', 'spotify.com'))
    const netflix = await executeTraceTool(userId, 'query_subscriptions', normalizeToolArgs('query_subscriptions', { search: 'Netflix subscription' }))
    expect(netflix.data.subscriptions.map(item => item.serviceName)).toEqual(['Netflix'])
    expect(netflix.data.pagination.total).toBe(1)
    expect((await executeTraceTool(userId, 'query_subscriptions', { search: 'spotify.com', page: 1 })).data.subscriptions.map(item => item.serviceName)).toEqual(['Spotify'])
    expect((await executeTraceTool(userId, 'query_subscriptions', { search: '', page: 1 })).data.pagination.total).toBe(2)
  })
  it('sends the search parameter to providers without non-portable keywords', () => {
    const [orders] = traceToolsForCoverage(['orders']).filter(tool => tool.function.name === 'query_orders')
    expect(orders.function.parameters.properties.search).toEqual({ type: 'string' })
    expect(orders.function.parameters.required).toContain('search')
  })
})

describe('retrieval plan family synonyms', () => {
  it('normalizes near-miss family names before rejecting', () => {
    expect(validateTracePlan({ requiredFamilies: ['jobs', 'Job Applications', 'subs', 'purchases', 'mail_insights', 'breaches'] })).toEqual(['applications', 'subscriptions', 'orders', 'mailInsights', 'security'])
    expect(() => validateTracePlan({ requiredFamilies: ['weather'] })).toThrow()
  })
})

describe('provider stream recovery', () => {
  it('retries a truncated tool round once with a higher cap', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(sse([toolChunk('length')])).mockResolvedValueOnce(sse([toolChunk('tool_calls')]))
    vi.stubGlobal('fetch', fetch)
    const reply = await traceCompletion([], tools, new AbortController().signal, () => {}, config, { maxTokens: 1000 })
    expect(reply.tool_calls[0].function.name).toBe('workspace_status')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body).max_completion_tokens).toBe(2000)
  })
  it('returns a recoverable truncated round after a second length stop', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => sse([toolChunk('length')])))
    await expect(traceCompletion([], tools, new AbortController().signal, () => {}, config)).resolves.toMatchObject({ truncated: true })
  })
  it('still fails a truncated final prose answer', async () => {
    const fetch = vi.fn().mockResolvedValue(sse([{ choices: [{ delta: { content: 'Partial' }, finish_reason: 'length' }] }]))
    vi.stubGlobal('fetch', fetch)
    await expect(traceCompletion([], [], new AbortController().signal, vi.fn(), config)).rejects.toMatchObject({ code: 'TRACE_PROVIDER_ERROR' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('flushes a final event left in the buffer without a trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([{ choices: [{ delta: { content: 'Hello' } }] }, { choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] }], { done: false, trailing: false })))
    const onText = vi.fn()
    await expect(traceCompletion([], [], new AbortController().signal, onText, config)).resolves.toMatchObject({ content: 'Hello there' })
    expect(onText).toHaveBeenCalledTimes(2)
  })
})
