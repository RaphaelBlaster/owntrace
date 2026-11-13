const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-owntrace_session' : 'owntrace_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const TOKEN_AUDIENCE = 'owntrace-web'
const TOKEN_ISSUER = 'owntrace'

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim()

  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters')
  }

  return secret
}

function getBcryptRounds() {
  if (process.env.NODE_ENV === 'test') return 4

  const configuredRounds = Number(process.env.BCRYPT_ROUNDS)
  return Number.isInteger(configuredRounds) && configuredRounds >= 10 && configuredRounds <= 14
    ? configuredRounds
    : 12
}

function getAllowedOrigins() {
  const configuredOrigins = process.env.CLIENT_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return configuredOrigins?.length ? configuredOrigins : ['http://localhost:5173']
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_DURATION_MS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  }
}

function getClearSessionCookieOptions() {
  const { maxAge: _maxAge, ...options } = getSessionCookieOptions()
  return options
}

function validateAuthEnvironment() {
  getJwtSecret()
}

export {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  getAllowedOrigins,
  getBcryptRounds,
  getClearSessionCookieOptions,
  getJwtSecret,
  getSessionCookieOptions,
  validateAuthEnvironment,
}
