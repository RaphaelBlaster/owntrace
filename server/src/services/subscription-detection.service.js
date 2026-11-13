import GmailSignal from '../models/gmail-signal.model.js'
import Subscription from '../models/subscription.model.js'
import {
  classifyEvidence,
  getServiceName,
  normalizeServiceDomain,
} from './account-discovery.service.js'

const currencyDefinitions = [
  { code: 'INR', decimals: 2, patterns: [/\bINR\s*([\d,.]+)/i, /([\d,.]+)\s*INR\b/i, /₹\s*([\d,.]+)/] },
  { code: 'EUR', decimals: 2, patterns: [/\bEUR\s*([\d,.]+)/i, /([\d,.]+)\s*EUR\b/i, /€\s*([\d,.]+)/] },
  { code: 'GBP', decimals: 2, patterns: [/\bGBP\s*([\d,.]+)/i, /([\d,.]+)\s*GBP\b/i, /£\s*([\d,.]+)/] },
  { code: 'JPY', decimals: 0, patterns: [/\bJPY\s*([\d,.]+)/i, /([\d,.]+)\s*JPY\b/i, /¥\s*([\d,.]+)/] },
  { code: 'USD', decimals: 2, patterns: [/\bUSD\s*([\d,.]+)/i, /([\d,.]+)\s*USD\b/i] },
  { code: 'CAD', decimals: 2, patterns: [/\bCAD\s*([\d,.]+)/i, /([\d,.]+)\s*CAD\b/i] },
  { code: 'AUD', decimals: 2, patterns: [/\bAUD\s*([\d,.]+)/i, /([\d,.]+)\s*AUD\b/i] },
]

const cyclePatterns = [
  ['WEEKLY', /\b(weekly|every week|per week)\b/i],
  ['MONTHLY', /\b(monthly|every month|per month)\b/i],
  ['QUARTERLY', /\b(quarterly|every three months|every 3 months)\b/i],
  ['YEARLY', /\b(annual|annually|yearly|every year|per year)\b/i],
]

function parseDecimalAmount(rawValue) {
  const compact = rawValue.replace(/\s/g, '').replace(/[.,]+$/, '')
  const lastComma = compact.lastIndexOf(',')
  const lastDot = compact.lastIndexOf('.')
  let normalized = compact

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? compact.replaceAll('.', '').replace(',', '.')
      : compact.replaceAll(',', '')
  } else if (lastComma >= 0) {
    const decimalDigits = compact.length - lastComma - 1
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? compact.replace(',', '.')
      : compact.replaceAll(',', '')
  }

  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 && value <= 10_000_000 ? value : null
}

function extractBillingMetadata(subject) {
  if (typeof subject !== 'string' || !subject.trim()) {
    return { amountMinor: null, billingCycle: null, currency: null }
  }

  let amountMinor = null
  let currency = null
  for (const definition of currencyDefinitions) {
    const match = definition.patterns.map((pattern) => subject.match(pattern)).find(Boolean)
    if (!match) continue
    const amount = parseDecimalAmount(match[1])
    if (amount !== null) {
      amountMinor = Math.round(amount * (10 ** definition.decimals))
      currency = definition.code
      break
    }
  }

  const cycleMatch = cyclePatterns.find(([, pattern]) => pattern.test(subject))
  return {
    amountMinor,
    billingCycle: cycleMatch?.[0] || null,
    currency,
  }
}

function inferBillingCycle(dates) {
  if (dates.length < 2) return null
  const sortedTimes = [...new Set(dates.map((date) => new Date(date).getTime()))]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (sortedTimes.length < 2) return null

  const intervalDays = (sortedTimes.at(-1) - sortedTimes.at(-2)) / 86_400_000
  if (intervalDays >= 6 && intervalDays <= 8) return 'WEEKLY'
  if (intervalDays >= 25 && intervalDays <= 35) return 'MONTHLY'
  if (intervalDays >= 80 && intervalDays <= 100) return 'QUARTERLY'
  if (intervalDays >= 350 && intervalDays <= 380) return 'YEARLY'
  return null
}

function addBillingCycle(date, billingCycle) {
  if (!date || !billingCycle || billingCycle === 'UNKNOWN') return null
  const result = new Date(date)
  if (Number.isNaN(result.getTime())) return null

  if (billingCycle === 'WEEKLY') {
    result.setUTCDate(result.getUTCDate() + 7)
    return result
  }
  if (billingCycle === 'MONTHLY' || billingCycle === 'QUARTERLY' || billingCycle === 'YEARLY') {
    const months = billingCycle === 'MONTHLY' ? 1 : billingCycle === 'QUARTERLY' ? 3 : 12
    const originalDay = result.getUTCDate()
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + months)
    const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0))
      .getUTCDate()
    result.setUTCDate(Math.min(originalDay, finalDay))
    return result
  }
  return null
}

function scoreSubscription({ amountMinor, billingCycle, classifications, inferredCycle }) {
  const basis = new Set(classifications.map((item) => item.evidenceClass))
  let score = 0
  if (basis.has('PAYMENT')) score += 35
  if (basis.has('SUBSCRIPTION')) score += 30
  score += Math.min(20, Math.max(0, classifications.length - 1) * 10)
  if (amountMinor) score += 10
  if (billingCycle) score += 10
  if (basis.size === 2) score += 10
  if (inferredCycle) score += 15
  const confidenceScore = Math.min(95, score)
  return {
    confidenceLevel: confidenceScore >= 75 ? 'LIKELY' : 'POSSIBLE',
    confidenceScore,
  }
}

async function syncSubscriptionsForUser(userId) {
  const signals = await GmailSignal.find({ userId }).sort({ occurredAt: 1, _id: 1 }).lean()
  const groups = new Map()

  signals.forEach((signal) => {
    const classification = classifyEvidence(signal.subjectSignal)
    if (!['PAYMENT', 'SUBSCRIPTION'].includes(classification.evidenceClass)) return
    const serviceKey = normalizeServiceDomain(signal.senderDomain)
    if (!serviceKey) return
    const current = groups.get(serviceKey) || []
    current.push({ classification, signal })
    groups.set(serviceKey, current)
  })

  const activeServiceKeys = []
  for (const [serviceKey, items] of groups) {
    activeServiceKeys.push(serviceKey)
    const dates = items.map(({ signal }) => signal.occurredAt)
    const explicitCycleItem = [...items].reverse().find(({ signal }) => signal.billingCycle)
    const inferredCycle = explicitCycleItem ? null : inferBillingCycle(dates)
    const billingCycle = explicitCycleItem?.signal.billingCycle || inferredCycle || 'UNKNOWN'
    const amountItem = [...items].reverse().find(
      ({ signal }) => signal.billingAmountMinor && signal.billingCurrency,
    )
    const paymentItems = items.filter(
      ({ classification }) => classification.evidenceClass === 'PAYMENT',
    )
    const classifications = items.map(({ classification }) => classification)
    const { confidenceLevel, confidenceScore } = scoreSubscription({
      amountMinor: amountItem?.signal.billingAmountMinor,
      billingCycle: billingCycle === 'UNKNOWN' ? null : billingCycle,
      classifications,
      inferredCycle,
    })
    const renewalBase = dates.at(-1)

    await Subscription.findOneAndUpdate(
      { serviceKey, userId },
      {
        $set: {
          amountMinor: amountItem?.signal.billingAmountMinor || null,
          basis: [...new Set(classifications.map((item) => item.evidenceClass))].sort(),
          billingCycle,
          confidenceLevel,
          confidenceScore,
          currency: amountItem?.signal.billingCurrency || null,
          evidenceCount: items.length,
          evidenceSignalIds: items.slice(-100).map(({ signal }) => signal._id),
          firstSeenAt: dates[0],
          lastPaymentAt: paymentItems.at(-1)?.signal.occurredAt || null,
          lastSeenAt: dates.at(-1),
          nextRenewalAt: addBillingCycle(renewalBase, billingCycle),
          primaryDomain: serviceKey,
          renewalIsEstimated: billingCycle !== 'UNKNOWN',
          serviceName: getServiceName(serviceKey),
          source: 'GMAIL_METADATA',
        },
        $setOnInsert: { serviceKey, userId },
      },
      { returnDocument: 'after', runValidators: true, upsert: true },
    )
  }

  await Subscription.deleteMany({
    userId,
    ...(activeServiceKeys.length ? { serviceKey: { $nin: activeServiceKeys } } : {}),
  })

  return {
    processedSignalCount: signals.length,
    subscriptionCount: activeServiceKeys.length,
  }
}

async function removeSubscriptionsForUser(userId) {
  await Subscription.deleteMany({ userId })
}

export {
  addBillingCycle,
  extractBillingMetadata,
  inferBillingCycle,
  removeSubscriptionsForUser,
  scoreSubscription,
  syncSubscriptionsForUser,
}
