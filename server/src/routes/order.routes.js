import { Router } from 'express'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'
import AppError from '../utils/app-error.js'
import OrderPreference from '../models/order-preference.model.js'
import OrderScan from '../models/order-scan.model.js'
import { orderStatuses } from '../models/order-event.model.js'
import { orderPolicy, publicScan, startOrderScan } from '../services/order-scan.service.js'
import { cancelOrderWork } from '../services/order-control.service.js'
import { orderProviderConfigured } from '../services/order-processing.service.js'
import { listOrderCards, orderDetails } from '../services/order-query.service.js'
const router = Router()
router.use(requireAuth)
router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
const invalid = () => { throw new AppError('Invalid order request.', 400, 'ORDER_INVALID_INPUT') }
const exact = (input, keys) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) invalid() }
router.get('/status', async (request, response) => {
  const userId = request.auth.userId
  const [preference, scans] = await Promise.all([OrderPreference.findOne({ userId }), OrderScan.find({ userId })])
  response.json({ configured: orderProviderConfigured(), consent: { enabled: Boolean(preference?.enabled && preference.version === 1), daily: Boolean(preference?.daily), version: 1 }, policy: orderPolicy, scans: scans.map(publicScan) })
})
const provider = Joi.string().valid('gmail', 'outlook')
const consentBody = Joi.object({ enabled: Joi.boolean().strict().required(), daily: Joi.boolean().strict().required(), version: Joi.number().strict().required() })
router.put('/consent', validate(consentBody), async (request, response) => {
  exact(request.body, ['enabled', 'daily', 'version'])
  const { enabled, daily, version } = request.body
  if (typeof enabled !== 'boolean' || typeof daily !== 'boolean' || version !== 1 || (!enabled && daily)) invalid()
  const previous = await OrderPreference.findOne({ userId: request.auth.userId })
  const preference = await OrderPreference.findOneAndUpdate({ userId: request.auth.userId }, { $set: {
    enabled, daily, version, acceptedAt: enabled ? previous?.acceptedAt || new Date() : null,
    nextDailyAt: enabled && daily ? previous?.daily && previous.nextDailyAt || new Date(Date.now() + 86400000) : null,
  } }, { upsert: true, returnDocument: 'after', runValidators: true })
  if (!enabled) await cancelOrderWork(request.auth.userId)
  else if (previous?.daily && !daily) {
    const scans = await OrderScan.find({ userId: request.auth.userId, mode: 'daily', status: { $in: ['QUEUED','RUNNING','PAUSED'] } }).select('provider')
    for (const scan of scans) await cancelOrderWork(request.auth.userId, scan.provider)
  }
  response.json({ consent: { enabled: preference.enabled, daily: preference.daily, version: preference.version } })
})
const scanBody = Joi.object({ provider: provider.required(), mode: Joi.string().valid('initial', 'on_demand').required(), days: Joi.number().strict().integer(), merchantDomain: Joi.string().max(253) })
router.post('/scans', validate(scanBody), async (request, response) => {
  exact(request.body, ['provider', 'mode', 'days', 'merchantDomain'])
  if (!['gmail', 'outlook'].includes(request.body.provider) || !['initial', 'on_demand'].includes(request.body.mode)) invalid()
  if (request.body.mode !== 'on_demand' && (request.body.days !== undefined || request.body.merchantDomain !== undefined)) invalid()
  const scan = await startOrderScan(request.auth.userId, request.body.provider, request.body.mode, { days: request.body.days, merchantDomain: request.body.merchantDomain })
  response.status(202).json({ scan: publicScan(scan) })
})
router.delete('/scans/:provider', validate(Joi.object({ provider: provider.required() }), 'params'), async (request, response) => {
  if (!['gmail','outlook'].includes(request.params.provider)) invalid()
  await cancelOrderWork(request.auth.userId, request.params.provider)
  response.status(204).end()
})
const listQuery = Joi.object({ page: Joi.string().pattern(/^\d{1,6}$/), limit: Joi.string().pattern(/^\d{1,3}$/), provider, status: Joi.string().max(40), search: Joi.string().allow('').max(200) })
router.get('/', validate(listQuery, 'query'), async (request, response) => {
  exact(request.query, ['page','limit','provider','status','search'])
  const number = (key, fallback, maximum) => { const raw = request.query[key]; if (raw === undefined) return fallback; if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum) invalid(); return Number(raw) }
  if (request.query.provider && !['gmail','outlook'].includes(request.query.provider) || request.query.status && !orderStatuses.includes(request.query.status)) invalid()
  response.json(await listOrderCards(request.auth.userId, { page: number('page', 1, 10000), limit: number('limit', 12, 48), provider: request.query.provider, status: request.query.status, search: typeof request.query.search === 'string' ? request.query.search : undefined }))
})
router.get('/:id', async (request, response) => response.json(await orderDetails(request.auth.userId, request.params.id)))
export default router
