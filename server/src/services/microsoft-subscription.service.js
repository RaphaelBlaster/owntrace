import MicrosoftSignal from '../models/microsoft-signal.model.js'
import MicrosoftSubscription from '../models/microsoft-subscription.model.js'
import AppError from '../utils/app-error.js'
import { classifyEvidence, getServiceName, normalizeServiceDomain } from './account-discovery.service.js'
import { addBillingCycle, inferBillingCycle, scoreSubscription } from './subscription-detection.service.js'

function parsePagination(query = {}) {
  if (Object.keys(query).some((key) => !['page', 'limit'].includes(key)) || ['page', 'limit'].some((key) => query[key] !== undefined && (typeof query[key] !== 'string' || !/^\d+$/.test(query[key])))) {
    throw new AppError('Microsoft subscription query is invalid.', 400, 'INVALID_MICROSOFT_SUBSCRIPTION_QUERY')
  }
  const page = Number(query.page || 1)
  const limit = Number(query.limit || 12)
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AppError('Microsoft subscription query is invalid.', 400, 'INVALID_MICROSOFT_SUBSCRIPTION_QUERY')
  }
  return {
    page,
    limit,
  }
}

async function listMicrosoftSubscriptionsForUser(userId, query) {
  const { page, limit } = parsePagination(query)
  const [subscriptions, total] = await Promise.all([
    MicrosoftSubscription.find({ userId }).sort({ lastSeenAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    MicrosoftSubscription.countDocuments({ userId }),
  ])
  return {
    subscriptions: subscriptions.map((subscription) => subscription.toJSON()),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  }
}

async function syncMicrosoftSubscriptions(userId) {
  const signals = await MicrosoftSignal.find({ userId }).sort({ occurredAt: 1, _id: 1 }).lean()
  const groups = new Map()

  for (const signal of signals) {
    const classification = classifyEvidence(signal.subjectSignal)
    if (!['PAYMENT', 'SUBSCRIPTION'].includes(classification.evidenceClass)) continue
    const serviceKey = normalizeServiceDomain(signal.senderDomain)
    if (!serviceKey) continue
    const group = groups.get(serviceKey) || []
    group.push({ classification, signal })
    groups.set(serviceKey, group)
  }

  const activeServiceKeys = []
  for (const [serviceKey, items] of groups) {
    activeServiceKeys.push(serviceKey)
    const dates = items.map(({ signal }) => signal.occurredAt)
    const explicitCycleItem = [...items].reverse().find(({ signal }) => signal.billingCycle)
    const inferredCycle = explicitCycleItem ? null : inferBillingCycle(dates)
    const billingCycle = explicitCycleItem?.signal.billingCycle || inferredCycle || 'UNKNOWN'
    const amountItem = [...items].reverse().find(({ signal }) => signal.billingAmountMinor && signal.billingCurrency)
    const paymentItems = items.filter(({ classification }) => classification.evidenceClass === 'PAYMENT')
    const classifications = items.map(({ classification }) => classification)
    const { confidenceLevel, confidenceScore } = scoreSubscription({
      amountMinor: amountItem?.signal.billingAmountMinor,
      billingCycle: billingCycle === 'UNKNOWN' ? null : billingCycle,
      classifications,
      inferredCycle,
    })

    await MicrosoftSubscription.findOneAndUpdate(
      { serviceKey, userId },
      { $set: {
        amountMinor: amountItem?.signal.billingAmountMinor || null,
        basis: [...new Set(classifications.map((item) => item.evidenceClass))].sort(),
        billingCycle, confidenceLevel, confidenceScore,
        currency: amountItem?.signal.billingCurrency || null,
        evidenceCount: items.length,
        evidenceSignalIds: items.slice(-100).map(({ signal }) => signal._id),
        firstSeenAt: dates[0], lastPaymentAt: paymentItems.at(-1)?.signal.occurredAt || null,
        lastSeenAt: dates.at(-1), nextRenewalAt: addBillingCycle(dates.at(-1), billingCycle),
        primaryDomain: serviceKey, renewalIsEstimated: billingCycle !== 'UNKNOWN',
        serviceName: getServiceName(serviceKey), source: 'MICROSOFT_METADATA',
      }, $setOnInsert: { serviceKey, userId } },
      { returnDocument: 'after', runValidators: true, upsert: true },
    )
  }

  await MicrosoftSubscription.deleteMany({ userId, ...(activeServiceKeys.length ? { serviceKey: { $nin: activeServiceKeys } } : {}) })
  return { processedSignalCount: signals.length, subscriptionCount: activeServiceKeys.length }
}

async function removeMicrosoftSubscriptionsForUser(userId) {
  await MicrosoftSubscription.deleteMany({ userId })
}

export { listMicrosoftSubscriptionsForUser, removeMicrosoftSubscriptionsForUser, syncMicrosoftSubscriptions }
