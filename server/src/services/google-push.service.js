import { google } from 'googleapis'
import { getGooglePushConfig } from '../config/mail-notifications.js'
import GoogleConnection from '../models/google-connection.model.js'
import { withGoogleClient } from './google-client.service.js'
import { logEvent } from '../utils/logger.js'

const LOG_THROTTLE_MS = 60 * 1000
const lastLogged = new Map()

// Pub/Sub retries rejected pushes, so an auth misconfiguration would otherwise
// flood the log. One line per reason per minute is enough to diagnose it.
function logThrottled(event, details) {
  const key = `${event}:${details.reason || ''}`
  const now = Date.now()
  if (now - (lastLogged.get(key) || 0) < LOG_THROTTLE_MS) return
  lastLogged.set(key, now)
  logEvent('warn', event, details)
}

function describeGoogleError(error) {
  const status = Number(error?.response?.status || error?.status || error?.code) || null
  const message = error?.response?.data?.error?.message || error?.errors?.[0]?.message || error?.message || ''
  return { status, providerMessage: String(message).slice(0, 300) }
}

function pushErrorCode(status) {
  if (status === 403) return 'GMAIL_PUSH_TOPIC_FORBIDDEN'
  if (status === 404) return 'GMAIL_PUSH_TOPIC_NOT_FOUND'
  if (status === 400) return 'GMAIL_PUSH_INVALID_TOPIC'
  return 'GMAIL_PUSH_SETUP_FAILED'
}

async function ensureGmailPush(userId) {
  const config = getGooglePushConfig()
  if (!config) {
    await GoogleConnection.updateOne({ userId }, { $set: { pushStatus: 'DISABLED', pushExpiresAt: null } })
    return false
  }
  try {
    await withGoogleClient(userId, async ({ connection, oauthClient }) => {
      const gmail = google.gmail({ auth: oauthClient, version: 'v1' })
      const response = await gmail.users.watch({ userId: 'me', requestBody: { topicName: config.topicName } })
      const expiration = Number(response.data.expiration)
      if (!response.data.historyId || !Number.isFinite(expiration)) throw new Error('Gmail watch response was incomplete')
      // The watch historyId is kept separately from the sync baseline
      // (gmailHistoryId): adopting it as the baseline would skip mail that
      // arrived between the last completed sync and this watch call.
      await GoogleConnection.updateOne({ _id: connection.id, userId }, { $set: {
        pushStatus: 'ACTIVE',
        pushExpiresAt: new Date(expiration),
        pushErrorCode: null,
        gmailWatchHistoryId: String(response.data.historyId),
        gmailWatchHistoryAt: new Date(),
      } })
    })
    return true
  } catch (error) {
    const { status, providerMessage } = describeGoogleError(error)
    const errorCode = pushErrorCode(status)
    // 403 almost always means gmail-api-push@system.gserviceaccount.com lacks
    // roles/pubsub.publisher on GMAIL_PUBSUB_TOPIC.
    logEvent('warn', 'gmail_push_watch_failed', { errorCode, status, providerMessage })
    await GoogleConnection.updateOne({ userId }, { $set: { pushStatus: 'ERROR', pushErrorCode: errorCode } })
    throw new Error('Gmail push watch could not be created or renewed')
  }
}

function audienceVariants(audience) {
  const trimmed = audience.replace(/\/+$/, '')
  return [...new Set([audience, trimmed, `${trimmed}/`])]
}

function readTokenAudience(idToken) {
  try {
    const aud = JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString('utf8'))?.aud
    return typeof aud === 'string' ? aud.slice(0, 200) : null
  } catch { return null }
}

// One client so Google's signing certificates are cached between pushes.
const pubSubVerifier = new google.auth.OAuth2()

async function verifyGmailPubSubRequest(authorization) {
  let config
  try { config = getGooglePushConfig() } catch (error) {
    logThrottled('gmail_push_rejected', { reason: 'invalid_config', providerMessage: String(error?.message || '').slice(0, 200) })
    return false
  }
  if (!config) {
    logThrottled('gmail_push_rejected', { reason: 'push_not_configured' })
    return false
  }
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    logThrottled('gmail_push_rejected', { reason: 'missing_bearer_token' })
    return false
  }
  try {
    const ticket = await pubSubVerifier.verifyIdToken({ idToken: authorization.slice(7), audience: audienceVariants(config.audience) })
    const payload = ticket.getPayload()
    const email = typeof payload?.email === 'string' ? payload.email.toLowerCase() : ''
    if (email === config.serviceAccountEmail.toLowerCase() && payload.email_verified === true) return true
    logThrottled('gmail_push_rejected', { reason: 'service_account_mismatch', tokenEmail: email || null, emailVerified: payload?.email_verified === true })
    return false
  } catch (error) {
    // google-auth-library appends the raw JWT or its payload to several of its
    // messages, so only the text before the first ':' is logged. The token's
    // aud claim is not secret and shows a GMAIL_PUBSUB_AUDIENCE mismatch.
    const providerMessage = String(error?.message || '').split(':')[0].slice(0, 120)
    logThrottled('gmail_push_rejected', { reason: 'token_verification_failed', providerMessage, tokenAudience: readTokenAudience(authorization.slice(7)), expectedAudience: config.audience })
    return false
  }
}

async function stopGmailPush(userId) {
  try {
    await withGoogleClient(userId, async ({ oauthClient }) => {
      const gmail = google.gmail({ auth: oauthClient, version: 'v1' })
      await gmail.users.stop({ userId: 'me' })
    })
  } catch {}
}

export { ensureGmailPush, stopGmailPush, verifyGmailPubSubRequest }
