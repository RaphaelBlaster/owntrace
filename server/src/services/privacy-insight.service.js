import Account from '../models/account.model.js'
import mongoose from 'mongoose'
import BreachReport from '../models/breach-report.model.js'
import Subscription from '../models/subscription.model.js'
import MicrosoftSubscription from '../models/microsoft-subscription.model.js'
import { getAccountActionSummary } from './account-action.service.js'
import { getAccountSummary } from './account.service.js'
import { getBreachReportForUser, serializeBreachReport } from './breach-report.service.js'
import AppError from '../utils/app-error.js'
import { paginationFor, parseBoundedPagination } from '../utils/pagination.js'

const securityClasses = ['SECURITY_ALERT', 'PASSWORD_RESET']

function safeAccountProjection(account) {
  return {
    accountId: account._id.toString(),
    confidenceLevel: account.confidenceLevel,
    dormantStatus: account.dormantStatus,
    firstSeenAt: account.firstSeenAt,
    lastSeenAt: account.lastSeenAt,
    primaryDomain: account.primaryDomain,
    serviceName: account.serviceName,
  }
}

async function findAccountSignals(userId, rawQuery, evidenceClasses) {
  const { limit, page } = parseBoundedPagination(rawQuery)
  return findAccountSignalsForPagination(userId, { limit, page }, evidenceClasses)
}

async function findAccountSignalsForPagination(userId, { limit, page }, evidenceClasses) {
  const filter = { evidenceClasses: { $in: evidenceClasses }, userId }
  const [accounts, total] = await Promise.all([
    Account.find(filter)
      .select('confidenceLevel dormantStatus evidenceClasses firstSeenAt lastSeenAt primaryDomain serviceName')
      .sort({ lastSeenAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Account.countDocuments(filter),
  ])
  return { accounts, pagination: paginationFor({ limit, page, total }) }
}

function parseBreachPagination(rawQuery = {}) {
  const supportedKeys = new Set([
    'breachLimit',
    'breachPage',
    'limit',
    'page',
    'signalLimit',
    'signalPage',
  ])
  if (Object.keys(rawQuery).some((key) => !supportedKeys.has(key))) {
    throw new AppError('Choose supported query controls.', 400, 'INVALID_PAGINATION')
  }

  const legacyLimit = rawQuery.limit
  const legacyPage = rawQuery.page
  return {
    breach: parseBoundedPagination({
      limit: rawQuery.breachLimit ?? legacyLimit,
      page: rawQuery.breachPage ?? legacyPage,
    }),
    signal: parseBoundedPagination({
      limit: rawQuery.signalLimit ?? legacyLimit,
      page: rawQuery.signalPage ?? legacyPage,
    }),
  }
}

async function listSubscriptions(userId, rawQuery = {}) {
  const { limit, page } = parseBoundedPagination(rawQuery, { allowedKeys: ['focusId'] })
  const focusId = rawQuery.focusId
  if (focusId && !mongoose.isObjectIdOrHexString(focusId)) throw new AppError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND')
  const scopedUserId = new mongoose.Types.ObjectId(userId)
  const safeSubscriptionFields = {
    amountMinor: 1,
    basis: 1,
    billingCycle: 1,
    confidenceLevel: 1,
    confidenceScore: 1,
    currency: 1,
    evidenceCount: 1,
    firstSeenAt: 1,
    lastPaymentAt: 1,
    lastSeenAt: 1,
    nextRenewalAt: 1,
    primaryDomain: 1,
    renewalIsEstimated: 1,
    serviceKey: 1,
    serviceName: 1,
    source: { $ifNull: ['$source', 'GMAIL_METADATA'] },
  }
  const [result] = await Subscription.aggregate([
    { $match: { userId: scopedUserId } },
    { $project: safeSubscriptionFields },
    {
      $unionWith: {
        coll: MicrosoftSubscription.collection.name,
        pipeline: [
          { $match: { userId: scopedUserId } },
          { $project: safeSubscriptionFields },
        ],
      },
    },
    { $sort: { lastSeenAt: -1, _id: 1 } },
    {
      $group: {
        _id: '$serviceKey',
        latest: { $first: '$$ROOT' },
        basisSets: { $push: '$basis' },
        evidenceCount: { $sum: '$evidenceCount' },
        firstSeenAt: { $min: '$firstSeenAt' },
        lastPaymentAt: { $max: '$lastPaymentAt' },
        lastSeenAt: { $max: '$lastSeenAt' },
        records: { $push: '$$ROOT' },
        sources: { $addToSet: '$source' },
      },
    },
    {
      $set: {
        'latest.basis': {
          $reduce: {
            input: '$basisSets',
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
        'latest.evidenceCount': '$evidenceCount',
        'latest.firstSeenAt': '$firstSeenAt',
        'latest.lastPaymentAt': '$lastPaymentAt',
        'latest.lastSeenAt': '$lastSeenAt',
        'latest.source': {
          $cond: [{ $gt: [{ $size: '$sources' }, 1] }, 'MULTI_PROVIDER_METADATA', { $arrayElemAt: ['$sources', 0] }],
        },
        amountRecord: {
          $arrayElemAt: [{ $filter: { input: '$records', as: 'record', cond: { $gt: ['$$record.amountMinor', 0] } } }, 0],
        },
        cycleRecord: {
          $arrayElemAt: [{ $filter: { input: '$records', as: 'record', cond: { $and: [{ $ne: ['$$record.billingCycle', null] }, { $ne: ['$$record.billingCycle', 'UNKNOWN'] }] } } }, 0],
        },
      },
    },
    {
      $set: {
        'latest.amountMinor': { $ifNull: ['$amountRecord.amountMinor', null] },
        'latest.currency': { $ifNull: ['$amountRecord.currency', null] },
        'latest.billingCycle': { $ifNull: ['$cycleRecord.billingCycle', 'UNKNOWN'] },
        'latest.nextRenewalAt': { $ifNull: ['$cycleRecord.nextRenewalAt', null] },
        'latest.renewalIsEstimated': { $ifNull: ['$cycleRecord.renewalIsEstimated', false] },
      },
    },
    {
      $set: {
        'latest.confidenceScore': {
          $min: [95, {
            $add: [
              { $cond: [{ $in: ['PAYMENT', '$latest.basis'] }, 35, 0] },
              { $cond: [{ $in: ['SUBSCRIPTION', '$latest.basis'] }, 30, 0] },
              { $min: [20, { $multiply: [{ $max: [0, { $subtract: ['$evidenceCount', 1] }] }, 10] }] },
              { $cond: [{ $gt: ['$latest.amountMinor', 0] }, 10, 0] },
              { $cond: [{ $and: [{ $ne: ['$latest.billingCycle', null] }, { $ne: ['$latest.billingCycle', 'UNKNOWN'] }] }, 10, 0] },
              { $cond: [{ $eq: [{ $size: '$latest.basis' }, 2] }, 10, 0] },
            ],
          }],
        },
      },
    },
    {
      $set: {
        'latest.confidenceLevel': { $cond: [{ $gte: ['$latest.confidenceScore', 75] }, 'LIKELY', 'POSSIBLE'] },
      },
    },
    { $replaceRoot: { newRoot: '$latest' } },
    { $sort: { lastSeenAt: -1, _id: 1 } },
    ...(focusId ? [{ $setWindowFields: { sortBy: { lastSeenAt: -1, _id: 1 }, output: { tracePosition: { $sum: 1, window: { documents: ['unbounded', 'current'] } } } } }] : []),
    {
      $facet: {
        subscriptions: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'count' }],
        ...(focusId ? { focus: [{ $match: { _id: new mongoose.Types.ObjectId(focusId) } }, { $project: { tracePosition: 1 } }] } : {}),
      },
    },
  ])
  const total = result?.total[0]?.count || 0
  const subscriptions = (result?.subscriptions || []).map((subscription) => ({
    ...subscription,
    id: subscription._id.toString(),
    _id: undefined,
  }))
  return {
    pagination: paginationFor({ limit, page, total }),
    subscriptions,
    ...(focusId ? { focusedPage: result?.focus[0] ? Math.ceil(result.focus[0].tracePosition / limit) : null } : {}),
  }
}

async function listBreachInsights(userId, rawQuery = {}) {
  const controls = parseBreachPagination(rawQuery)
  const [{ accounts, pagination: signalPagination }, report] = await Promise.all([
    findAccountSignalsForPagination(userId, controls.signal, securityClasses),
    getBreachReportForUser(userId),
  ])
  const { breaches, provider } = serializeBreachReport(report)
  const breachTotal = breaches.length
  return {
    breaches: breaches.slice(
      (controls.breach.page - 1) * controls.breach.limit,
      controls.breach.page * controls.breach.limit,
    ),
    breachPagination: paginationFor({ ...controls.breach, total: breachTotal }),
    pagination: signalPagination,
    provider,
    securitySignals: accounts.map((account) => ({
      ...safeAccountProjection(account),
      basis: account.evidenceClasses.filter((value) => securityClasses.includes(value)),
      verifiedBreach: false,
    })),
  }
}

function exposureLevel(account) {
  if (account.evidenceClasses.includes('SECURITY_ALERT')) return 'HIGH'
  if (['DORMANT', 'POSSIBLY_DORMANT'].includes(account.dormantStatus)) return 'MEDIUM'
  return 'LOW'
}

async function listExposureInsights(userId, rawQuery = {}) {
  const { limit, page } = parseBoundedPagination(rawQuery)
  await getAccountSummary(userId)
  const filter = { userId }
  const [accounts, total] = await Promise.all([
    Account.find(filter)
      .select('confidenceLevel dormantStatus evidenceClasses firstSeenAt lastSeenAt primaryDomain serviceName')
      .sort({ lastSeenAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Account.countDocuments(filter),
  ])
  return {
    exposureSignals: accounts.map((account) => ({
      ...safeAccountProjection(account),
      level: exposureLevel(account),
      verifiedPublicExposure: false,
    })),
    pagination: paginationFor({ limit, page, total }),
    source: 'OWNTRACE_ACCOUNT_EVIDENCE',
  }
}

async function getPrivacyHealth(userId) {
  const [accounts, actions, breachReport] = await Promise.all([
    getAccountSummary(userId),
    getAccountActionSummary(userId),
    BreachReport.findOne({ userId }).select('breaches lastCheckedAt').lean(),
  ])
  const verifiedBreachCount = breachReport?.lastCheckedAt ? breachReport.breaches.length : 0
  if (accounts.total === 0 && verifiedBreachCount === 0) {
    return {
      confidence: 'NOT_ENOUGH_DATA',
      factors: [],
      score: null,
      summary: 'Connect a source and complete account discovery to calculate Privacy Health.',
    }
  }

  const penalties = {
    dormantAccounts: Math.min(20, accounts.dormant * 2),
    highPriorityActions: Math.min(24, actions.highPriority * 8),
    lowerConfidenceAccounts: Math.min(16, Math.max(0, accounts.total - accounts.highConfidence)),
    possiblyDormantAccounts: Math.min(10, accounts.possiblyDormant),
    verifiedBreaches: Math.min(30, verifiedBreachCount * 10),
  }
  const score = Math.max(0, 100 - Object.values(penalties).reduce((sum, value) => sum + value, 0))

  return {
    confidence: 'DERIVED_FROM_CURRENT_SIGNALS',
    factors: Object.entries(penalties).map(([id, penalty]) => ({ id, penalty })),
    score,
    summary: 'This score is a deterministic OwnTrace estimate, not an external security audit.',
  }
}

export {
  getPrivacyHealth,
  listBreachInsights,
  listExposureInsights,
  listSubscriptions,
}
