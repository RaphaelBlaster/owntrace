import { afterEach, describe, expect, it } from 'vitest'
import {
  DAILY_CHECK_LIMIT,
  HOURLY_CHECK_LIMIT,
  reserveProviderCheck,
  resetProviderCheckRateLimitForTests,
} from '../src/services/breach-provider-rate-limit.service.js'

afterEach(() => {
  resetProviderCheckRateLimitForTests()
})

describe('shared breach-check quota', () => {
  it('prevents bursts above one outbound check per second', () => {
    reserveProviderCheck(10_000)
    expect(() => reserveProviderCheck(10_000)).toThrow('Too many security checks')
    expect(() => reserveProviderCheck(11_000)).not.toThrow()
  })

  it('prevents more than twenty outbound checks in one hour', () => {
    const start = 3_600_000
    for (let index = 0; index < HOURLY_CHECK_LIMIT; index += 1) {
      reserveProviderCheck(start + index * 1_000)
    }
    expect(() => reserveProviderCheck(start + HOURLY_CHECK_LIMIT * 1_000))
      .toThrow('Too many security checks')
  })

  it('does not reset the hourly allowance at a fixed-window boundary', () => {
    const firstCheck = 3_580_000
    for (let index = 0; index < HOURLY_CHECK_LIMIT; index += 1) {
      reserveProviderCheck(firstCheck + index * 1_000)
    }

    expect(() => reserveProviderCheck(3_600_000)).toThrow('Too many security checks')
    expect(() => reserveProviderCheck(firstCheck + 3_600_000)).not.toThrow()
  })

  it('prevents more than ninety outbound checks in one day', () => {
    const start = 7_200_000
    for (let index = 0; index < DAILY_CHECK_LIMIT; index += 1) {
      const hour = Math.floor(index / HOURLY_CHECK_LIMIT)
      const second = index % HOURLY_CHECK_LIMIT
      reserveProviderCheck(start + hour * 3_600_000 + second * 1_000)
    }
    expect(() => reserveProviderCheck(start + 4 * 3_600_000 + 11_000))
      .toThrow('Too many security checks')
  })
})
