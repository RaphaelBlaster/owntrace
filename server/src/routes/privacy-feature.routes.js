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
import requireAuth from '../middleware/auth.middleware.js'

const privacyFeatureRouter = Router()

privacyFeatureRouter.use(requireAuth)
privacyFeatureRouter.get('/subscriptions', listSubscriptions)
privacyFeatureRouter.get('/breaches', listBreachInsights)
privacyFeatureRouter.post('/breaches/check', checkBreaches)
privacyFeatureRouter.get('/exposures', listExposureInsights)
privacyFeatureRouter.get('/privacy-health', getPrivacyHealth)
privacyFeatureRouter.get('/notifications', listNotifications)
privacyFeatureRouter.get('/privacy-requests', listPrivacyRequests)
privacyFeatureRouter.post('/privacy-requests', createPrivacyRequest)
privacyFeatureRouter.patch('/privacy-requests/:id', updatePrivacyRequestStatus)

export default privacyFeatureRouter
