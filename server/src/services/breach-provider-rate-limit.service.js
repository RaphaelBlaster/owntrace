import AppError from '../utils/app-error.js'

const HOURLY_CHECK_LIMIT = 20
const DAILY_CHECK_LIMIT = 90
const SECOND_CHECK_LIMIT = 1
const DAY_MS = 24 * 60 * 60 * 1_000
const HOUR_MS = 60 * 60 * 1_000
const SECOND_MS = 1_000

let checkTimestamps = []

function rateLimitError() {
  return new AppError(
    'Too many security checks are happening right now. Please try again later.',
    429,
    'BREACH_CHECK_RATE_LIMITED',
  )
}

function reserveProviderCheck(now = Date.now()) {
  checkTimestamps = checkTimestamps.filter((timestamp) => now - timestamp < DAY_MS)
  const hourlyCount = checkTimestamps.filter((timestamp) => now - timestamp < HOUR_MS).length
  const secondCount = checkTimestamps.filter((timestamp) => now - timestamp < SECOND_MS).length

  if (
    checkTimestamps.length >= DAILY_CHECK_LIMIT
    || hourlyCount >= HOURLY_CHECK_LIMIT
    || secondCount >= SECOND_CHECK_LIMIT
  ) {
    throw rateLimitError()
  }

  checkTimestamps.push(now)
}

function resetProviderCheckRateLimitForTests() {
  checkTimestamps = []
}

export {
  DAILY_CHECK_LIMIT,
  HOURLY_CHECK_LIMIT,
  SECOND_CHECK_LIMIT,
  reserveProviderCheck,
  resetProviderCheckRateLimitForTests,
}
