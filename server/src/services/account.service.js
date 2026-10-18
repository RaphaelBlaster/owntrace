import mongoose from 'mongoose'
import AccountEvidence from '../models/account-evidence.model.js'
import Account, { confidenceLevels, dormantStatuses } from '../models/account.model.js'
import AppError from '../utils/app-error.js'
import { refreshDormancyForUser } from './account-dormancy.service.js'

const sortFields = {
  confidence: 'confidenceScore',
  firstSeen: 'firstSeenAt',
  lastSeen: 'lastSeenAt',
  serviceName: 'serviceName',
}

function parsePositiveInteger(value, fallback, maximum, fieldName) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new AppError(`${fieldName} must be a positive integer.`, 400, 'INVALID_ACCOUNT_QUERY')
  }

  const parsed = Number(value)
  if (parsed < 1 || parsed > maximum) {
    throw new AppError(
      `${fieldName} must be between 1 and ${maximum}.`,
      400,
      'INVALID_ACCOUNT_QUERY',
    )
  }

  return parsed
}

function optionalEnum(value, supported, fieldName) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !supported.includes(value.toUpperCase())) {
    throw new AppError(`Choose a supported ${fieldName}.`, 400, 'INVALID_ACCOUNT_QUERY')
  }
  return value.toUpperCase()
}

function parseAccountQuery(query = {}) {
  const page = parsePositiveInteger(query.page, 1, 10_000, 'page')
  const limit = parsePositiveInteger(query.limit, 24, 100, 'limit')
  const confidence = optionalEnum(query.confidence, confidenceLevels, 'confidence level')
  const dormant = optionalEnum(query.dormant, dormantStatuses, 'dormant status')
  const sort = query.sort === undefined ? 'lastSeen' : query.sort
  const direction = query.direction === undefined ? 'desc' : query.direction
  const search = typeof query.search === 'string' ? query.search.trim() : ''

  if (!Object.hasOwn(sortFields, sort)) {
    throw new AppError('Choose a supported account sort.', 400, 'INVALID_ACCOUNT_QUERY')
  }
  if (!['asc', 'desc'].includes(direction)) {
    throw new AppError('Account sort direction must be asc or desc.', 400, 'INVALID_ACCOUNT_QUERY')
  }
  if (search.length > 80) {
    throw new AppError('Account search must be 80 characters or fewer.', 400, 'INVALID_ACCOUNT_QUERY')
  }

  return { confidence, direction, dormant, limit, page, search, sort }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listAccounts(userId, rawQuery) {
  const query = parseAccountQuery(rawQuery)
  await refreshDormancyForUser(Account, userId)

  const filter = { userId }
  if (query.confidence) filter.confidenceLevel = query.confidence
  if (query.dormant) filter.dormantStatus = query.dormant
  if (query.search) {
    const searchPattern = new RegExp(escapeRegex(query.search), 'i')
    filter.$or = [{ serviceName: searchPattern }, { primaryDomain: searchPattern }]
  }

  const sortDirection = query.direction === 'asc' ? 1 : -1
  const sort = { [sortFields[query.sort]]: sortDirection, _id: 1 }
  const [accounts, total] = await Promise.all([
    Account.find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    Account.countDocuments(filter),
  ])

  return {
    accounts: accounts.map((account) => account.toJSON()),
    pagination: {
      limit: query.limit,
      page: query.page,
      pages: Math.ceil(total / query.limit),
      total,
    },
  }
}

async function getAccount(userId, accountId) {
  if (!mongoose.isObjectIdOrHexString(accountId)) {
    throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND')
  }

  await refreshDormancyForUser(Account, userId)
  const account = await Account.findOne({ _id: accountId, userId })
  if (!account) throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND')

  const [evidence, evidenceTotal] = await Promise.all([
    AccountEvidence.find({ accountId: account._id, userId })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(100),
    AccountEvidence.countDocuments({ accountId: account._id, userId }),
  ])

  return {
    account: account.toJSON(),
    evidence: evidence.map((item) => item.toJSON()),
    evidenceTotal,
    evidenceTruncated: evidenceTotal > evidence.length,
  }
}

async function getAccountSummary(userId, now = new Date()) {
  await refreshDormancyForUser(Account, userId, now)
  const recentlySeenThreshold = new Date(now)
  recentlySeenThreshold.setUTCDate(recentlySeenThreshold.getUTCDate() - 90)

  const [total, dormant, possiblyDormant, highConfidence, recentlySeen] = await Promise.all([
    Account.countDocuments({ userId }),
    Account.countDocuments({ dormantStatus: 'DORMANT', userId }),
    Account.countDocuments({ dormantStatus: 'POSSIBLY_DORMANT', userId }),
    Account.countDocuments({ confidenceScore: { $gte: 70 }, userId }),
    Account.countDocuments({ lastSeenAt: { $gte: recentlySeenThreshold }, userId }),
  ])

  return { dormant, highConfidence, possiblyDormant, recentlySeen, total }
}

export { getAccount, getAccountSummary, listAccounts, parseAccountQuery }
