import { Router } from 'express'
import {
  getAccountActionSummary,
  listAccountActions,
  updateAccountActionStatus,
} from '../controllers/account-action.controller.js'
import requireAuth from '../middleware/auth.middleware.js'

const accountActionRouter = Router()

accountActionRouter.use(requireAuth)
accountActionRouter.get('/', listAccountActions)
accountActionRouter.get('/summary', getAccountActionSummary)
accountActionRouter.patch('/:id', updateAccountActionStatus)

export default accountActionRouter
