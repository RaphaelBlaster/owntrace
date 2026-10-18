import crypto from 'node:crypto'
import { google } from 'googleapis'
import { getTokenEncryptionKey } from '../config/google.js'
import { withGoogleClient } from './google-client.service.js'
import { withMicrosoftAccessToken } from './microsoft-oauth.service.js'
import { readBoundedJson } from './microsoft-sync.service.js'
import AppError from '../utils/app-error.js'

export function hashOrderValue(userId, provider, connectionId, value) {
  return crypto.createHmac('sha256', getTokenEncryptionKey()).update(`${userId}:${provider}:${connectionId}:${value}`).digest('base64url')
}
const fields = 'id,from,subject,receivedDateTime'
export function orderGraphUrl(scan, size) {
  if (!scan.cursor) {
    const url = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages')
    url.searchParams.set('$select', fields)
    url.searchParams.set('$top', String(size))
    url.searchParams.set('$filter', `receivedDateTime ge ${new Date(scan.since).toISOString()} and receivedDateTime le ${new Date(scan.until).toISOString()}`)
    url.searchParams.set('$orderby', 'receivedDateTime desc')
    return url.href
  }
  let url
  try { url = new URL(scan.cursor) } catch { throw new AppError('Invalid mailbox checkpoint.', 502, 'ORDER_CURSOR_INVALID') }
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || url.hash || !['/v1.0/me/mailFolders/inbox/messages', "/v1.0/me/mailFolders('inbox')/messages"].includes(url.pathname) || url.searchParams.get('$select') !== fields || Number(url.searchParams.get('$top')) > 25 || !Number.isInteger(Number(url.searchParams.get('$top'))) || Number(url.searchParams.get('$top')) < 1) throw new AppError('Invalid mailbox checkpoint.', 502, 'ORDER_CURSOR_INVALID')
  return url.href
}
export async function fetchOrderPage(scan, signal) {
  const size = Math.min(25, scan.limit - scan.processed)
  if (scan.provider === 'outlook') return withMicrosoftAccessToken(scan.userId, async ({ accessToken, connection }) => {
    if (String(connection.id) !== String(scan.connectionId)) throw new AppError('Mailbox changed; start a new scan.', 409, 'ORDER_CONNECTION_CHANGED')
    const response = await fetch(orderGraphUrl(scan, size), { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'IdType="ImmutableId"' }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
    if (!response.ok) throw new AppError('Outlook metadata could not load. Reconnect or retry later.', response.status === 429 ? 429 : 502, 'ORDER_MAIL_UNAVAILABLE')
    const page = await readBoundedJson(response, 512000)
    if (!Array.isArray(page.value) || page.value.length > size || (page['@odata.nextLink'] && (typeof page['@odata.nextLink'] !== 'string' || page['@odata.nextLink'].length > 8192))) throw new AppError('Invalid mailbox page.', 502, 'ORDER_MAIL_INVALID')
    const cursor = page['@odata.nextLink'] || null
    if (cursor) orderGraphUrl({ ...scan.toObject?.() || scan, cursor }, 25)
    return { cursor, messages: page.value.map(message => ({ providerId: message.id, senderDomain: message.from?.emailAddress?.address?.split('@').at(-1), subject: message.subject, occurredAt: message.receivedDateTime })) }
  })
  return withGoogleClient(scan.userId, async ({ connection, oauthClient }) => {
    if (String(connection.id) !== String(scan.connectionId)) throw new AppError('Mailbox changed; start a new scan.', 409, 'ORDER_CONNECTION_CHANGED')
    const gmail = google.gmail({ auth: oauthClient, version: 'v1' })
    // gmail.metadata does not permit q searches: filter the bounded metadata locally.
    const page = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: size, pageToken: scan.cursor || undefined }, { signal, timeout: 15000 })
    const listed = page.data.messages || []
    if (!Array.isArray(listed) || listed.length > size) throw new AppError('Invalid mailbox page.', 502, 'ORDER_MAIL_INVALID')
    const messages = []
    for (const item of listed) {
      signal.throwIfAborted()
      try {
        const result = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }, { signal, timeout: 15000 })
        const header = name => result.data.payload?.headers?.find(x => x.name?.toLowerCase() === name.toLowerCase())?.value
        const sender = header('From')?.match(/([a-z0-9.-]+\.[a-z]{2,})>?\s*$/i)?.[1]
        messages.push({ providerId: item.id, senderDomain: sender, subject: header('Subject'), occurredAt: new Date(Number(result.data.internalDate) || Date.parse(header('Date'))).toISOString() })
      } catch (error) { if (error.response?.status === 404) messages.push({ providerId: item.id, deleted: true }); else throw error }
    }
    return { cursor: page.data.nextPageToken || null, messages }
  })
}
