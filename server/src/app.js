import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { getRuntimeConfig } from './config/runtime.js'
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js'
import requestContext from './middleware/request-context.middleware.js'
import {
  apiRateLimiter,
  createCorsOptions,
  requireTrustedOrigin,
} from './middleware/security.middleware.js'
import accountRouter from './routes/account.routes.js'
import accountActionRouter from './routes/account-action.routes.js'
import authRouter from './routes/auth.routes.js'
import googleRouter from './routes/google.routes.js'
import healthRouter from './routes/health.routes.js'
import identityRouter from './routes/identity.routes.js'
import onboardingRouter from './routes/onboarding.routes.js'
import privacyFeatureRouter from './routes/privacy-feature.routes.js'
import microsoftRouter from './routes/microsoft.routes.js'
import traceRouter from './routes/trace.routes.js'
import orderRouter from './routes/order.routes.js'

const app = express()
const runtime = getRuntimeConfig()
const clientDistUrl = new URL('../../client/dist/', import.meta.url)

app.disable('x-powered-by')
app.set('trust proxy', runtime.trustProxy)
app.use(requestContext)
app.use(helmet({ hsts: process.env.NODE_ENV === 'production' ? undefined : false }))
app.use(cors(createCorsOptions()))
app.use('/api', apiRateLimiter)
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use(requireTrustedOrigin)

app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/google', googleRouter)
app.use('/api/microsoft', microsoftRouter)
app.use('/api/onboarding', onboardingRouter)
app.use('/api/accounts', accountRouter)
app.use('/api/account-actions', accountActionRouter)
app.use('/api/identity', identityRouter)
app.use('/api/trace', traceRouter)
app.use('/api/orders', orderRouter)
app.use('/api', privacyFeatureRouter)

if (runtime.nodeEnvironment === 'production') {
  const clientDistPath = fileURLToPath(clientDistUrl)
  app.use(express.static(clientDistPath, { index: false, maxAge: '1h' }))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next()
    response.setHeader('Cache-Control', 'no-store')
    return response.sendFile(fileURLToPath(new URL('index.html', clientDistUrl)), (error) => {
      if (error) next(error)
    })
  })
}

app.use(notFoundHandler)
app.use(errorHandler)

export default app
