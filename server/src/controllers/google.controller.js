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
import { ensureGmailPush } from '../services/google-push.service.js'
import { logEvent } from '../utils/logger.js'
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
    const bodyAccess = request.query.access === 'body'
    const { authorizationUrl, cookieState } = createAuthorizationUrl(request.auth.userId, { bodyAccess })
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
    const authorization = await completeAuthorization({
      code: request.query.code,
      cookieState,
      requestState: request.query.state,
      userId: request.auth.userId,
    })
    if (!authorization.bodyAccess) {
      try { await ensureGmailPush(request.auth.userId) }
      catch { logEvent('warn', 'gmail_push_setup_failed', { errorCode: 'GMAIL_PUSH_SETUP_FAILED' }) }
    }
    try { if (!authorization.bodyAccess) await startSync(request.auth.userId) }
    catch (error) {
      if (error.code !== 'GMAIL_SYNC_IN_PROGRESS') logEvent('warn', 'gmail_initial_sync_enqueue_failed', { errorCode: error.code || 'GMAIL_SYNC_FAILED' })
    }
    response.redirect(authorization.bodyAccess ? `${clientUrl}/top-k?google=connected` : `${clientUrl}/connect/gmail?google=connected`)
  } catch (error) {
    const safeCode = [
      'INVALID_OAUTH_STATE',
      'OAUTH_USER_MISMATCH',
      'GOOGLE_REFRESH_TOKEN_MISSING',
      'GOOGLE_SCOPE_MISSING',
      'GOOGLE_BODY_SCOPE_MISSING',
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
