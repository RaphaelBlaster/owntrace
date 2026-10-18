import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import mongoose from 'mongoose'
import requireAuth from '../middleware/auth.middleware.js'
import Conversation from '../models/trace-conversation.model.js'
import User from '../models/user.model.js'
import { executeTrace, waitForTraceDrain } from '../services/trace-execution.service.js'
import { checkTraceConsent as checkConsent } from '../services/trace-consent.service.js'
import { SESSION_COOKIE_NAME } from '../config/auth.js'
import { getTraceProviderConfig, getTraceProviderName } from '../services/trace-provider.service.js'
import { executeTraceTool } from '../services/trace-tools.service.js'
import AppError from '../utils/app-error.js'
import {getTraceDecisionProvider,traceConsentVersion} from '../services/trace-decision-config.js'

const router = Router()
router.use(requireAuth)
router.use((request, _response, next) => request.user.onboardingStatus === 'COMPLETED' ? next() : next(new AppError('Complete OwnTrace setup before opening TRACE.', 403, 'TRACE_SETUP_REQUIRED')))
router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
const limiter = rateLimit({ windowMs: 60_000, limit: 12, keyGenerator: (request) => request.auth.userId, standardHeaders: true, legacyHeaders: false, message: { code: 'TRACE_RATE_LIMIT', message: 'Please wait a moment before sending another TRACE message.' } })
async function owned(request) {
  if (!mongoose.isObjectIdOrHexString(request.params.id)) throw new AppError('Conversation not found.', 404, 'TRACE_NOT_FOUND')
  await Conversation.updateOne({ _id: request.params.id, userId: request.auth.userId, leaseUntil: { $lte: new Date() } }, { $set: { 'messages.$[pending].status': 'failed', leaseId: null, leaseUntil: null } }, { arrayFilters: [{ 'pending.status': 'pending' }] })
  const item = await Conversation.findOne({ _id: request.params.id, userId: request.auth.userId })
  if (!item) throw new AppError('Conversation not found.', 404, 'TRACE_NOT_FOUND')
  return item
}
router.get('/status', (_request, response) => {
  let configured = true
  try { getTraceProviderConfig(); if(getTraceDecisionProvider()==='typesafe' && !process.env.TYPESAFE_API_KEY?.trim())configured=false } catch { configured = false }
  let provider
  try { provider = getTraceProviderName() } catch { provider = 'unavailable' }
  let decisionProvider,version
  try {decisionProvider=getTraceDecisionProvider();version=traceConsentVersion()}catch{decisionProvider='unavailable';version=-1}
  const label=provider === 'azure' ? 'Azure OpenAI' : provider === 'inception' ? 'Inception Labs' : 'AI provider'
  response.json({configured,provider,decisionProvider,providerLabel:label+(decisionProvider==='typesafe'?' + TypeSafe Jev':''),consentEnabled:_request.user.traceAiConsent?.provider===provider && _request.user.traceAiConsent?.version===version && Boolean(_request.user.traceAiConsent?.acceptedAt)})
})
router.put('/consent', async (request, response) => {
  if (typeof request.body?.enabled !== 'boolean' || Object.keys(request.body).some((key) => key !== 'enabled')) throw new AppError('Choose whether to enable TRACE AI processing.', 400, 'INVALID_TRACE_CONSENT')
  await User.updateOne({ _id: request.auth.userId }, { $set: { traceAiConsent: { provider: getTraceProviderName(), version: request.body.enabled ? traceConsentVersion() : 0, acceptedAt: request.body.enabled ? new Date() : null } } })
  response.json({ consentEnabled: request.body.enabled })
})
router.get('/conversations', async (request, response) => {
  const items = await Conversation.find({ userId: request.auth.userId }).select('title updatedAt').sort({ updatedAt: -1 }).limit(50)
  response.json({ conversations: items.map((item) => item.toJSON()) })
})
router.post('/conversations', async (request, response) => {
  const conversation = await Conversation.create({ userId: request.auth.userId })
  response.status(201).json({ conversation: conversation.toJSON() })
})
router.get('/conversations/:id', async (request, response) => response.json({ conversation: (await owned(request)).toJSON() }))
router.delete('/conversations/:id', async (request, response) => {
  const item = await owned(request)
  const deleted = await Conversation.deleteOne({ _id: item.id, userId: request.auth.userId, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] })
  if (!deleted.deletedCount) throw new AppError('Stop the current response before deleting this conversation.', 409, 'TRACE_BUSY')
  response.status(204).end()
})
// Re-resolve persisted source actions against current ownership and merged subscription ordering.
router.post('/resolve-action', async (request, response) => {
  const action = request.body
  if (!action || typeof action.type !== 'string') throw new AppError('Invalid navigation action.', 400, 'INVALID_TRACE_TOOL')
  const { type, ...args } = action
  if (!['navigate_to_page', 'open_account', 'show_subscriptions', 'focus_entity','close_preview'].includes(type)) throw new AppError('Unsupported navigation action.', 400, 'INVALID_TRACE_TOOL')
  const result = await executeTraceTool(request.auth.userId, type, args)
  response.json({ actions: result.actions })
})
router.post('/conversations/:id/messages', limiter, async (request, response) => {
  const conversation = await owned(request)
  const content = request.body?.content
  if (typeof content !== 'string' || !content.trim() || content.length > 8000 || Object.keys(request.body).some((key) => !['content', 'retryMessageId', 'responseDetail'].includes(key))) throw new AppError('Send a message between 1 and 8000 characters.', 400, 'INVALID_TRACE_MESSAGE')
  const responseDetail = request.body.responseDetail || 'high'
  if (!['low', 'medium', 'high'].includes(responseDetail)) throw new AppError('Choose a supported response detail.', 400, 'INVALID_TRACE_MESSAGE')
  if (conversation.messages.length >= 200) throw new AppError('Start a new conversation to keep TRACE focused.', 422, 'TRACE_CONVERSATION_FULL')
  const providerConfig = getTraceProviderConfig()
  await checkConsent(request.auth.userId, providerConfig.provider)
  const retryId = request.body.retryMessageId
  const retry = retryId ? conversation.messages.find((message) => message.id === retryId && message.role === 'user' && ['failed', 'cancelled'].includes(message.status) && message.content === content.trim()) : null
  if (retryId && !retry) throw new AppError('This question cannot be retried. Reload the conversation.', 409, 'TRACE_INVALID_RETRY')
  const messageId = retry ? retry._id : new mongoose.Types.ObjectId()
  const leaseId = randomUUID()
  const locked = await Conversation.findOneAndUpdate({ _id: conversation.id, userId: request.auth.userId, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] }, {
    $set: { leaseId, leaseUntil: new Date(Date.now() + 60_000), title: conversation.messages.length ? conversation.title : content.trim().slice(0, 80), ...(retry ? { 'messages.$[turn].status': 'pending' } : {}) },
    ...(!retry ? { $push: { messages: { _id: messageId, role: 'user', content: content.trim(), status: 'pending' } } } : {}),
  }, { returnDocument: 'after', ...(retry ? { arrayFilters: [{ 'turn._id': messageId }] } : {}) })
  if (!locked) throw new AppError('TRACE is already answering in this conversation.', 409, 'TRACE_BUSY')
  const controller = new AbortController()
  const deadlineAt = Date.now() + 45_000
  const timer = setTimeout(() => controller.abort(), 45_000)
  const disconnect = () => { if (!response.writableEnded) controller.abort() }
  response.on('close', disconnect)
  const streaming = request.get('accept')?.includes('text/event-stream')
  const emit = streaming ? (event, data) => {
    if (response.destroyed || response.writableEnded) return
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    // Completion contains the persisted conversation, including prior turns.
    const maximum = event === 'complete' ? 16 * 1024 * 1024 : 512 * 1024
    if (response.writableLength + Buffer.byteLength(frame) > maximum) {
      controller.abort(); throw new AppError('TRACE output exceeded streaming capacity.', 503, 'TRACE_STREAM_CAPACITY')
    }
    response.write(frame)
  } : undefined
  if (streaming) { response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' }); response.flushHeaders(); emit('status', { text: 'Looking through your workspace…', messageId: messageId.toString() }) }
  const heartbeat = streaming ? setInterval(() => { if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain) response.write(': keep-alive\n\n') }, 10000) : null
  try {
    const reply = await executeTrace({
      job: { conversationId: conversation.id, messageId: messageId.toString(), leaseId, responseDetail, provider: providerConfig.provider, deadlineAt },
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(request.cookies[SESSION_COOKIE_NAME])}`,
      userId: request.auth.userId, history: locked.messages, content: content.trim(), signal: controller.signal,
      onEvent: emit, checkConsent: () => checkConsent(request.auth.userId, providerConfig.provider), providerConfig, responseDetail,
      waitForOutput: streaming ? () => waitForTraceDrain(response, controller.signal) : undefined,
    })
    await checkConsent(request.auth.userId, providerConfig.provider)
    controller.signal.throwIfAborted()
    const messages = locked.messages.map((message) => ({ ...message.toObject(), ...(message._id.equals(messageId) ? { status: 'completed' } : {}) }))
    messages.push(locked.messages.create(reply).toObject())
    const updated = await Conversation.findOneAndUpdate({ _id: conversation.id, userId: request.auth.userId, leaseId }, {
      $set: { messages, leaseId: null, leaseUntil: null },
    }, { returnDocument: 'after' })
    if (!updated) throw new AppError('Conversation changed. Please reload it.', 409, 'TRACE_BUSY')
    if (emit) { emit('complete', { conversation: updated.toJSON() }); response.end() } else response.json({ conversation: updated.toJSON() })
  } catch (error) {
    await Conversation.updateOne({ _id: conversation.id, userId: request.auth.userId, leaseId }, { $set: { 'messages.$[turn].status': controller.signal.aborted ? 'cancelled' : 'failed' } }, { arrayFilters: [{ 'turn._id': messageId }] })
    if (controller.signal.aborted) error = new AppError('TRACE response stopped or timed out. Your question is saved and can be retried.', 408, 'TRACE_CANCELLED')
    if (emit) { emit('error', { code: error instanceof AppError ? error.code : 'TRACE_ERROR', message: error instanceof AppError ? error.message : 'TRACE could not finish this response. Please retry.' }); response.end(); return }
    throw error
  } finally {
    clearTimeout(timer); clearInterval(heartbeat); response.off('close', disconnect)
    await Conversation.updateOne({ _id: conversation.id, userId: request.auth.userId, leaseId }, { $set: { leaseId: null, leaseUntil: null } })
  }
})
export default router
