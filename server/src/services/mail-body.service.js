import { GMAIL_BODY_SCOPE } from '../config/google.js'
import { MICROSOFT_BODY_SCOPE } from '../config/microsoft.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { withGoogleClient } from './google-client.service.js'
import { withMicrosoftAccessToken } from './microsoft-oauth.service.js'
import AppError from '../utils/app-error.js'

const MAX_BODY_CHARS = 8000
// format=full JSON carries every inline text/HTML part base64-encoded; rich HTML
// newsletters exceed 1 MB once encoded, which failed the whole analysis page.
const MAX_RESPONSE_BYTES = 5_000_000
const MAX_TEXT_ATTACHMENT_FETCHES = 3
const ALLOWED_STATUSES = ['CONNECTED', 'SYNCING']

function canReadMailBody(provider, connection) {
  if (!connection || !ALLOWED_STATUSES.includes(connection.status)) return false
  const scopes = Array.isArray(connection.scopes) ? connection.scopes : []
  return provider === 'gmail'
    ? scopes.includes(GMAIL_BODY_SCOPE)
    : provider === 'outlook' && scopes.includes(MICROSOFT_BODY_SCOPE)
}

const NAMED_ENTITIES = {
  nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢',
  rarr: '→', larr: '←', times: '×', deg: '°', zwnj: '', zwj: '', shy: '', ensp: ' ', emsp: ' ', thinsp: ' ',
}

function codePoint(value) {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff) ? String.fromCodePoint(value) : ' '
}

function htmlToText(html) {
  return String(html)
    .replace(/<\s*(head|script|style|template|noscript|title)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>|<\s*\/(?:p|div|li|tr|table|h[1-6]|blockquote|section|article|header|footer|ul|ol)\s*>|<\s*li\b[^>]*>/gi, '\n')
    .replace(/<\s*\/\s*t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    // Single pass so decoded output is never decoded again ("&amp;lt;" -> "&lt;", "&#38;lt;" -> "&lt;").
    .replace(/&(?:#(\d+);?|#x([\da-f]+);?|([a-z]+);)/gi, (match, dec, hex, name) => dec ? codePoint(Number(dec))
      : hex ? codePoint(parseInt(hex, 16))
        : name.toLowerCase() === 'amp' ? '&' : NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[​-‍⁠﻿­͏]/g, '')
    .replace(/[\t\r\f\v  ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY_CHARS)
}

function partHeader(part, name) {
  return part?.headers?.find(header => header?.name?.toLowerCase() === name)?.value || ''
}

function isAttachmentPart(part) {
  return Boolean(part.filename) || /^\s*attachment\b/i.test(partHeader(part, 'content-disposition'))
}

function isTextLeaf(part) {
  const mime = String(part?.mimeType || '').toLowerCase()
  return mime === 'text/plain' || mime === 'text/html'
}

function decodePartData(part, data) {
  // Gmail removes the transfer encoding (base64 / quoted-printable) but keeps the
  // bytes in the part's declared charset, so decode with that charset, not UTF-8.
  const bytes = Buffer.from(data, 'base64url')
  const charset = partHeader(part, 'content-type').match(/charset\s*=\s*"?([^";\s]+)/i)?.[1]
  if (charset) {
    try { return new TextDecoder(charset.trim().toLowerCase()).decode(bytes) } catch { /* unknown label: fall back to UTF-8 */ }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

// Text parts above Gmail's inline size limit arrive with only an attachmentId.
function externalTextPartIds(payload) {
  const ids = []
  function visit(part) {
    if (!part || isAttachmentPart(part)) return
    if (isTextLeaf(part) && !part.body?.data && part.body?.attachmentId) ids.push(part.body.attachmentId)
    for (const child of part.parts || []) visit(child)
  }
  visit(payload)
  return ids.slice(0, MAX_TEXT_ATTACHMENT_FETCHES)
}

function collectParts(part, external) {
  if (!part || isAttachmentPart(part)) return { plain: '', html: '' }
  const mime = String(part.mimeType || '').toLowerCase()
  if (isTextLeaf(part)) {
    const attachmentId = part.body?.attachmentId
    // A part carrying both inline data and an attachmentId is treated as an attachment.
    const data = attachmentId ? (part.body?.data ? '' : external?.get(attachmentId)) : part.body?.data
    if (!data) return { plain: '', html: '' }
    const decoded = decodePartData(part, data)
    return mime === 'text/plain' ? { plain: decoded.trim(), html: '' } : { plain: '', html: decoded }
  }
  const children = (part.parts || []).map(child => collectParts(child, external))
  if (mime === 'multipart/alternative') {
    // Alternatives are the same content in different formats: keep one of each.
    return { plain: children.find(child => child.plain)?.plain || '', html: children.find(child => child.html)?.html || '' }
  }
  // multipart/mixed, related, signed, report: inline text parts are sequential content.
  return {
    plain: children.map(child => child.plain).filter(Boolean).join('\n\n'),
    html: children.map(child => child.html).filter(Boolean).join('\n'),
  }
}

function collectMimeText(payload, external) {
  const { plain, html } = collectParts(payload, external)
  const htmlText = html ? htmlToText(html) : ''
  // Many senders ship a stub text/plain part ("view this email in your browser")
  // beside the real HTML body; use the HTML text when the plain part is clearly a stub.
  const plainIsStub = plain.length < 200 && htmlText.length > plain.length * 2 + 40
  return (plain && !plainIsStub ? plain : htmlText || plain).slice(0, MAX_BODY_CHARS)
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
      const headers = { authorization: `Bearer ${token}` }
      const message = await providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers }, signal)
      const external = new Map()
      for (const attachmentId of externalTextPartIds(message.payload)) {
        // A missing or oversized external text part must not fail the whole message:
        // fall back to the inline parts, as before these parts were fetched.
        try {
          const attachment = await providerFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${encodeURIComponent(attachmentId)}`, { headers }, signal)
          if (typeof attachment?.data === 'string') external.set(attachmentId, attachment.data)
        } catch (error) {
          if (signal?.aborted || error?.code !== 'MAIL_BODY_REQUEST_FAILED') throw error
        }
      }
      return collectMimeText(message.payload, external)
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
