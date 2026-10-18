import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BREACH_NAMES,
  MAX_PROVIDER_RESPONSE_BYTES,
  normalizeBreachNames,
  readProviderPayload,
  requestXposedOrNot,
} from '../src/services/xposed-or-not.service.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('XposedOrNot breach provider adapter', () => {
  it('normalizes nested breach names without retaining duplicates', () => {
    expect(normalizeBreachNames({ breaches: [['Adobe', 'LinkedIn'], ['Adobe']] }))
      .toEqual(['Adobe', 'LinkedIn'])
  })

  it('rejects malformed nesting and excessive breach names', () => {
    expect(() => normalizeBreachNames({ status: 'success' })).toThrow('could not complete your security check')
    expect(() => normalizeBreachNames({ breaches: [['Adobe'], 'LinkedIn'] }))
      .toThrow('could not complete your security check')
    expect(() => normalizeBreachNames({
      breaches: [Array.from({ length: MAX_BREACH_NAMES + 1 }, (_, index) => `Breach ${index}`)],
    })).toThrow('could not complete your security check')
  })

  it('rejects responses that exceed the byte limit before parsing them', async () => {
    const response = {
      headers: { get: () => String(MAX_PROVIDER_RESPONSE_BYTES + 1) },
    }
    await expect(readProviderPayload(response)).rejects.toMatchObject({
      code: 'BREACH_CHECK_UNAVAILABLE',
      statusCode: 502,
    })
  })

  it('rejects an oversized streamed body before JSON parsing', async () => {
    const reader = {
      cancel: vi.fn(),
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES + 1),
      }),
    }
    await expect(readProviderPayload({
      body: { getReader: () => reader },
      headers: { get: () => null },
    })).rejects.toMatchObject({ code: 'BREACH_CHECK_UNAVAILABLE', statusCode: 502 })
    expect(reader.cancel).toHaveBeenCalledTimes(1)
  })

  it('treats only the documented no-result response as clear', async () => {
    expect(normalizeBreachNames({ Error: 'Not found', email: null })).toEqual([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(requestXposedOrNot('clear@example.com')).rejects.toMatchObject({
      code: 'BREACH_CHECK_UNAVAILABLE',
      statusCode: 502,
    })
  })

  it('maps provider 5xx responses and network failures to a safe dependency error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(requestXposedOrNot('unavailable@example.com')).rejects.toMatchObject({
      code: 'BREACH_CHECK_UNAVAILABLE',
      statusCode: 502,
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket failure')))
    await expect(requestXposedOrNot('timeout@example.com')).rejects.toMatchObject({
      code: 'BREACH_CHECK_UNAVAILABLE',
      statusCode: 502,
    })
  })
})
