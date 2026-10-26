import { Router } from 'express'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import { matchesMicrosoftClientState } from '../services/microsoft-push.service.js'
import { queuePushSync } from '../services/mail-push-sync.service.js'
import { verifyGmailPubSubRequest } from '../services/google-push.service.js'

const router = Router()

router.post('/google', async (request, response) => {
  if (!await verifyGmailPubSubRequest(request.get('authorization'))) return response.sendStatus(401)
  const encoded = request.body?.message?.data
  if (typeof encoded !== 'string' || encoded.length > 16_384) return response.sendStatus(204)
  let notification
  try { notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) } catch { return response.sendStatus(204) }
  const email = typeof notification.emailAddress === 'string' ? notification.emailAddress.trim().toLowerCase() : ''
  if (!email) return response.sendStatus(204)
  const connection = await GoogleConnection.findOne({ email, status: { $nin: ['DISCONNECTING', 'NEEDS_RECONNECT'] } }).select('_id userId')
  if (connection) await queuePushSync('gmail', connection.userId)
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
      await queuePushSync('microsoft', connection.userId)
    }
  }
  return response.sendStatus(202)
})

export default router
