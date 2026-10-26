import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { google } from 'googleapis'
import {
  GMAIL_METADATA_SCOPE,
  GMAIL_BODY_SCOPE,
  GOOGLE_OAUTH_DURATION_MS,
  GOOGLE_SCOPES,
  GOOGLE_BODY_SCOPES,
  getGoogleConfig,
} from '../config/google.js'
import { TOKEN_AUDIENCE, TOKEN_ISSUER, getJwtSecret } from '../config/auth.js'
import GoogleConnection from '../models/google-connection.model.js'
import GmailSignal from '../models/gmail-signal.model.js'
import GmailSyncJob from '../models/gmail-sync-job.model.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'
import { decryptSecret, encryptSecret } from '../utils/encryption.js'
import { removeConnectionDiscoveries } from './account-discovery.service.js'
import { removeSubscriptionsForUser } from './subscription-detection.service.js'
import { cancelAndWaitForSync } from './gmail-sync.service.js'
import { drainBufferedOrderWrites } from './order-write-buffer.service.js'
import { stopGmailPush } from './google-push.service.js'

const GOOGLE_STATE_AUDIENCE = `${TOKEN_AUDIENCE}:google-oauth`
const GOOGLE_STATE_ISSUER = `${TOKEN_ISSUER}:google-oauth`

function createOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function hashState(value) {
  return crypto.createHash('sha256').update(value).digest('base64url')
}

function createOAuthState(userId, bodyAccess = false) {
  const requestState = crypto.randomBytes(32).toString('base64url')
  const cookieState = jwt.sign({ stateHash: hashState(requestState), bodyAccess }, getJwtSecret(), {
    algorithm: 'HS256',
    audience: GOOGLE_STATE_AUDIENCE,
    expiresIn: Math.floor(GOOGLE_OAUTH_DURATION_MS / 1000),
    issuer: GOOGLE_STATE_ISSUER,
    subject: userId.toString(),
  })

  return { cookieState, requestState }
}

function verifyOAuthState(state) {
  return jwt.verify(state, getJwtSecret(), {
    algorithms: ['HS256'],
    audience: GOOGLE_STATE_AUDIENCE,
    issuer: GOOGLE_STATE_ISSUER,
  })
}

function stateValuesMatch(first, second) {
  if (!first || !second) return false

  const firstBuffer = Buffer.from(first)
  const secondBuffer = Buffer.from(second)
  return firstBuffer.length === secondBuffer.length && crypto.timingSafeEqual(firstBuffer, secondBuffer)
}

function createAuthorizationUrl(userId, { bodyAccess = false } = {}) {
  const { cookieState, requestState } = createOAuthState(userId, bodyAccess)
  const authorizationUrl = createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: bodyAccess ? GOOGLE_BODY_SCOPES : GOOGLE_SCOPES,
    state: requestState,
  })

  return { authorizationUrl, cookieState }
}

async function completeAuthorization({ code, cookieState, requestState, userId }) {
  let statePayload

  try {
    statePayload = verifyOAuthState(cookieState)
  } catch {
    throw new AppError('Google connection state is invalid or expired.', 400, 'INVALID_OAUTH_STATE')
  }

  if (!stateValuesMatch(statePayload.stateHash, hashState(requestState))) {
    throw new AppError('Google connection state is invalid or expired.', 400, 'INVALID_OAUTH_STATE')
  }

  if (statePayload.sub !== userId.toString()) {
    throw new AppError('Google connection state does not match this session.', 403, 'OAUTH_USER_MISMATCH')
  }

  const oauthClient = createOAuthClient()
  const { tokens } = await oauthClient.getToken(code)

  if (!tokens.id_token || !tokens.access_token || !tokens.expiry_date) {
    throw new AppError('Google did not return the required connection tokens.', 502, 'GOOGLE_TOKEN_INCOMPLETE')
  }

  const { clientId } = getGoogleConfig()
  const ticket = await oauthClient.verifyIdToken({ audience: clientId, idToken: tokens.id_token })
  const identity = ticket.getPayload()

  if (!identity?.sub || !identity.email || identity.email_verified !== true) {
    throw new AppError('Google did not return a verified account identity.', 502, 'GOOGLE_IDENTITY_INVALID')
  }

  const existingConnection = await GoogleConnection.findOne({ userId })
    .select('+encryptedRefreshToken')
  if (existingConnection && ['SYNCING', 'DISCONNECTING'].includes(existingConnection.status)) {
    throw new AppError('Finish or cancel the current Gmail operation before reconnecting.', 409, 'GOOGLE_CONNECTION_BUSY')
  }
  if (existingConnection && existingConnection.googleAccountId !== identity.sub) {
    throw new AppError(
      'Disconnect the current Google account before connecting a different account.',
      409,
      'GOOGLE_ACCOUNT_MISMATCH',
    )
  }
  const encryptedRefreshToken = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : existingConnection?.encryptedRefreshToken

  if (!encryptedRefreshToken) {
    throw new AppError(
      'Google did not provide offline access. Reconnect and approve consent again.',
      409,
      'GOOGLE_REFRESH_TOKEN_MISSING',
    )
  }

  const grantedScopes = (tokens.scope || GOOGLE_SCOPES.join(' ')).split(/\s+/).filter(Boolean)
  if (statePayload.bodyAccess && (!tokens.scope || !grantedScopes.includes(GMAIL_BODY_SCOPE))) {
    throw new AppError('Google did not grant Gmail message access.', 409, 'GOOGLE_BODY_SCOPE_MISSING')
  }

  if (!grantedScopes.includes(GMAIL_METADATA_SCOPE)) {
    throw new AppError(
      'Google did not grant the Gmail metadata permission needed for discovery.',
      409,
      'GOOGLE_SCOPE_MISSING',
    )
  }

  const now = new Date()
  const connection = await GoogleConnection.findOneAndUpdate(
    { userId },
    {
      $set: {
        connectedAt: existingConnection?.connectedAt || now,
        email: identity.email,
        encryptedAccessToken: encryptSecret(tokens.access_token),
        encryptedRefreshToken,
        googleAccountId: identity.sub,
        lastErrorCode: null,
        refreshTokenExpiresAt: tokens.refresh_token_expires_in
          ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
          : null,
        scopes: grantedScopes,
        status: 'CONNECTED',
        tokenExpiresAt: new Date(tokens.expiry_date),
      },
    },
    { returnDocument: 'after', runValidators: true, upsert: true },
  )

  await User.updateOne(
    { _id: userId },
    { $addToSet: { authProviders: 'google' } },
  )
  await User.updateOne(
    { _id: userId, onboardingStatus: { $ne: 'COMPLETED' } },
    { $set: { onboardingStatus: 'SCAN_PENDING' } },
  )

  return { connection, bodyAccess: Boolean(statePayload.bodyAccess) }
}

async function getConnectionForUser(userId, { includeSecrets = false } = {}) {
  const query = GoogleConnection.findOne({ userId })
  if (includeSecrets) query.select('+encryptedAccessToken +encryptedRefreshToken')
  return query
}

async function revokeConnectionToken(connection) {
  const token = decryptSecret(connection.encryptedRefreshToken || connection.encryptedAccessToken)

  if (token) {
    try {
      await createOAuthClient().revokeToken(token)
    } catch (error) {
      const status = error?.response?.status
      if (status !== 400) {
        throw new AppError(
          'Google could not be reached to revoke access. Try disconnecting again.',
          502,
          'GOOGLE_REVOCATION_FAILED',
        )
      }
    }
  }
}

async function revokeGoogleAccessForUser(userId) {
  const connection = await getConnectionForUser(userId, { includeSecrets: true })
  if (!connection) return false

  await stopGmailPush(userId)
  const { stopTopK } = await import('./top-k.service.js')
  await stopTopK(userId, 'gmail')
  await GoogleConnection.updateOne({ _id: connection.id, userId }, { $set: { status: 'DISCONNECTING' } })
  await cancelAndWaitForSync(userId)
  const { cancelOrderWork } = await import('./order-control.service.js')
  await cancelOrderWork(userId, 'gmail')
  await revokeConnectionToken(connection)
  return true
}

async function disconnectGoogle(userId) {
  const connection = await getConnectionForUser(userId, { includeSecrets: true })
  if (!connection) return false

  await stopGmailPush(userId)
  const { stopTopK, removeTopKSource } = await import('./top-k.service.js')
  await stopTopK(userId, 'gmail')
  await GoogleConnection.updateOne({ _id: connection.id, userId }, { $set: { status: 'DISCONNECTING' } })
  await cancelAndWaitForSync(userId)
  const { removeOrderSource } = await import('./order-control.service.js')
  await removeOrderSource(userId, 'gmail', connection.id)
  try {
    await revokeConnectionToken(connection)
  } catch (error) {
    await GoogleConnection.updateOne({ _id: connection.id, userId }, { $set: { status: 'ERROR', lastErrorCode: 'GOOGLE_REVOCATION_FAILED' } })
    throw error
  }

  await Promise.all([
    removeTopKSource(userId, 'gmail', connection.id),
    removeConnectionDiscoveries(userId, connection.id),
    removeSubscriptionsForUser(userId),
  ])
  // Flush buffered writes first so a queued page cannot resurrect deleted data.
  await drainBufferedOrderWrites()
  await Promise.all([
    GmailSignal.deleteMany({ connectionId: connection.id, userId }),
    GmailSyncJob.deleteMany({ connectionId: connection.id, userId }),
  ])
  await GoogleConnection.deleteOne({ _id: connection.id, userId })
  await User.updateOne(
    { _id: userId },
    { $pull: { authProviders: 'google' } },
  )
  return true
}

export {
  completeAuthorization,
  createAuthorizationUrl,
  disconnectGoogle,
  getConnectionForUser,
  revokeGoogleAccessForUser,
  stateValuesMatch,
  verifyOAuthState,
}
