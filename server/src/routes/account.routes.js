import { Router } from 'express'
import {
  getAccount,
  getAccountSummary,
  listAccounts,
} from '../controllers/account.controller.js'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'

const accountRouter = Router()

accountRouter.use(requireAuth)
const listQuery = Joi.object({ page: Joi.string().pattern(/^\d{1,6}$/), limit: Joi.string().pattern(/^\d{1,4}$/), confidence: Joi.string().max(40), dormant: Joi.string().max(40), sort: Joi.string().max(40), direction: Joi.string().valid('asc', 'desc'), search: Joi.string().allow('').max(200) })
accountRouter.get('/', validate(listQuery, 'query'), listAccounts)
accountRouter.get('/summary', getAccountSummary)
accountRouter.get('/:id', getAccount)

export default accountRouter
