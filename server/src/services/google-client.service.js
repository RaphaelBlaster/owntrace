import { google } from 'googleapis'
import GoogleConnection from '../models/google-connection.model.js'
import AppError from '../utils/app-error.js'
import { decryptSecret, encryptSecret } from '../utils/encryption.js'
import { getGoogleConfig } from '../config/google.js'

function createOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function classifyGoogleError(error) {
  const status = error?.response?.status || error?.code
  const providerCode = error?.response?.data?.error

  if (status === 401 || providerCode === 'invalid_grant') {
    return new AppError(
      'Google access has expired or was revoked. Reconnect Gmail to continue.',
      401,
      'GOOGLE_RECONNECT_REQUIRED',
    )
  }

  if (status === 429) {
    return new AppError(
      'Google is temporarily rate limiting this scan. Wait and retry the batch.',
      429,
      'GOOGLE_RATE_LIMITED',
    )
  }

  return new AppError(
    'Google could not complete this metadata request. Retry the batch.',
    502,
    'GOOGLE_REQUEST_FAILED',
  )
}

async function persistRefreshedTokens(connection, tokens) {
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return

  const updates = {}
  if (tokens.access_token) updates.encryptedAccessToken = encryptSecret(tokens.access_token)
  if (tokens.refresh_token) updates.encryptedRefreshToken = encryptSecret(tokens.refresh_token)
  if (tokens.expiry_date) updates.tokenExpiresAt = new Date(tokens.expiry_date)

  await GoogleConnection.updateOne({ _id: connection.id, userId: connection.userId }, { $set: updates })
}

async function withGoogleClient(userId, operation) {
  const connection = await GoogleConnection.findOne({ userId })
    .select('+encryptedAccessToken +encryptedRefreshToken')

  if (!connection) {
    throw new AppError('Connect Gmail before starting a scan.', 409, 'GOOGLE_NOT_CONNECTED')
  }

  if (connection.status === 'DISCONNECTING') {
    throw new AppError('Google is disconnecting.', 409, 'GOOGLE_DISCONNECT_IN_PROGRESS')
  }

  if (!connection.encryptedRefreshToken) {
    await GoogleConnection.updateOne(
      { _id: connection.id, userId },
      { $set: { status: 'NEEDS_RECONNECT', lastErrorCode: 'GOOGLE_REFRESH_TOKEN_MISSING' } },
    )
    throw new AppError(
      'Google offline access is unavailable. Reconnect Gmail to continue.',
      409,
      'GOOGLE_RECONNECT_REQUIRED',
    )
  }

  const oauthClient = createOAuthClient()
  let refreshedTokens = null
  oauthClient.on('tokens', (tokens) => {
    refreshedTokens = { ...refreshedTokens, ...tokens }
  })
  oauthClient.setCredentials({
    access_token: decryptSecret(connection.encryptedAccessToken),
    expiry_date: connection.tokenExpiresAt.getTime(),
    refresh_token: decryptSecret(connection.encryptedRefreshToken),
    scope: connection.scopes.join(' '),
  })

  try {
    const result = await operation({ connection, oauthClient })
    await persistRefreshedTokens(connection, refreshedTokens)
    return result
  } catch (error) {
    const safeError = error instanceof AppError ? error : classifyGoogleError(error)

    if (safeError.code === 'GOOGLE_RECONNECT_REQUIRED') {
      await GoogleConnection.updateOne(
        { _id: connection.id, userId, status: { $ne: 'DISCONNECTING' } },
        { $set: { status: 'NEEDS_RECONNECT', lastErrorCode: safeError.code } },
      )
    }

    throw safeError
  }
}

export { classifyGoogleError, withGoogleClient }
