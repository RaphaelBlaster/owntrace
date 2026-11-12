import { Router } from 'express'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { matchesMicrosoftClientState } from '../services/microsoft-push.service.js'
import { queuePushSync } from '../services/mail-push-sync.service.js'
import { verifyGmailPubSubRequest } from '../services/google-push.service.js'
import { logEvent } from '../utils/logger.js'

const router = Router()

router.post('/google', async (request, response) => {
  if (!await verifyGmailPubSubRequest(request.get('authorization'))) return response.sendStatus(401)
  const encoded = request.body?.message?.data
  let notification
  if (typeof encoded === 'string') {
    if (encoded.length > 16_384) return response.sendStatus(204)
    try { notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { return response.sendStatus(204) }
  } else if (typeof request.body?.emailAddress === 'string') {
    // Subscriptions with payload unwrapping deliver the Gmail JSON directly.
    notification = request.body
  } else return response.sendStatus(204)
  const email = typeof notification?.emailAddress === 'string' ? notification.emailAddress.trim().toLowerCase() : ''
  if (!email) return response.sendStatus(204)
  const connection = await GoogleConnection.findOne({ email, status: { $nin: ['DISCONNECTING', 'NEEDS_RECONNECT'] } }).select('_id userId')
  if (!connection) {
    logEvent('warn', 'gmail_push_unmatched_mailbox', { reason: 'no_active_connection' })
    return response.sendStatus(204)
  }
  try { await queuePushSync('gmail', connection.userId) }
  catch (error) {
    // Ack anyway: the mail sync worker's safety-net poll picks the mailbox up,
    // and a 5xx here only makes Pub/Sub redeliver into the same failure.
    logEvent('warn', 'gmail_push_queue_failed', { errorCode: typeof error?.code === 'string' ? error.code : 'MAIL_PUSH_QUEUE_FAILED' })
  }
  return response.sendStatus(204)
})

router.post('/microsoft', async (request, response) => {
  if (typeof request.query.validationToken === 'string') {
    const token = request.query.validationToken
    if (token.length > 2048) return response.sendStatus(400)
    return response.status(200).type('text/plain').send(token)
  }
  const notifications = request.body?.value
  if (!Array.isArray(notifications) || notifications.length > 100) return response.sendStatus(202)
  for (const notification of notifications) {
    if (typeof notification?.subscriptionId !== 'string' || typeof notification.clientState !== 'string') continue
    const connection = await MicrosoftConnection.findOne({ graphSubscriptionId: notification.subscriptionId, status: { $nin: ['DISCONNECTING', 'NEEDS_RECONNECT'] } }).select('+graphClientStateHash userId')
    if (connection && matchesMicrosoftClientState(notification.clientState, connection.graphClientStateHash)) {
      if (notification.lifecycleEvent === 'subscriptionRemoved' || notification.lifecycleEvent === 'reauthorizationRequired') {
        await MicrosoftConnection.updateOne({ _id: connection.id }, { $set: { graphSubscriptionExpiresAt: new Date(0), pushStatus: 'PENDING' } })
      }
      try { await queuePushSync('microsoft', connection.userId) }
      catch (error) { logEvent('warn', 'microsoft_push_queue_failed', { errorCode: typeof error?.code === 'string' ? error.code : 'MAIL_PUSH_QUEUE_FAILED' }) }
    }
  }
  return response.sendStatus(202)
})

export default router
