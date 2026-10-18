import { Router } from 'express'
import requireAuth from '../middleware/auth.middleware.js'
import {
  MICROSOFT_OAUTH_COOKIE_NAME,
  getClearMicrosoftOAuthCookieOptions,
  getMicrosoftClientUrl,
  getMicrosoftOAuthCookieOptions,
  isMicrosoftConfigured,
} from '../config/microsoft.js'
import {
  completeAuthorization,
  createAuthorizationUrl,
  disconnectMicrosoft,
  getConnectionForUser,
} from '../services/microsoft-oauth.service.js'
import { listMicrosoftSubscriptionsForUser } from '../services/microsoft-subscription.service.js'
import { cancelAndWaitForSync, getSyncJob, getSyncPolicy, processNextBatch, startSync } from '../services/microsoft-sync.service.js'
import AppError from '../utils/app-error.js'
import { logEvent } from '../utils/logger.js'

const microsoftRouter = Router()
microsoftRouter.use(requireAuth)

function configurationError(error) {
  return error?.code === 'MICROSOFT_NOT_CONFIGURED'
    ? new AppError('Microsoft connection is not configured for this environment.', 503, 'MICROSOFT_NOT_CONFIGURED')
    : error
}

microsoftRouter.get('/connection', async (request, response) => {
  const connection = await getConnectionForUser(request.auth.userId)
  response.status(200).json({
    success: true,
    microsoft: { available: isMicrosoftConfigured(), connection: connection ? connection.toJSON() : null, syncPolicy: getSyncPolicy() },
  })
})

microsoftRouter.get('/oauth/start', (request, response, next) => {
  try {
    const { authorizationUrl, cookieState } = createAuthorizationUrl(request.auth.userId)
    response.cookie(MICROSOFT_OAUTH_COOKIE_NAME, cookieState, getMicrosoftOAuthCookieOptions())
    response.redirect(authorizationUrl)
  } catch (error) { next(configurationError(error)) }
})

microsoftRouter.get('/oauth/callback', async (request, response) => {
  const clientUrl = getMicrosoftClientUrl()
  const cookieState = request.cookies?.[MICROSOFT_OAUTH_COOKIE_NAME]
  response.clearCookie(MICROSOFT_OAUTH_COOKIE_NAME, getClearMicrosoftOAuthCookieOptions())
  if (request.query.error) return response.redirect(`${clientUrl}/connect/microsoft?microsoft=denied`)
  if (typeof request.query.code !== 'string' || typeof request.query.state !== 'string') return response.redirect(`${clientUrl}/connect/microsoft?microsoft=invalid_callback`)
  try {
    await completeAuthorization({ code: request.query.code, cookieState, requestState: request.query.state, userId: request.auth.userId })
    return response.redirect(`${clientUrl}/connect/microsoft?microsoft=connected`)
  } catch (error) {
    logEvent('error', 'microsoft_oauth_callback_failed', {
      errorCode: error?.code || 'UNCLASSIFIED',
      errorName: error?.name || 'Error',
      providerCode: error?.microsoftProviderCode || 'NOT_AVAILABLE',
      requestId: request.requestId,
      stage: error?.microsoftStage || 'authorization_completion',
    })
    const safeCode = ['INVALID_OAUTH_STATE', 'OAUTH_USER_MISMATCH', 'MICROSOFT_REFRESH_TOKEN_MISSING', 'MICROSOFT_SCOPE_MISSING', 'MICROSOFT_CONNECTION_BUSY', 'MICROSOFT_ACCOUNT_MISMATCH'].includes(error.code)
      ? error.code.toLowerCase()
      : 'connection_failed'
    return response.redirect(`${clientUrl}/connect/microsoft?microsoft=${safeCode}`)
  }
})

microsoftRouter.delete('/connection', async (request, response, next) => {
  try {
    const disconnected = await disconnectMicrosoft(request.auth.userId)
    response.status(200).json({ success: true, disconnected, message: disconnected ? 'Microsoft disconnected.' : 'Microsoft was not connected.' })
  } catch (error) { next(configurationError(error)) }
})

microsoftRouter.get('/sync', async (request, response) => {
  const sync = await getSyncJob(request.auth.userId)
  response.status(200).json({ success: true, sync: sync ? sync.toJSON() : null })
})
microsoftRouter.post('/sync', async (request, response) => {
  const sync = await startSync(request.auth.userId)
  response.status(202).json({ success: true, sync: sync.toJSON() })
})
microsoftRouter.post('/sync/next', async (request, response) => {
  const sync = await processNextBatch(request.auth.userId)
  response.status(200).json({ success: true, sync: sync ? sync.toJSON() : null })
})
microsoftRouter.delete('/sync', async (request, response) => {
  const sync = await cancelAndWaitForSync(request.auth.userId)
  response.status(200).json({ success: true, sync: sync ? sync.toJSON() : null })
})
microsoftRouter.get('/subscriptions', async (request, response) => {
  const result = await listMicrosoftSubscriptionsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
})

export default microsoftRouter
