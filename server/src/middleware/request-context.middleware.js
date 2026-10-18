import { randomUUID } from 'node:crypto'
import { logEvent } from '../utils/logger.js'

function requestContext(request, response, next) {
  const startedAt = process.hrtime.bigint()
  const requestId = randomUUID()
  request.requestId = requestId
  response.setHeader('X-Request-ID', requestId)

  response.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    logEvent('info', 'api_request_completed', {
      durationMs: Math.round(durationMs),
      method: request.method,
      path: request.originalUrl.split('?')[0],
      requestId,
      statusCode: response.statusCode,
    })
  })

  next()
}

export default requestContext
