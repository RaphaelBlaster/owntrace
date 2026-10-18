import { getTokenEncryptionKey } from './google.js'

const MICROSOFT_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.ReadBasic']
const MICROSOFT_OAUTH_COOKIE_NAME = 'owntrace_microsoft_oauth'
const MICROSOFT_OAUTH_DURATION_MS = 10 * 60 * 1000

function required(name) { const value = process.env[name]?.trim(); if (!value) { const error = new Error(`${name} must be configured`); error.code = 'MICROSOFT_NOT_CONFIGURED'; throw error } return value }
function getMicrosoftConfig() {
  const config = { clientId: required('MICROSOFT_CLIENT_ID'), clientSecret: required('MICROSOFT_CLIENT_SECRET'), redirectUri: required('MICROSOFT_REDIRECT_URI'), tenant: process.env.MICROSOFT_TENANT?.trim() || 'common' }
  try { getTokenEncryptionKey() } catch (error) { error.code = 'MICROSOFT_NOT_CONFIGURED'; throw error }
  return config
}
function hasMicrosoftConfiguration() { return ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI'].some((name) => Boolean(process.env[name]?.trim())) }
function isMicrosoftConfigured() { try { getMicrosoftConfig(); return true } catch { return false } }
function getMicrosoftClientUrl() { return process.env.CLIENT_APP_URL?.trim() || 'http://localhost:5173' }
function getMicrosoftOAuthCookieOptions() { return { httpOnly: true, maxAge: MICROSOFT_OAUTH_DURATION_MS, path: '/api/microsoft/oauth', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' } }
function getClearMicrosoftOAuthCookieOptions() { const { maxAge: _maxAge, ...options } = getMicrosoftOAuthCookieOptions(); return options }

export { MICROSOFT_OAUTH_COOKIE_NAME, MICROSOFT_OAUTH_DURATION_MS, MICROSOFT_SCOPES, getClearMicrosoftOAuthCookieOptions, getMicrosoftClientUrl, getMicrosoftConfig, getMicrosoftOAuthCookieOptions, hasMicrosoftConfiguration, isMicrosoftConfigured }
