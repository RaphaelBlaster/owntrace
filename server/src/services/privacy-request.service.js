import mongoose from 'mongoose'
import PrivacyRequest, {
  privacyRequestStatuses,
  privacyRequestTypes,
} from '../models/privacy-request.model.js'
import AppError from '../utils/app-error.js'
import { paginationFor, parseBoundedPagination } from '../utils/pagination.js'

const supportedTransitions = {
  CANCELLED: ['DRAFT'],
  COMPLETED: [],
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['DRAFT', 'SENT', 'CANCELLED'],
  SENT: ['COMPLETED', 'CANCELLED'],
}

function normalizeText(value, fieldName, maximum, { required = false } = {}) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new AppError(`${fieldName} is required.`, 400, 'INVALID_PRIVACY_REQUEST')
  }
  const normalized = value.trim()
  if (normalized.length > maximum) {
    throw new AppError(
      `${fieldName} must be ${maximum} characters or fewer.`,
      400,
      'INVALID_PRIVACY_REQUEST',
    )
  }
  return normalized
}

function normalizeEnum(value, supported, fieldName) {
  const normalized = typeof value === 'string' ? value.toUpperCase() : ''
  if (!supported.includes(normalized)) {
    throw new AppError(`Choose a supported ${fieldName}.`, 400, 'INVALID_PRIVACY_REQUEST')
  }
  return normalized
}

async function createPrivacyRequest(userId, input = {}) {
  const request = await PrivacyRequest.create({
    notes: normalizeText(input.notes, 'Notes', 500),
    requestType: normalizeEnum(input.requestType, privacyRequestTypes, 'request type'),
    serviceName: normalizeText(input.serviceName, 'Service name', 120, { required: true }),
    userId,
  })
  return request
}

async function listPrivacyRequests(userId, rawQuery = {}) {
  const { limit, page } = parseBoundedPagination(rawQuery, { allowedKeys: ['status'] })
  const status = rawQuery.status === undefined
    ? null
    : normalizeEnum(rawQuery.status, privacyRequestStatuses, 'request status')
  const filter = { userId }
  if (status) filter.status = status

  const [requests, total] = await Promise.all([
    PrivacyRequest.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PrivacyRequest.countDocuments(filter),
  ])

  return {
    pagination: paginationFor({ limit, page, total }),
    requests: requests.map((request) => request.toJSON()),
  }
}

async function updatePrivacyRequestStatus(userId, requestId, nextStatus) {
  if (!mongoose.isObjectIdOrHexString(requestId)) {
    throw new AppError('Privacy request not found.', 404, 'PRIVACY_REQUEST_NOT_FOUND')
  }
  const status = normalizeEnum(nextStatus, privacyRequestStatuses, 'request status')
  const request = await PrivacyRequest.findOne({ _id: requestId, userId })
  if (!request) {
    throw new AppError('Privacy request not found.', 404, 'PRIVACY_REQUEST_NOT_FOUND')
  }
  if (status !== request.status && !supportedTransitions[request.status].includes(status)) {
    throw new AppError(
      'This privacy request status change is not supported.',
      409,
      'PRIVACY_REQUEST_TRANSITION_NOT_ALLOWED',
    )
  }

  if (status !== request.status) {
    request.status = status
    request.statusUpdatedAt = new Date()
    request.completedAt = status === 'COMPLETED' ? request.statusUpdatedAt : null
    await request.save()
  }
  return request
}

export { createPrivacyRequest, listPrivacyRequests, updatePrivacyRequestStatus }
