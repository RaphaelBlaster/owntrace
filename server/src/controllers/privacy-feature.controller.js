import { listNotifications as listNotificationsForUser } from '../services/notification.service.js'
import {
  checkBreachesForUser,
} from '../services/breach-report.service.js'
import {
  getPrivacyHealth as getPrivacyHealthForUser,
  listBreachInsights as listBreachInsightsForUser,
  listExposureInsights as listExposureInsightsForUser,
  listSubscriptions as listSubscriptionsForUser,
} from '../services/privacy-insight.service.js'
import {
  createPrivacyRequest as createPrivacyRequestForUser,
  listPrivacyRequests as listPrivacyRequestsForUser,
  updatePrivacyRequestStatus as updatePrivacyRequestStatusForUser,
} from '../services/privacy-request.service.js'

async function listSubscriptions(request, response) {
  const result = await listSubscriptionsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

async function listBreachInsights(request, response) {
  const result = await listBreachInsightsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

async function checkBreaches(request, response) {
  const result = await checkBreachesForUser(request.auth.userId, request.body)
  response.status(200).json({ success: true, ...result })
}

async function listExposureInsights(request, response) {
  const result = await listExposureInsightsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

async function getPrivacyHealth(request, response) {
  const health = await getPrivacyHealthForUser(request.auth.userId)
  response.status(200).json({ health, success: true })
}

async function createPrivacyRequest(request, response) {
  const privacyRequest = await createPrivacyRequestForUser(request.auth.userId, request.body)
  response.status(201).json({ privacyRequest: privacyRequest.toJSON(), success: true })
}

async function listPrivacyRequests(request, response) {
  const result = await listPrivacyRequestsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

async function updatePrivacyRequestStatus(request, response) {
  const privacyRequest = await updatePrivacyRequestStatusForUser(
    request.auth.userId,
    request.params.id,
    request.body?.status,
  )
  response.status(200).json({ privacyRequest: privacyRequest.toJSON(), success: true })
}

async function listNotifications(request, response) {
  const result = await listNotificationsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

export {
  checkBreaches,
  createPrivacyRequest,
  getPrivacyHealth,
  listBreachInsights,
  listExposureInsights,
  listNotifications,
  listPrivacyRequests,
  listSubscriptions,
  updatePrivacyRequestStatus,
}
