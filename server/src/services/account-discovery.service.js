import { getDomain } from 'tldts'
import AccountAction from '../models/account-action.model.js'
import AccountEvidence from '../models/account-evidence.model.js'
import Account from '../models/account.model.js'
import GmailSignal from '../models/gmail-signal.model.js'
import MicrosoftSignal from '../models/microsoft-signal.model.js'
import User from '../models/user.model.js'
import { syncAccountActionsForUser } from './account-action.service.js'
import { evaluateDormancy } from './account-dormancy.service.js'

const brandNames = new Map([
  ['adobe.com', 'Adobe'],
  ['apple.com', 'Apple'],
  ['canva.com', 'Canva'],
  ['dropbox.com', 'Dropbox'],
  ['figma.com', 'Figma'],
  ['github.com', 'GitHub'],
  ['google.com', 'Google'],
  ['linkedin.com', 'LinkedIn'],
  ['microsoft.com', 'Microsoft'],
  ['netflix.com', 'Netflix'],
  ['notion.so', 'Notion'],
  ['spotify.com', 'Spotify'],
])

const marketingPattern = /\b(newsletter|offer|sale|discount|deal|promotion|unsubscribe)\b/i

const evidenceRules = [
  {
    evidenceClass: 'ACCOUNT_DELETION',
    evidenceWeight: 78,
    ownershipSignal: true,
    pattern: /\b(account|profile)\b.{0,40}\b(deleted|deletion|closed|closure|removed)\b|\b(deleted|deletion|closed|closure|removed)\b.{0,40}\b(account|profile)\b/i,
    reasonCode: 'ACCOUNT_DELETION_LANGUAGE',
  },
  {
    evidenceClass: 'PASSWORD_RESET',
    evidenceWeight: 82,
    ownershipSignal: true,
    pattern: /\b(reset|change|changed|recover|recovery)\b.{0,30}\bpassword\b|\bpassword\b.{0,30}\b(reset|change|changed|recover|recovery)\b/i,
    reasonCode: 'PASSWORD_RECOVERY_LANGUAGE',
  },
  {
    evidenceClass: 'SECURITY_ALERT',
    evidenceWeight: 82,
    ownershipSignal: true,
    pattern: /\b(security alert|suspicious activity|unusual activity|account compromised|security warning)\b/i,
    reasonCode: 'SECURITY_ALERT_LANGUAGE',
  },
  {
    evidenceClass: 'LOGIN_ALERT',
    evidenceWeight: 76,
    ownershipSignal: true,
    pattern: /\b(new|recent|unrecognized|unusual)\b.{0,24}\b(sign[- ]?in|login)\b|\b(login|sign[- ]?in)\b.{0,24}\b(alert|attempt|detected)\b/i,
    reasonCode: 'LOGIN_ACTIVITY_LANGUAGE',
  },
  {
    evidenceClass: 'OTP',
    evidenceWeight: 68,
    ownershipSignal: true,
    pattern: /\b(one[- ]time|otp|security code|verification code|sign[- ]?in code|authentication code)\b/i,
    reasonCode: 'ONE_TIME_CODE_LANGUAGE',
  },
  {
    evidenceClass: 'ACCOUNT_VERIFICATION',
    evidenceWeight: 86,
    ownershipSignal: true,
    pattern: /\b(confirm|verify|verification)\b.{0,30}\b(email|account|profile)\b|\b(email|account|profile)\b.{0,30}\b(confirm|verify|verification)\b/i,
    reasonCode: 'ACCOUNT_VERIFICATION_LANGUAGE',
  },
  {
    evidenceClass: 'ACCOUNT_CREATED',
    evidenceWeight: 90,
    ownershipSignal: true,
    pattern: /\b(account|profile|registration)\b.{0,35}\b(created|ready|activated|complete|completed|successful)\b|\b(created|activated)\b.{0,24}\b(account|profile)\b/i,
    reasonCode: 'ACCOUNT_CREATION_LANGUAGE',
  },
  {
    evidenceClass: 'WELCOME',
    evidenceWeight: 72,
    ownershipSignal: true,
    pattern: /\bwelcome\b.{0,30}\b(to|aboard|account|community)\b/i,
    reasonCode: 'WELCOME_LANGUAGE',
  },
  {
    evidenceClass: 'PAYMENT',
    evidenceWeight: 58,
    ownershipSignal: true,
    pattern: /\b(receipt|invoice|payment|charged|billing confirmation|order confirmation)\b/i,
    reasonCode: 'PAYMENT_LANGUAGE',
  },
  {
    evidenceClass: 'SUBSCRIPTION',
    evidenceWeight: 54,
    ownershipSignal: true,
    pattern: /\b(subscription|membership|plan renewal|renewal notice|trial ending)\b/i,
    reasonCode: 'SUBSCRIPTION_LANGUAGE',
  },
]

function normalizeServiceDomain(senderDomain) {
  if (typeof senderDomain !== 'string' || !senderDomain.trim()) return null

  return getDomain(senderDomain.trim().toLowerCase().replace(/\.$/, ''), {
    allowPrivateDomains: true,
  }) || null
}

function getServiceName(primaryDomain) {
  if (brandNames.has(primaryDomain)) return brandNames.get(primaryDomain)

  const label = primaryDomain.split('.')[0]
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 120)
}

function classifyEvidence(subjectSignal) {
  const subject = typeof subjectSignal === 'string' ? subjectSignal.trim() : ''

  for (const rule of evidenceRules) {
    if (rule.pattern.test(subject)) {
      if (
        marketingPattern.test(subject)
        && ['PAYMENT', 'SUBSCRIPTION', 'WELCOME'].includes(rule.evidenceClass)
      ) {
        return {
          evidenceClass: 'OTHER',
          evidenceWeight: 5,
          ownershipSignal: false,
          reasonCode: 'MARKETING_ONLY_LANGUAGE',
        }
      }

      return {
        evidenceClass: rule.evidenceClass,
        evidenceWeight: rule.evidenceWeight,
        ownershipSignal: rule.ownershipSignal,
        reasonCode: rule.reasonCode,
      }
    }
  }

  if (marketingPattern.test(subject)) {
    return {
      evidenceClass: 'OTHER',
      evidenceWeight: 5,
      ownershipSignal: false,
      reasonCode: 'MARKETING_ONLY_LANGUAGE',
    }
  }

  return {
    evidenceClass: 'OTHER',
    evidenceWeight: subject ? 12 : 0,
    ownershipSignal: false,
    reasonCode: subject ? 'UNCLASSIFIED_SUBJECT' : 'MISSING_SUBJECT',
  }
}

function getConfidenceLevel(score) {
  if (score >= 90) return 'CONFIRMED'
  if (score >= 70) return 'LIKELY'
  if (score >= 40) return 'POSSIBLE'
  return 'UNKNOWN'
}

function scoreEvidence(classifications) {
  const ownershipEvidence = classifications.filter((item) => item.ownershipSignal)
  if (!ownershipEvidence.length) {
    const score = Math.min(20, Math.max(0, ...classifications.map((item) => item.evidenceWeight)))
    return { confidenceLevel: getConfidenceLevel(score), confidenceScore: score }
  }

  const strongestWeight = Math.max(...ownershipEvidence.map((item) => item.evidenceWeight))
  const distinctClasses = new Set(ownershipEvidence.map((item) => item.evidenceClass)).size
  const corroborationBonus = Math.min(12, Math.max(0, ownershipEvidence.length - 1) * 3)
  const diversityBonus = Math.min(8, Math.max(0, distinctClasses - 1) * 4)
  const score = Math.min(100, strongestWeight + corroborationBonus + diversityBonus)

  return { confidenceLevel: getConfidenceLevel(score), confidenceScore: score }
}

async function discoverAccountsFromSignals(userId, signals, signalField) {
  const groups = new Map()

  signals.forEach((signal) => {
    const primaryDomain = normalizeServiceDomain(signal.senderDomain)
    if (!primaryDomain) return

    const classification = classifyEvidence(signal.subjectSignal)
    const current = groups.get(primaryDomain) || []
    current.push({ classification, signal })
    groups.set(primaryDomain, current)
  })

  for (const [primaryDomain, items] of groups) {
    const classifications = items.map((item) => item.classification)
    const { confidenceLevel, confidenceScore } = scoreEvidence(classifications)
    const occurredDates = items.map((item) => item.signal.occurredAt)
    const evidenceClasses = [...new Set(
      classifications.map((classification) => classification.evidenceClass),
    )].sort()
    const ownershipEvidenceCount = classifications.filter(
      (classification) => classification.ownershipSignal,
    ).length
    const ownershipItems = items.filter((item) => item.classification.ownershipSignal)
    const lastOwnershipEvidenceAt = ownershipItems.length
      ? ownershipItems[ownershipItems.length - 1].signal.occurredAt
      : null
    const dormancy = evaluateDormancy({ lastOwnershipEvidenceAt, ownershipEvidenceCount })

    const account = await Account.findOneAndUpdate(
      { serviceKey: primaryDomain, userId },
      {
        $set: {
          confidenceLevel,
          confidenceScore,
          evidenceClasses,
          evidenceCount: items.length,
          firstSeenAt: occurredDates[0],
          lastOwnershipEvidenceAt,
          lastEvaluatedAt: new Date(),
          lastSeenAt: occurredDates[occurredDates.length - 1],
          ownershipEvidenceCount,
          primaryDomain,
          serviceName: getServiceName(primaryDomain),
          ...dormancy,
        },
        $setOnInsert: { serviceKey: primaryDomain, status: 'DISCOVERED', userId },
      },
      { returnDocument: 'after', runValidators: true, upsert: true },
    )

    await AccountEvidence.bulkWrite(
      items.map(({ classification, signal }) => {
        const resolvedSignalField = signal._signalField || signalField
        return { updateOne: {
          filter: { [resolvedSignalField]: signal._id, userId },
          update: {
            $set: {
              accountId: account._id,
              connectionId: signal.connectionId,
              connectionProvider: resolvedSignalField === 'microsoftSignalId' ? 'MICROSOFT' : 'GOOGLE',
              evidenceClass: classification.evidenceClass,
              evidenceWeight: classification.evidenceWeight,
              occurredAt: signal.occurredAt,
              ownershipSignal: classification.ownershipSignal,
              reasonCode: classification.reasonCode,
              sourceDomain: signal.senderDomain,
            },
            $setOnInsert: { [resolvedSignalField]: signal._id, userId },
          },
          upsert: true,
        } }
      }),
      { ordered: false },
    )
  }

  await User.updateOne({ _id: userId }, { $set: { onboardingStatus: 'COMPLETED' } })
  await syncAccountActionsForUser(userId)

  return {
    accountCount: groups.size,
    evidenceCount: await AccountEvidence.countDocuments({ userId }),
    processedSignalCount: signals.length,
  }
}

async function discoverAccountsForUser(userId, excludedConnectionId = null) {
  const providerFilter = excludedConnectionId ? { connectionId: { $ne: excludedConnectionId } } : {}
  const [gmailSignals, microsoftSignals] = await Promise.all([
    GmailSignal.find({ userId, ...providerFilter }).sort({ occurredAt: 1, _id: 1 }).lean(),
    MicrosoftSignal.find({ userId, ...providerFilter }).sort({ occurredAt: 1, _id: 1 }).lean(),
  ])
  const signals = [
    ...gmailSignals.map((signal) => ({ ...signal, _signalField: 'gmailSignalId' })),
    ...microsoftSignals.map((signal) => ({ ...signal, _signalField: 'microsoftSignalId' })),
  ].sort((first, second) => new Date(first.occurredAt) - new Date(second.occurredAt))
  return discoverAccountsFromSignals(userId, signals, 'gmailSignalId')
}

async function removeConnectionDiscoveries(userId, connectionId) {
  const evidence = await AccountEvidence.find({ connectionId, userId }).select('accountId').lean()
  const accountIds = [...new Set(evidence.map((item) => item.accountId.toString()))]

  await AccountEvidence.deleteMany({ connectionId, userId })

  if (accountIds.length) await discoverAccountsForUser(userId, connectionId)

  for (const accountId of accountIds) {
    const remainingEvidence = await AccountEvidence.exists({ accountId, userId })
    if (!remainingEvidence) {
      await Promise.all([
        AccountAction.deleteMany({ accountId, userId }),
        Account.deleteOne({ _id: accountId, userId }),
      ])
    }
  }
}

export {
  classifyEvidence,
  discoverAccountsFromSignals,
  discoverAccountsForUser,
  getConfidenceLevel,
  getServiceName,
  normalizeServiceDomain,
  removeConnectionDiscoveries,
  scoreEvidence,
}
