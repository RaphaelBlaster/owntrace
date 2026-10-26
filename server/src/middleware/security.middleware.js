import { rateLimit } from 'express-rate-limit'
import { getAllowedOrigins } from '../config/auth.js'
import AppError from '../utils/app-error.js'
import SlidingWindowStore from './sliding-window-store.js'

const rateLimitResponse = {
  success: false,
  code: 'RATE_LIMITED',
  message: 'Too many requests. Please wait and try again.',
}

const isMailStatus = request => request.method === 'GET' && (/^\/(google|microsoft)\/(sync|connection)\/?$/.test(request.path) || /^\/top-k\/?$/.test(request.path))

const apiRateLimiter = rateLimit({
  store: new SlidingWindowStore(),
  legacyHeaders: false,
  limit: 200,
  message: rateLimitResponse,
  skip: request => process.env.NODE_ENV === 'test' || isMailStatus(request),
  standardHeaders: 'draft-8',
  windowMs: 15 * 60 * 1000,
})

const mailStatusRateLimiter = rateLimit({
  store: new SlidingWindowStore(),
  limit: 60,
  windowMs: 60 * 1000,
  legacyHeaders: false,
  standardHeaders: 'draft-8',
  message: rateLimitResponse,
  skip: request => process.env.NODE_ENV === 'test' || !isMailStatus(request),
})

const providerNotificationRateLimiter = rateLimit({
  store: new SlidingWindowStore(),
  legacyHeaders: false,
  limit: 1000,
  message: rateLimitResponse,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: 'draft-8',
  windowMs: 60 * 1000,
})

const authRateLimiter = rateLimit({
  store: new SlidingWindowStore(),
  legacyHeaders: false,
  limit: 20,
  message: rateLimitResponse,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: 'draft-8',
  windowMs: 15 * 60 * 1000,
})

function createCorsOptions() {
  const allowedOrigins = getAllowedOrigins()

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new AppError('Request origin is not allowed.', 403, 'ORIGIN_NOT_ALLOWED'))
    },
  }
}

function requireTrustedOrigin(request, _response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next()
  if (process.env.NODE_ENV === 'test') return next()

  const origin = request.get('origin')

  if (!origin || !getAllowedOrigins().includes(origin)) {
    return next(new AppError('Request origin is not allowed.', 403, 'ORIGIN_NOT_ALLOWED'))
  }

  return next()
}

export { apiRateLimiter, authRateLimiter, mailStatusRateLimiter, createCorsOptions, providerNotificationRateLimiter, requireTrustedOrigin }
