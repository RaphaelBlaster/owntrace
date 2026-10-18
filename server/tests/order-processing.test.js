import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeMetadata, validateCard, classifyBatch, extractCards } from '../src/services/order-processing.service.js'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const input = { senderDomain: 'shop.example', subject: 'Order #AB123 shipped - USD 29.99', occurredAt: new Date().toISOString() }
const card = { index: 0, merchantName: 'Shop', status: 'shipped', orderReference: 'AB123', amountMinor: 2999, currency: 'USD', expectedDelivery: null, summary: 'Order AB123 has shipped.', statusEvidence: 'shipped', referenceEvidence: 'Order #AB123', amountEvidence: 'USD 29.99', deliveryEvidence: null }
const choice = (selected, keys) => ({ type: 'choice', choice: selected, confidence: .98, probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? .98 : .02 / (keys.length - 1)])) })
describe('metadata order extraction boundaries', () => {
  it('skips verification mail locally and removes addresses, URLs and long numbers', () => {
    expect(sanitizeMetadata({ ...input, subject: 'Your verification code is 123456' })).toBeNull()
    const result = sanitizeMetadata({ ...input, subject: 'Order #AB123 shipped to me@example.com https://evil.example/x 9876543210' })
    expect(result.subject).not.toMatch(/me@example|https:|9876543210/)
    expect(result.subject).toContain('AB123')
    expect(result).not.toHaveProperty('body')
  })
  it('rejects unsupported facts and arbitrary fields; keeps merchant domains anchored to the sender', () => {
    expect(validateCard(card, input)).toMatchObject({ merchantName: 'Shop', merchantDomain: 'shop.example', amountMinor: 2999 })
    expect(() => validateCard({ ...card, amountMinor: 100 }, input)).toThrow()
    expect(() => validateCard({ ...card, orderReference: 'INVENTED' }, input)).toThrow()
    expect(() => validateCard({ ...card, expectedDelivery: '2026-12-01', deliveryEvidence: 'tomorrow' }, input)).toThrow()
    expect(() => validateCard({ ...card, logoUrl: 'https://evil.example' }, input)).toThrow()
  })
  it('uses Decision API for classification and treats ambiguous probabilities as review', async () => {
    vi.stubEnv('INCEPTION_API_KEY', 'synthetic-order-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {
      kind_0: choice('transactional', ['personal', 'transactional', 'unknown']),
      category_0: choice('order', ['order', 'subscription', 'marketing', 'other', 'unknown']),
    } }))))
    expect(await classifyBatch([input], AbortSignal.timeout(1000))).toEqual(['order'])
    expect(JSON.parse(fetch.mock.calls[0][1].body).state.messages[0]).not.toHaveProperty('body')
    expect(fetch.mock.calls[0][0]).toBe('https://api.inceptionlabs.ai/v1/decisions')
  })
  it('requires exact one-to-one JSON output and rejects duplicate or unknown input indexes', async () => {
    vi.stubEnv('INCEPTION_API_KEY', 'synthetic-order-key')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cards: [card, card] }) } }] }))))
    await expect(extractCards([input], AbortSignal.timeout(1000))).rejects.toThrow()
  })
})
