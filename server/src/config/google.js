const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata'
const GOOGLE_SCOPES = [
  'openid',
  'email',
  GMAIL_METADATA_SCOPE,
]

const GOOGLE_OAUTH_COOKIE_NAME = 'owntrace_google_oauth'
const GOOGLE_OAUTH_DURATION_MS = 10 * 60 * 1000

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim()

  if (!value) {
    const error = new Error(`${name} must be configured`)
    error.code = 'GOOGLE_NOT_CONFIGURED'
    throw error
  }

  return value
}

function getGoogleConfig() {
  return {
    clientId: requireEnvironmentValue('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnvironmentValue('GOOGLE_CLIENT_SECRET'),
    redirectUri: requireEnvironmentValue('GOOGLE_REDIRECT_URI'),
  }
}

function getGoogleClientUrl() {
  return process.env.CLIENT_APP_URL?.trim() || 'http://localhost:5173'
}

function getTokenEncryptionKey() {
  const encodedKey = requireEnvironmentValue('TOKEN_ENCRYPTION_KEY')
  const key = Buffer.from(encodedKey, 'base64')

  if (key.length !== 32) {
    const error = new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
    error.code = 'GOOGLE_NOT_CONFIGURED'
    throw error
  }

  return key
}

function getGoogleOAuthCookieOptions() {
  return {
    httpOnly: true,
    maxAge: GOOGLE_OAUTH_DURATION_MS,
    path: '/api/google/oauth',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  }
}

function isGoogleConfigured() {
  try {
    getGoogleConfig()
    getTokenEncryptionKey()
    return true
  } catch {
    return false
  }
}

function getClearGoogleOAuthCookieOptions() {
  const { maxAge: _maxAge, ...options } = getGoogleOAuthCookieOptions()
  return options
}

export {
  GMAIL_METADATA_SCOPE,
  GOOGLE_OAUTH_COOKIE_NAME,
  GOOGLE_OAUTH_DURATION_MS,
  GOOGLE_SCOPES,
  getClearGoogleOAuthCookieOptions,
  getGoogleClientUrl,
  getGoogleConfig,
  getGoogleOAuthCookieOptions,
  getTokenEncryptionKey,
  isGoogleConfigured,
}
