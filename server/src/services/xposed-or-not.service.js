import AppError from '../utils/app-error.js'

const XPOSED_OR_NOT_PROVIDER = 'XPOSED_OR_NOT'
const XPOSED_OR_NOT_BASE_URL = 'https://api.xposedornot.com/v1/check-email/'
const REQUEST_TIMEOUT_MS = 7_000
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024
const MAX_BREACH_NAMES = 500

function unavailableError() {
  return new AppError(
    'We could not complete your security check right now. Please try again later.',
    502,
    'BREACH_CHECK_UNAVAILABLE',
  )
}

function normalizeBreachNames(payload) {
  if (payload?.Error === 'Not found' && payload.email === null) return []
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.breaches)) {
    throw unavailableError()
  }

  const names = []
  for (const group of payload.breaches) {
    if (!Array.isArray(group)) throw unavailableError()
    for (const value of group) {
      if (typeof value !== 'string') throw unavailableError()
      const name = value.trim()
      if (!name || name.length > 160 || names.length >= MAX_BREACH_NAMES) throw unavailableError()
      names.push(name)
    }
  }

  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

async function readProviderPayload(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw unavailableError()
  }

  if (!response.body?.getReader) throw unavailableError()

  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel()
        throw unavailableError()
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw unavailableError()
  }

  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
  } catch {
    throw unavailableError()
  }
}

async function requestXposedOrNot(email) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${XPOSED_OR_NOT_BASE_URL}${encodeURIComponent(email)}`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })

    if (response.status === 404) throw unavailableError()
    if (response.status === 429) {
      throw new AppError(
        'Too many security checks are happening right now. Please try again later.',
        429,
        'BREACH_CHECK_RATE_LIMITED',
      )
    }
    if (!response.ok) {
      throw new AppError(
        'We could not complete your security check right now. Please try again later.',
        502,
        'BREACH_CHECK_UNAVAILABLE',
      )
    }

    const payload = await readProviderPayload(response)
    return normalizeBreachNames(payload)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      'We could not complete your security check right now. Please try again later.',
      502,
      'BREACH_CHECK_UNAVAILABLE',
    )
  } finally {
    clearTimeout(timeout)
  }
}

export {
  MAX_BREACH_NAMES,
  MAX_PROVIDER_RESPONSE_BYTES,
  XPOSED_OR_NOT_PROVIDER,
  normalizeBreachNames,
  readProviderPayload,
  requestXposedOrNot,
}
