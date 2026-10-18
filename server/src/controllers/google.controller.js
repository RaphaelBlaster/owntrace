import {
  GOOGLE_OAUTH_COOKIE_NAME,
  getClearGoogleOAuthCookieOptions,
  getGoogleClientUrl,
  getGoogleOAuthCookieOptions,
  isGoogleConfigured,
} from '../config/google.js'
import {
  completeAuthorization,
  createAuthorizationUrl,
  disconnectGoogle,
  getConnectionForUser,
} from '../services/google-oauth.service.js'
import { buildGoogleCapabilities } from '../services/google-capability.service.js'
import {
  cancelAndWaitForSync,
  getSyncPolicy,
  getSyncJob,
  processNextBatch,
  startSync,
} from '../services/gmail-sync.service.js'
import AppError from '../utils/app-error.js'

function configurationError(error) {
  if (error?.code === 'GOOGLE_NOT_CONFIGURED') {
    return new AppError(
      'Google connection is not configured for this environment.',
      503,
      'GOOGLE_NOT_CONFIGURED',
    )
  }

  return error
}

async function getConnection(request, response) {
  const connection = await getConnectionForUser(request.auth.userId)

  response.status(200).json({
    success: true,
    google: {
      available: isGoogleConfigured(),
      capabilities: buildGoogleCapabilities(connection),
      connection: connection ? connection.toJSON() : null,
      syncPolicy: getSyncPolicy(),
    },
  })
}

function startOAuth(request, response, next) {
  try {
    const { authorizationUrl, cookieState } = createAuthorizationUrl(request.auth.userId)
    response.cookie(GOOGLE_OAUTH_COOKIE_NAME, cookieState, getGoogleOAuthCookieOptions())
    response.redirect(authorizationUrl)
  } catch (error) {
    next(configurationError(error))
  }
}

async function oauthCallback(request, response) {
  const clientUrl = getGoogleClientUrl()
  const cookieState = request.cookies?.[GOOGLE_OAUTH_COOKIE_NAME]
  response.clearCookie(GOOGLE_OAUTH_COOKIE_NAME, getClearGoogleOAuthCookieOptions())

  if (request.query.error) {
    response.redirect(`${clientUrl}/connect/gmail?google=denied`)
    return
  }

  if (typeof request.query.code !== 'string' || typeof request.query.state !== 'string') {
    response.redirect(`${clientUrl}/connect/gmail?google=invalid_callback`)
    return
  }

  try {
    await completeAuthorization({
      code: request.query.code,
      cookieState,
      requestState: request.query.state,
      userId: request.auth.userId,
    })
    response.redirect(`${clientUrl}/connect/gmail?google=connected`)
  } catch (error) {
    const safeCode = [
      'INVALID_OAUTH_STATE',
      'OAUTH_USER_MISMATCH',
      'GOOGLE_REFRESH_TOKEN_MISSING',
      'GOOGLE_SCOPE_MISSING',
      'GOOGLE_ACCOUNT_MISMATCH',
      'GOOGLE_CONNECTION_BUSY',
    ].includes(error.code)
      ? error.code.toLowerCase()
      : 'connection_failed'
    response.redirect(`${clientUrl}/connect/gmail?google=${safeCode}`)
  }
}

async function disconnect(request, response, next) {
  try {
    const disconnected = await disconnectGoogle(request.auth.userId)
    response.status(200).json({
      success: true,
      disconnected,
      message: disconnected ? 'Google disconnected.' : 'Google was not connected.',
    })
  } catch (error) {
    next(configurationError(error))
  }
}

async function getSync(request, response) {
  const sync = await getSyncJob(request.auth.userId)
  response.status(200).json({ success: true, sync: sync ? sync.toJSON() : null })
}

async function startGmailSync(request, response) {
  const sync = await startSync(request.auth.userId)
  response.status(202).json({ success: true, sync: sync.toJSON() })
}

async function continueGmailSync(request, response) {
  const sync = await processNextBatch(request.auth.userId)
  response.status(200).json({ success: true, sync: sync ? sync.toJSON() : null })
}

async function cancelGmailSync(request, response) {
  const sync = await cancelAndWaitForSync(request.auth.userId)
  response.status(200).json({ success: true, sync: sync ? sync.toJSON() : null })
}

export {
  cancelGmailSync,
  continueGmailSync,
  disconnect,
  getConnection,
  getSync,
  oauthCallback,
  startGmailSync,
  startOAuth,
}
