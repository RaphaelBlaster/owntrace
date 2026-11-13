import PrivacyRequest from '../models/privacy-request.model.js'
import BreachReport from '../models/breach-report.model.js'
import { listAccountActions } from './account-action.service.js'
import { paginationFor, parseBoundedPagination } from '../utils/pagination.js'

async function listNotifications(userId, rawQuery = {}) {
  const { limit, page } = parseBoundedPagination(rawQuery, {
    defaultLimit: 20,
    maximumLimit: 50,
  })
  const [actionResult, privacyRequests, breachReport] = await Promise.all([
    listAccountActions(userId, { limit: 100, page: 1, status: 'OPEN' }),
    PrivacyRequest.find({ status: { $in: ['READY', 'SENT'] }, userId })
      .sort({ statusUpdatedAt: -1, _id: 1 })
      .limit(100)
      .lean(),
    BreachReport.findOne({ userId }).select('breaches lastCheckedAt').lean(),
  ])

  const actionNotifications = actionResult.actions.map((action) => ({
    createdAt: action.createdAt,
    id: `action:${action.id}`,
    kind: 'ACCOUNT_ACTION',
    message: action.reason,
    priority: action.priority,
    target: '/privacy-inbox',
    title: action.title,
  }))
  const requestNotifications = privacyRequests.map((request) => ({
    createdAt: request.statusUpdatedAt,
    id: `request:${request._id}`,
    kind: 'PRIVACY_REQUEST',
    message: request.status === 'READY'
      ? 'This draft is ready for you to send through the service’s official channel.'
      : 'This request is awaiting an outcome you record manually.',
    priority: 'MEDIUM',
    target: '/privacy-requests',
    title: `${request.serviceName} ${request.requestType.toLowerCase()} request`,
  }))
  const breachNotifications = breachReport?.lastCheckedAt
    ? breachReport.breaches.map((breach, index) => ({
      createdAt: breachReport.lastCheckedAt,
      id: `breach:${breachReport._id}:${index}`,
      kind: 'VERIFIED_BREACH',
      message: 'Review this known breach and update credentials through the affected service.',
      priority: 'HIGH',
      target: '/breaches',
      title: `Known breach: ${breach.name}`,
    }))
    : []
  const allNotifications = [...actionNotifications, ...requestNotifications, ...breachNotifications]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
  const total = allNotifications.length
  const start = (page - 1) * limit

  return {
    notifications: allNotifications.slice(start, start + limit),
    pagination: paginationFor({ limit, page, total }),
  }
}

export { listNotifications }
