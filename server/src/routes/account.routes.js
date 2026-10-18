import { Router } from 'express'
import {
  getAccount,
  getAccountSummary,
  listAccounts,
} from '../controllers/account.controller.js'
import requireAuth from '../middleware/auth.middleware.js'

const accountRouter = Router()

accountRouter.use(requireAuth)
accountRouter.get('/', listAccounts)
accountRouter.get('/summary', getAccountSummary)
accountRouter.get('/:id', getAccount)

export default accountRouter
