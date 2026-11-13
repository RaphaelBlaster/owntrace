import crypto from 'node:crypto'
import { getTokenEncryptionKey } from '../config/google.js'
import { publicApiUrl } from '../config/mail-notifications.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { withMicrosoftAccessToken } from './microsoft-oauth.service.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000

function stateHash(value) {
  return crypto.createHmac('sha256', getTokenEncryptionKey()).update(value).digest('hex')
}

async function graphSubscriptionRequest(accessToken, method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let data = {}
  if (text) {
    try { data = JSON.parse(text) } catch { throw new Error('Microsoft returned an invalid subscription response') }
  }
  if (!response.ok) {
    const error = new Error('Microsoft subscription request failed')
    error.status = response.status
    throw error
  }
  return data
}

async function ensureMicrosoftPush(userId) {
  const origin = publicApiUrl()
  if (!origin) {
    await MicrosoftConnection.updateOne({ userId }, { $set: { pushStatus: 'DISABLED', graphSubscriptionExpiresAt: null } })
    return false
  }
  try {
    await withMicrosoftAccessToken(userId, async ({ accessToken, connection }) => {
      const notificationUrl = `${origin}/api/provider-notifications/microsoft`
      const expirationDateTime = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
      if (connection.graphSubscriptionId && connection.graphSubscriptionExpiresAt > new Date(Date.now() + RENEW_BEFORE_MS)) return
      if (connection.graphSubscriptionId) {
        try {
          const renewed = await graphSubscriptionRequest(accessToken, 'PATCH', `${GRAPH}/subscriptions/${encodeURIComponent(connection.graphSubscriptionId)}`, { expirationDateTime })
          await MicrosoftConnection.updateOne({ _id: connection.id, userId }, { $set: { graphSubscriptionExpiresAt: new Date(renewed.expirationDateTime || expirationDateTime), pushStatus: 'ACTIVE', pushErrorCode: null } })
          return
        } catch (error) {
          if (error.status !== 404) throw error
        }
      }
      const clientState = crypto.randomBytes(32).toString('base64url')
      const created = await graphSubscriptionRequest(accessToken, 'POST', `${GRAPH}/subscriptions`, {
        changeType: 'created,updated,deleted',
        notificationUrl,
        resource: '/me/messages',
        expirationDateTime,
        clientState,
      })
      if (!created.id || !created.expirationDateTime) throw new Error('Microsoft subscription response was incomplete')
      await MicrosoftConnection.updateOne({ _id: connection.id, userId }, { $set: { graphSubscriptionId: created.id, graphSubscriptionExpiresAt: new Date(created.expirationDateTime), graphClientStateHash: stateHash(clientState), pushStatus: 'ACTIVE', pushErrorCode: null } })
    })
    return true
  } catch {
    await MicrosoftConnection.updateOne({ userId }, { $set: { pushStatus: 'ERROR', pushErrorCode: 'MICROSOFT_PUSH_SETUP_FAILED' } })
    throw new Error('Microsoft change notification subscription could not be created or renewed')
  }
}

function matchesMicrosoftClientState(provided, expectedHash) {
  if (typeof provided !== 'string' || !expectedHash) return false
  const actual = Buffer.from(stateHash(provided), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

async function deleteMicrosoftPush(connection) {
  if (!connection?.graphSubscriptionId) return
  try {
    await withMicrosoftAccessToken(connection.userId, ({ accessToken }) => graphSubscriptionRequest(accessToken, 'DELETE', `${GRAPH}/subscriptions/${encodeURIComponent(connection.graphSubscriptionId)}`))
  } catch {}
}

export { deleteMicrosoftPush, ensureMicrosoftPush, matchesMicrosoftClientState }
