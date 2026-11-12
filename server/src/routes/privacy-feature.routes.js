import { Router } from 'express'
import {
  checkBreaches,
  createPrivacyRequest,
  getPrivacyHealth,
  listBreachInsights,
  listExposureInsights,
  listNotifications,
  listPrivacyRequests,
  listSubscriptions,
  updatePrivacyRequestStatus,
} from '../controllers/privacy-feature.controller.js'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'

const privacyFeatureRouter = Router()

privacyFeatureRouter.use(requireAuth)
const number = Joi.string().pattern(/^\d{1,6}$/)
const pageQuery = Joi.object({ page: number, limit: number })
const subscriptionQuery = pageQuery.keys({ focusId: Joi.string().max(64), search: Joi.string().allow('').max(200) })
const breachQuery = pageQuery.keys({ breachPage: number, breachLimit: number, signalPage: number, signalLimit: number })
const breachCheckBody = Joi.object({ consent: Joi.boolean().strict() }) // missing/false keeps BREACH_CHECK_CONSENT_REQUIRED
const requestListQuery = pageQuery.keys({ status: Joi.string().max(40) })
const requestBody = Joi.object({ requestType: Joi.string().max(40).required(), serviceName: Joi.string().max(200).required(), notes: Joi.string().allow('').max(1000) })
const requestStatusBody = Joi.object({ status: Joi.string().max(40).required() })
privacyFeatureRouter.get('/subscriptions', validate(subscriptionQuery, 'query'), listSubscriptions)
privacyFeatureRouter.get('/breaches', validate(breachQuery, 'query'), listBreachInsights)
privacyFeatureRouter.post('/breaches/check', validate(breachCheckBody), checkBreaches)
privacyFeatureRouter.get('/exposures', validate(pageQuery, 'query'), listExposureInsights)
privacyFeatureRouter.get('/privacy-health', getPrivacyHealth)
privacyFeatureRouter.get('/notifications', validate(pageQuery, 'query'), listNotifications)
privacyFeatureRouter.get('/privacy-requests', validate(requestListQuery, 'query'), listPrivacyRequests)
privacyFeatureRouter.post('/privacy-requests', validate(requestBody), createPrivacyRequest)
privacyFeatureRouter.patch('/privacy-requests/:id', validate(requestStatusBody), updatePrivacyRequestStatus)

export default privacyFeatureRouter
