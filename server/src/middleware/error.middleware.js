import AppError from '../utils/app-error.js'
import { logEvent } from '../utils/logger.js'

function notFoundHandler(_request, _response, next) {
  next(new AppError('API route not found.', 404, 'NOT_FOUND'))
}

function errorHandler(error, request, response, _next) {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    response.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      message: 'Request body contains invalid JSON.',
    })
    return
  }

  const statusCode = error.statusCode || 500
  const isOperationalError = error instanceof AppError
  const payload = {
    success: false,
    code: error.code || 'INTERNAL_ERROR',
    message:
      statusCode >= 500 && !isOperationalError
        ? 'An unexpected server error occurred.'
        : error.message,
  }

  if (error.details && statusCode < 500) payload.errors = error.details

  if (statusCode >= 500) {
    logEvent('error', 'api_request_failed', {
      errorName: error.name,
      method: request.method,
      path: request.originalUrl.split('?')[0],
      requestId: request.requestId,
      statusCode,
    })
  }

  response.status(statusCode).json(payload)
}

export { errorHandler, notFoundHandler }
