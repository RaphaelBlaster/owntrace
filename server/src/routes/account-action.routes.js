import { Router } from 'express'
import {
  getAccountActionSummary,
  listAccountActions,
  updateAccountActionStatus,
} from '../controllers/account-action.controller.js'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'

const accountActionRouter = Router()

accountActionRouter.use(requireAuth)
const listQuery = Joi.object({ status: Joi.string().max(40), page: Joi.string().pattern(/^\d{1,6}$/), limit: Joi.string().pattern(/^\d{1,4}$/), accountId: Joi.string().max(64) })
accountActionRouter.get('/', validate(listQuery, 'query'), listAccountActions)
accountActionRouter.get('/summary', getAccountActionSummary)
const statusBody = Joi.object({ status: Joi.string().max(40).required() })
accountActionRouter.patch('/:id', validate(statusBody), updateAccountActionStatus)

export default accountActionRouter
