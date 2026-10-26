import { google } from 'googleapis'
import { getGooglePushConfig } from '../config/mail-notifications.js'
import GoogleConnection from '../models/google-connection.model.js'
import { withGoogleClient } from './google-client.service.js'

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
      await GoogleConnection.updateOne({ _id: connection.id, userId }, { $set: { pushStatus: 'ACTIVE', pushExpiresAt: new Date(expiration), pushErrorCode: null } })
    })
    return true
  } catch {
    await GoogleConnection.updateOne({ userId }, { $set: { pushStatus: 'ERROR', pushErrorCode: 'GMAIL_PUSH_SETUP_FAILED' } })
    throw new Error('Gmail push watch could not be created or renewed')
  }
}

async function verifyGmailPubSubRequest(authorization) {
  const config = getGooglePushConfig()
  if (!config || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false
  try {
    const oauth = new google.auth.OAuth2()
    const ticket = await oauth.verifyIdToken({ idToken: authorization.slice(7), audience: config.audience })
    const payload = ticket.getPayload()
    return payload?.email === config.serviceAccountEmail && payload.email_verified === true
  } catch { return false }
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
