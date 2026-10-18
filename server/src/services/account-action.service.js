import mongoose from 'mongoose'
import AccountAction, { accountActionStatuses } from '../models/account-action.model.js'
import Account from '../models/account.model.js'
import AppError from '../utils/app-error.js'
import { refreshDormancyForUser } from './account-dormancy.service.js'

const securityClasses = new Set(['LOGIN_ALERT', 'PASSWORD_RESET', 'SECURITY_ALERT'])
const signInClasses = new Set(['LOGIN_ALERT', 'OTP', 'PASSWORD_RESET'])
const priorityRanks = { HIGH: 3, LOW: 1, MEDIUM: 2 }
const activeSyncs = new Map()

const supportedTransitions = {
  COMPLETED: ['OPEN', 'IN_PROGRESS'],
  DISMISSED: ['OPEN', 'IN_PROGRESS'],
  IN_PROGRESS: ['OPEN', 'COMPLETED', 'DISMISSED'],
  OPEN: ['IN_PROGRESS', 'COMPLETED', 'DISMISSED'],
}

function buildRecommendations(account) {
  const recommendations = [{
    description: 'Confirm that the service and evidence match an account you recognize.',
    priority: account.confidenceScore < 70 ? 'MEDIUM' : 'LOW',
    reason: account.confidenceScore < 70
      ? 'OwnTrace has limited evidence for this account relationship.'
      : 'Periodic review helps keep your discovered account inventory accurate.',
    title: 'Review this account',
    type: 'REVIEW_ACCOUNT',
  }]
  const evidenceClasses = new Set(account.evidenceClasses)

  if ([...securityClasses].some((evidenceClass) => evidenceClasses.has(evidenceClass))) {
    recommendations.push({
      description: 'Visit the service directly to review recent access and strengthen sign-in security if needed.',
      priority: evidenceClasses.has('SECURITY_ALERT') ? 'HIGH' : 'MEDIUM',
      reason: 'OwnTrace found account-security or login-related evidence for this service.',
      title: 'Review account security',
      type: 'SECURE_ACCOUNT',
    })
  }

  if ([...signInClasses].some((evidenceClass) => evidenceClasses.has(evidenceClass))) {
    recommendations.push({
      description: 'Check the service directly to confirm your recovery details and current sign-in method.',
      priority: 'MEDIUM',
      reason: 'Login, recovery, or one-time-code evidence suggests this account has sign-in activity.',
      title: 'Review sign-in method',
      type: 'REVIEW_SIGN_IN',
    })
  }

  if (['DORMANT', 'POSSIBLY_DORMANT'].includes(account.dormantStatus)) {
    recommendations.push({
      description: 'Decide whether you still need this service. If not, follow the service’s own account-closure process.',
      priority: account.dormantStatus === 'DORMANT' ? 'MEDIUM' : 'LOW',
      reason: account.dormantReason,
      title: 'Consider closing this account',
      type: 'CONSIDER_DELETION',
    })
  }

  return recommendations
}

async function performAccountActionSync(userId, now) {
  await refreshDormancyForUser(Account, userId, now)
  const accounts = await Account.find({ userId }).lean()
  const recommendations = accounts.flatMap((account) =>
    buildRecommendations(account).map((recommendation) => ({ account, recommendation })))

  if (recommendations.length) {
    await AccountAction.bulkWrite(recommendations.map(({ account, recommendation }) => ({
      updateOne: {
        filter: { accountId: account._id, type: recommendation.type, userId },
        update: {
          $set: {
            ...recommendation,
            lastEvaluatedAt: now,
            priorityRank: priorityRanks[recommendation.priority],
          },
          $setOnInsert: { accountId: account._id, status: 'OPEN', statusUpdatedAt: now, userId },
        },
        upsert: true,
      },
    })), { ordered: false })
  }

  const validKeys = new Set(recommendations.map(({ account, recommendation }) =>
    `${account._id}:${recommendation.type}`))
  const openActions = await AccountAction.find({ status: 'OPEN', userId }).select('accountId type').lean()
  const staleIds = openActions
    .filter((action) => !validKeys.has(`${action.accountId}:${action.type}`))
    .map((action) => action._id)

  if (staleIds.length) await AccountAction.deleteMany({ _id: { $in: staleIds }, status: 'OPEN', userId })
}

async function syncAccountActionsForUser(userId, now = new Date()) {
  const key = userId.toString()
  if (activeSyncs.has(key)) return activeSyncs.get(key)

  const syncPromise = performAccountActionSync(userId, now)
  activeSyncs.set(key, syncPromise)

  try {
    return await syncPromise
  } finally {
    if (activeSyncs.get(key) === syncPromise) activeSyncs.delete(key)
  }
}

function parseListQuery(query = {}) {
  const status = typeof query.status === 'string' ? query.status.toUpperCase() : 'OPEN'
  if (!accountActionStatuses.includes(status)) {
    throw new AppError('Choose a supported action status.', 400, 'INVALID_ACCOUNT_ACTION_QUERY')
  }

  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 24 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new AppError('Action page must be a positive integer.', 400, 'INVALID_ACCOUNT_ACTION_QUERY')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('Action limit must be between 1 and 100.', 400, 'INVALID_ACCOUNT_ACTION_QUERY')
  }
  if (query.accountId !== undefined && !mongoose.isObjectIdOrHexString(query.accountId)) {
    throw new AppError('Choose a valid account.', 400, 'INVALID_ACCOUNT_ACTION_QUERY')
  }

  return { accountId: query.accountId || null, limit, page, status }
}

async function listAccountActions(userId, rawQuery) {
  await syncAccountActionsForUser(userId)
  const query = parseListQuery(rawQuery)
  const filter = { status: query.status, userId }
  if (query.accountId) filter.accountId = query.accountId

  const [actions, total] = await Promise.all([
    AccountAction.find(filter)
      .sort({ priorityRank: -1, createdAt: -1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    AccountAction.countDocuments(filter),
  ])
  const accountIds = [...new Set(actions.map((action) => action.accountId.toString()))]
  const accounts = await Account.find({ _id: { $in: accountIds }, userId })
    .select('confidenceLevel dormantStatus primaryDomain serviceName')
    .lean()
  const accountsById = new Map(accounts.map((account) => [account._id.toString(), account]))

  return {
    actions: actions.map((action) => ({
      ...action.toJSON(),
      account: accountsById.has(action.accountId.toString())
        ? {
          confidenceLevel: accountsById.get(action.accountId.toString()).confidenceLevel,
          dormantStatus: accountsById.get(action.accountId.toString()).dormantStatus,
          primaryDomain: accountsById.get(action.accountId.toString()).primaryDomain,
          serviceName: accountsById.get(action.accountId.toString()).serviceName,
        }
        : null,
    })),
    pagination: {
      limit: query.limit,
      page: query.page,
      pages: Math.ceil(total / query.limit),
      total,
    },
  }
}

async function getAccountActionSummary(userId) {
  await syncAccountActionsForUser(userId)
  const [open, inProgress, completed, dismissed, highPriority] = await Promise.all([
    AccountAction.countDocuments({ status: 'OPEN', userId }),
    AccountAction.countDocuments({ status: 'IN_PROGRESS', userId }),
    AccountAction.countDocuments({ status: 'COMPLETED', userId }),
    AccountAction.countDocuments({ status: 'DISMISSED', userId }),
    AccountAction.countDocuments({ priority: 'HIGH', status: { $in: ['OPEN', 'IN_PROGRESS'] }, userId }),
  ])
  return { completed, dismissed, highPriority, inProgress, open }
}

async function updateAccountActionStatus(userId, actionId, nextStatus) {
  if (!mongoose.isObjectIdOrHexString(actionId)) {
    throw new AppError('Account action not found.', 404, 'ACCOUNT_ACTION_NOT_FOUND')
  }
  const status = typeof nextStatus === 'string' ? nextStatus.toUpperCase() : ''
  if (!accountActionStatuses.includes(status)) {
    throw new AppError('Choose a supported action status.', 400, 'INVALID_ACCOUNT_ACTION_STATUS')
  }

  const action = await AccountAction.findOne({ _id: actionId, userId })
  if (!action) throw new AppError('Account action not found.', 404, 'ACCOUNT_ACTION_NOT_FOUND')
  if (status !== action.status && !supportedTransitions[action.status].includes(status)) {
    throw new AppError('This account action status change is not supported.', 409, 'ACCOUNT_ACTION_TRANSITION_NOT_ALLOWED')
  }

  if (status !== action.status) {
    action.status = status
    action.statusUpdatedAt = new Date()
    action.completedAt = status === 'COMPLETED' ? action.statusUpdatedAt : null
    await action.save()
  }

  return action
}

export {
  buildRecommendations,
  getAccountActionSummary,
  listAccountActions,
  syncAccountActionsForUser,
  updateAccountActionStatus,
}
