import { Router } from 'express'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'
import AppError from '../utils/app-error.js'
import { MailAnalysis } from '../models/mail-insight.model.js'
import { topKState, startTopKScan, stopTopK, queueMailEnrichment, analysisMessageLimit } from '../services/top-k.service.js'
import { queryMailInsights } from '../services/mail-insight-query.service.js'
import { mailCategories } from '../models/mail-insight.model.js'

const router = Router()
router.use(requireAuth)
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
const invalid = () => { throw new AppError('Invalid email-analysis request.', 400, 'MAIL_INVALID_INPUT') }
const exact = (input, keys) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) invalid() }
const provider = Joi.string().valid('gmail', 'outlook')
const kQuery = Joi.object({ k: Joi.string().pattern(/^\d{1,2}$/) })
router.get('/', validate(kQuery, 'query'), async (req, res) => {
  exact(req.query, ['k'])
  const k = req.query.k === undefined ? 3 : Number(req.query.k)
  if (!Number.isInteger(k) || k < 1 || k > 8) invalid()
  res.json(await topKState(req.auth.userId, k))
})
const groupsQuery = Joi.object({ category: Joi.string().allow('').max(60), status: Joi.string().allow('').max(60), search: Joi.string().allow('').max(200), kind: Joi.string().max(40), page: Joi.string().pattern(/^\d{1,6}$/), limit: Joi.string().pattern(/^\d{1,3}$/) })
router.get('/groups', validate(groupsQuery, 'query'), async (req, res) => {
  exact(req.query, ['category', 'status', 'search', 'page', 'limit', 'kind'])
  const { category = 'jobs', status = '', search = '', kind = 'all' } = req.query
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 6)
  if ((category !== '' && !mailCategories.includes(category)) || typeof status !== 'string' || status && !/^[a-z_]{1,60}$/.test(status) || typeof search !== 'string' || search.length > 120 || !['all', 'applications', 'opportunities'].includes(kind) || !Number.isInteger(page) || page < 1 || page > 10000 || ![6, 12, 24].includes(limit)) invalid()
  res.json(await queryMailInsights(req.auth.userId, { category, status, search, kind, page, limit }))
})
const consentBody = Joi.object({ enabled: Joi.boolean().strict().required(), version: Joi.number().strict().required() })
router.put('/consent', validate(consentBody), async (req, res) => {
  exact(req.body, ['enabled', 'version'])
  if (typeof req.body.enabled !== 'boolean' || req.body.version !== 1) invalid()
  const { enabled } = req.body
  if (!enabled) {
    await stopTopK(req.auth.userId, undefined, { disable: true })
    return res.json({ enabled, version: 1 })
  }
  await MailAnalysis.findOneAndUpdate({ userId: req.auth.userId }, { $set: { enabled, version: 1, acceptedAt: enabled ? new Date() : null } }, { upsert: true, runValidators: true })
  res.json({ enabled, version: 1 })
})
const scanBody = Joi.object({ provider: provider.required() })
router.post('/scans', validate(scanBody), async (req, res) => {
  exact(req.body, ['provider'])
  await startTopKScan(req.auth.userId, req.body.provider)
  res.status(202).json({ accepted: true, limit: analysisMessageLimit() })
})
router.post('/enrichment', validate(Joi.object({})), async (req, res) => {
  exact(req.body || {}, [])
  await queueMailEnrichment(req.auth.userId)
  res.status(202).json({ accepted: true, limit: analysisMessageLimit() })
})
router.delete('/scans/:provider', validate(Joi.object({ provider: provider.required() }), 'params'), async (req, res) => {
  if (!['gmail', 'outlook'].includes(req.params.provider)) invalid()
  await stopTopK(req.auth.userId, req.params.provider)
  res.status(204).end()
})
export default router
