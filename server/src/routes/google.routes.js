import { Router } from 'express'
import {
  cancelGmailSync,
  continueGmailSync,
  disconnect,
  getConnection,
  getSync,
  oauthCallback,
  startGmailSync,
  startOAuth,
} from '../controllers/google.controller.js'
import requireAuth from '../middleware/auth.middleware.js'

const googleRouter = Router()

googleRouter.use(requireAuth)
googleRouter.get('/connection', getConnection)
googleRouter.get('/oauth/start', startOAuth)
googleRouter.get('/oauth/callback', oauthCallback)
googleRouter.delete('/connection', disconnect)
googleRouter.get('/sync', getSync)
googleRouter.post('/sync', startGmailSync)
googleRouter.post('/sync/next', continueGmailSync)
googleRouter.delete('/sync', cancelGmailSync)

export default googleRouter
