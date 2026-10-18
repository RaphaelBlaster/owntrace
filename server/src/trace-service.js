import { createHash, timingSafeEqual } from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import { getTraceExecutionConfig } from './config/trace-execution.js'
import requireAuth from './middleware/auth.middleware.js'
import Conversation from './models/trace-conversation.model.js'
import { answerTrace } from './services/trace-assistant.service.js'
import { checkTraceConsent } from './services/trace-consent.service.js'
import { getTraceProviderConfig } from './services/trace-provider.service.js'
import { getTraceDecisionProvider } from './services/trace-decision-config.js'
import { writeTraceFrame, waitForTraceDrain } from './services/trace-execution.service.js'
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js'
import AppError from './utils/app-error.js'

const digest = value => createHash('sha256').update(value).digest()
export function createTraceService({ engine = answerTrace } = {}) {
  const config = getTraceExecutionConfig({ service: true })
  const app = express(); const active = new Map()
  app.disable('x-powered-by')
  app.use((request, response, next) => {
    response.set('Cache-Control', 'no-store')
    if (!timingSafeEqual(digest(request.get('authorization') || ''), digest(`Bearer ${config.token}`))) return response.status(401).json({ code: 'TRACE_INTERNAL_AUTH', message: 'TRACE service authentication required.' })
    next()
  })
  app.get('/api/health/ready', (_request, response) => {
    let configured = true
    try {
      getTraceProviderConfig()
      if (getTraceDecisionProvider() === 'typesafe' && !process.env.TYPESAFE_API_KEY?.trim()) configured = false
    } catch { configured = false }
    response.status(mongoose.connection.readyState === 1 && configured ? 200 : 503).json({ ready: mongoose.connection.readyState === 1 && configured, active: active.size })
  })
  app.use(express.json({ limit: '4kb' })); app.use(cookieParser())
  app.post('/internal/trace/answer', requireAuth, async (request, response) => {
    const job = request.body
    const keys = ['conversationId','messageId','leaseId','provider','responseDetail','deadlineAt']
    if (!job || Object.keys(job).some(key => !keys.includes(key)) || !mongoose.isObjectIdOrHexString(job.conversationId) || !mongoose.isObjectIdOrHexString(job.messageId) || typeof job.leaseId !== 'string' || job.leaseId.length > 100 || !job.leaseId || !['low','medium','high'].includes(job.responseDetail) || !['azure','inception'].includes(job.provider) || !Number.isSafeInteger(job.deadlineAt) || job.deadlineAt <= Date.now() || job.deadlineAt > Date.now()+45000) throw new AppError('Invalid TRACE execution request.', 400, 'TRACE_INVALID_JOB')
    const providerConfig = getTraceProviderConfig()
    if (providerConfig.provider !== job.provider) throw new AppError('TRACE provider configuration changed. Please retry.', 503, 'TRACE_PROVIDER_CHANGED')
    const guard = async () => {
      // Check revocation/expiry as well as consent throughout model/tool execution.
      await new Promise((resolve, reject) => requireAuth(request, response, error => error ? reject(error) : resolve()))
      await checkTraceConsent(request.auth.userId, job.provider)
      const stillOwned = await Conversation.exists({ _id: job.conversationId, userId: request.auth.userId, leaseId: job.leaseId, leaseUntil: { $gt: new Date() } })
      if (!stillOwned) throw new AppError('TRACE turn is no longer active.', 409, 'TRACE_LEASE_EXPIRED')
    }
    const conversation = await Conversation.findOne({ _id: job.conversationId, userId: request.auth.userId, leaseId: job.leaseId, leaseUntil: { $gt: new Date() } })
    const turn = conversation?.messages.find(message => message._id.toString() === job.messageId && message.role === 'user' && message.status === 'pending')
    if (!turn) throw new AppError('Conversation not found.', 404, 'TRACE_NOT_FOUND')
    await guard()
    if (active.size >= config.maxConcurrent || active.has(job.leaseId)) throw new AppError('TRACE is at capacity. Please retry shortly.', 503, 'TRACE_CAPACITY')
    const controller = new AbortController()
    const abortResponse = () => { if (!response.destroyed) response.destroy() }
    controller.signal.addEventListener('abort', abortResponse, { once: true })
    active.set(job.leaseId, controller)
    const timer = setTimeout(() => controller.abort(), Math.max(1,job.deadlineAt-Date.now()))
    const disconnect = () => { if (!response.writableEnded) controller.abort() }
    response.on('close', disconnect)
    response.set('Content-Type', 'application/x-ndjson'); response.flushHeaders()
    const emit = (type, data) => writeTraceFrame(response, { type, data }, controller.signal)
    try {
      const answer = await engine(request.auth.userId, conversation.messages, turn.content, controller.signal, emit, guard, providerConfig, job.responseDetail)
      controller.signal.throwIfAborted(); await guard()
      writeTraceFrame(response, { type: 'complete', data: answer }, controller.signal)
      await waitForTraceDrain(response, controller.signal); response.end()
    } catch (error) {
      if (!controller.signal.aborted && !response.destroyed) {
        const safe = error instanceof AppError && /^TRACE_[A-Z_]+$/.test(error.code) ? error : new AppError('TRACE processing failed. Please retry.', 502, 'TRACE_EXECUTION_FAILED')
        try { writeTraceFrame(response, { type:'error',code:safe.code,message:safe.message,statusCode:safe.statusCode },controller.signal);response.end() }
        catch { response.destroy() }
      } else if (!response.destroyed) response.destroy()
    } finally {
      clearTimeout(timer); response.off('close',disconnect)
      controller.signal.removeEventListener('abort', abortResponse)
      active.delete(job.leaseId)
    }
  })
  app.use(notFoundHandler); app.use(errorHandler)
  app.locals.stopTrace = () => { for (const controller of active.values()) controller.abort() }
  return app
}
