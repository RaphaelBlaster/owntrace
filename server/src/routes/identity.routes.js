import { Router } from 'express'
import { getIdentityGraph } from '../controllers/identity.controller.js'
import requireAuth from '../middleware/auth.middleware.js'

const identityRouter = Router()

identityRouter.use(requireAuth)
identityRouter.get('/', getIdentityGraph)

export default identityRouter
