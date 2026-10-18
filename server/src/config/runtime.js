import { getAllowedOrigins, getJwtSecret } from './auth.js'
import { getGoogleClientUrl, getGoogleConfig, getTokenEncryptionKey } from './google.js'
import { getMicrosoftConfig, hasMicrosoftConfiguration } from './microsoft.js'
import { getTraceExecutionConfig, orderWorkerEnabled } from './trace-execution.js'

const validNodeEnvironments = new Set(['development', 'production', 'test'])
const validLogLevels = new Set(['error', 'info', 'silent'])

function requireValue(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be configured`)
  return value
}

function parseInteger(name, fallback, { maximum, minimum }) {
  const rawValue = process.env[name]?.trim()
  if (!rawValue) return fallback
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function requireHttpsUrl(name, value, { originOnly = false } = {}) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${name} must use HTTPS and must not contain credentials`)
  }
  if (originOnly && value.replace(/\/$/, '') !== parsed.origin) {
    throw new Error(`${name} entries must contain origins only`)
  }
  return parsed
}

function getTrustProxy() {
  const rawValue = process.env.TRUST_PROXY?.trim()
  if (!rawValue || rawValue === 'false' || rawValue === '0') return false
  if (rawValue === 'true') return true
  if (/^[1-9]\d*$/.test(rawValue)) return Number(rawValue)
  if (['loopback', 'linklocal', 'uniquelocal'].includes(rawValue)) return rawValue
  throw new Error('TRUST_PROXY must be false, true, a positive hop count, or a trusted subnet name')
}

function getRuntimeConfig() {
  const nodeEnvironment = process.env.NODE_ENV?.trim() || 'development'
  if (!validNodeEnvironments.has(nodeEnvironment)) {
    throw new Error('NODE_ENV must be development, production, or test')
  }

  const logLevel = process.env.LOG_LEVEL?.trim() || 'info'
  if (!validLogLevels.has(logLevel)) throw new Error('LOG_LEVEL must be error, info, or silent')

  return {
    logLevel,
    nodeEnvironment,
    port: parseInteger('PORT', 5000, { maximum: 65_535, minimum: 1 }),
    shutdownTimeoutMs: parseInteger('SHUTDOWN_TIMEOUT_MS', 10_000, {
      maximum: 60_000,
      minimum: 1_000,
    }),
    trustProxy: getTrustProxy(),
  }
}

function validateRuntimeEnvironment() {
  const runtime = getRuntimeConfig()
  getTraceExecutionConfig()
  orderWorkerEnabled()
  getJwtSecret()
  requireValue('MONGO_URI')
  parseInteger('BCRYPT_ROUNDS', 12, { maximum: 14, minimum: 10 })
  parseInteger('GMAIL_SYNC_MESSAGE_LIMIT', 2_000, { maximum: 20_000, minimum: 25 })
  parseInteger('MICROSOFT_SYNC_MESSAGE_LIMIT', 2_000, { maximum: 20_000, minimum: 25 })

  if (runtime.nodeEnvironment === 'production') {
    if (runtime.trustProxy === true) {
      throw new Error('TRUST_PROXY=true is too broad for production; use a hop count or subnet')
    }
    getAllowedOrigins().forEach((origin) => requireHttpsUrl('CLIENT_ORIGINS', origin, {
      originOnly: true,
    }))
    requireHttpsUrl('CLIENT_APP_URL', getGoogleClientUrl(), { originOnly: true })
    // Mail integrations are optional; partial configuration must still fail closed.
    if(process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim()) {
      const { redirectUri } = getGoogleConfig()
      const parsedRedirect = requireHttpsUrl('GOOGLE_REDIRECT_URI', redirectUri)
      if (parsedRedirect.pathname !== '/api/google/oauth/callback') {
        throw new Error('GOOGLE_REDIRECT_URI must end at /api/google/oauth/callback')
      }
    }
    getTokenEncryptionKey()
    if (hasMicrosoftConfiguration()) {
      const { redirectUri: microsoftRedirectUri } = getMicrosoftConfig()
      const parsedMicrosoftRedirect = requireHttpsUrl('MICROSOFT_REDIRECT_URI', microsoftRedirectUri)
      if (parsedMicrosoftRedirect.pathname !== '/api/microsoft/oauth/callback') {
        throw new Error('MICROSOFT_REDIRECT_URI must end at /api/microsoft/oauth/callback')
      }
    }
  }

  return runtime
}

export { getRuntimeConfig, getTrustProxy, validateRuntimeEnvironment }
