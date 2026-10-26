import { GMAIL_BODY_SCOPE } from '../config/google.js'
import { MICROSOFT_BODY_SCOPE } from '../config/microsoft.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { withGoogleClient } from './google-client.service.js'
import { withMicrosoftAccessToken } from './microsoft-oauth.service.js'
import AppError from '../utils/app-error.js'

const MAX_BODY_CHARS = 8000
const MAX_RESPONSE_BYTES = 1_000_000
const ALLOWED_STATUSES = ['CONNECTED', 'SYNCING']

function canReadMailBody(provider, connection) {
  if (!connection || !ALLOWED_STATUSES.includes(connection.status)) return false
  const scopes = Array.isArray(connection.scopes) ? connection.scopes : []
  return provider === 'gmail'
    ? scopes.includes(GMAIL_BODY_SCOPE)
    : provider === 'outlook' && scopes.includes(MICROSOFT_BODY_SCOPE)
}

function htmlToText(html) {
  return String(html)
    .replace(/<\s*(script|style|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>|<\s*\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)))
    .replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim().slice(0, MAX_BODY_CHARS)
}

function collectMimeText(payload) {
  let plain = ''
  let html = ''
  function visit(part) {
    if (!part || part.filename || part.body?.attachmentId) return
    const mime = String(part.mimeType || '').toLowerCase()
    if (part.body?.data && (mime === 'text/plain' || mime === 'text/html')) {
      const decoded = Buffer.from(part.body.data, 'base64url').toString('utf8')
      if (mime === 'text/plain') plain ||= decoded
      else html ||= decoded
    }
    for (const child of part.parts || []) visit(child)
  }
  visit(payload)
  return (plain || htmlToText(html)).slice(0, MAX_BODY_CHARS)
}

async function readBounded(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new AppError('Mail provider returned an oversized message.', 502, 'MAIL_BODY_REQUEST_FAILED')
  const reader = response.body?.getReader()
  if (!reader) throw new AppError('Mail provider returned an invalid message.', 502, 'MAIL_BODY_REQUEST_FAILED')
  let total = 0
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new AppError('Mail provider returned an oversized message.', 502, 'MAIL_BODY_REQUEST_FAILED') }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new AppError('Mail provider returned an invalid message.', 502, 'MAIL_BODY_REQUEST_FAILED') }
}

async function providerFetch(url, init, signal) {
  const timeout = AbortSignal.timeout(15_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response
  try { response = await fetch(url, { ...init, redirect: 'error', signal: combined }) }
  catch { throw new AppError('Mail provider could not be reached.', 502, 'MAIL_BODY_REQUEST_FAILED') }
  if (!response.ok) throw new AppError('Mail provider could not return this message.', 502, 'MAIL_BODY_REQUEST_FAILED')
  return readBounded(response)
}

async function fetchMailBody({ userId, provider, connectionId, providerId }, signal) {
  if (typeof providerId !== 'string' || !providerId || providerId.length > 2048) throw new AppError('Invalid message identifier.', 400, 'MAIL_BODY_INVALID_ID')
  const model = provider === 'gmail' ? GoogleConnection : provider === 'outlook' ? MicrosoftConnection : null
  if (!model || typeof connectionId !== 'string' || !/^[a-f\d]{24}$/i.test(connectionId)) throw new AppError('Invalid mail connection.', 400, 'MAIL_BODY_INVALID_CONNECTION')
  const owned = await model.findOne({ _id: connectionId, userId, status: { $in: ALLOWED_STATUSES } })
  if (!canReadMailBody(provider, owned)) throw new AppError('Reconnect with message access before analyzing email content.', 403, 'MAIL_BODY_SCOPE_REQUIRED')

  if (provider === 'gmail') {
    return withGoogleClient(userId, async ({ connection, oauthClient }) => {
      if (connection.id !== String(connectionId) || !canReadMailBody(provider, connection)) throw new AppError('Gmail connection changed.', 409, 'MAIL_BODY_CONNECTION_CHANGED')
      const { token } = await oauthClient.getAccessToken()
      if (!token) throw new AppError('Reconnect Gmail before analyzing email content.', 409, 'GOOGLE_RECONNECT_REQUIRED')
      const id = encodeURIComponent(providerId)
      const message = await providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { authorization: `Bearer ${token}` } }, signal)
      return collectMimeText(message.payload)
    })
  }

  return withMicrosoftAccessToken(userId, async ({ accessToken, connection }) => {
    if (connection.id !== String(connectionId) || !canReadMailBody(provider, connection)) throw new AppError('Microsoft connection changed.', 409, 'MAIL_BODY_CONNECTION_CHANGED')
    const id = encodeURIComponent(providerId)
    const message = await providerFetch(`https://graph.microsoft.com/v1.0/me/messages/${id}?$select=body`, { headers: { authorization: `Bearer ${accessToken}`, Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } }, signal)
    const body = message.body?.content || ''
    return (String(message.body?.contentType).toLowerCase() === 'html' ? htmlToText(body) : body).slice(0, MAX_BODY_CHARS)
  })
}

export { canReadMailBody, collectMimeText, fetchMailBody, htmlToText }
