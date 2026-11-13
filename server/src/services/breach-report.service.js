import { randomUUID } from 'node:crypto'
import BreachReport from '../models/breach-report.model.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'
import { reserveProviderCheck } from './breach-provider-rate-limit.service.js'
import { XPOSED_OR_NOT_PROVIDER, requestXposedOrNot } from './xposed-or-not.service.js'

const CACHE_DURATION_MS = 24 * 60 * 60 * 1_000
const LOCK_DURATION_MS = 60 * 1_000

function reportStatus(report) {
  if (!report?.lastCheckedAt) return 'NOT_CHECKED'
  return report.breaches.length ? 'BREACHES_FOUND' : 'CLEAR'
}

function serializeBreachReport(report, now = new Date()) {
  const checkedAt = report?.lastCheckedAt || null
  const nextCheckAt = report?.nextCheckAt || null
  return {
    breaches: (report?.breaches || []).map((breach) => ({ name: breach.name })),
    provider: {
      attribution: 'Verified results are supplied by XposedOrNot.',
      id: XPOSED_OR_NOT_PROVIDER,
      lastCheckedAt: checkedAt,
      message: checkedAt
        ? 'Your verified results are saved for 24 hours after a security check.'
        : 'Check your OwnTrace account email when you are ready to share it with XposedOrNot.',
      nextCheckAt,
      requiresConsent: true,
      status: reportStatus(report),
      cached: Boolean(nextCheckAt && new Date(nextCheckAt) > now),
    },
  }
}

async function getBreachReportForUser(userId) {
  return BreachReport.findOne({ userId }).lean()
}

async function acquireCheckLock(userId, now) {
  const staleLockAt = new Date(now.getTime() - LOCK_DURATION_MS)
  const token = randomUUID()
  try {
    const report = await BreachReport.findOneAndUpdate(
      {
        userId,
        $or: [
          { checkingStartedAt: null },
          { checkingStartedAt: { $exists: false } },
          { checkingStartedAt: { $lt: staleLockAt } },
        ],
      },
      {
        $set: { checkingStartedAt: now, checkingToken: token, lastErrorCode: null },
        $setOnInsert: { provider: XPOSED_OR_NOT_PROVIDER, userId },
      },
      { returnDocument: 'after', upsert: true },
    ).lean()
    return { report, token }
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError(
        'Your security check is already running. Check back in a moment.',
        409,
        'BREACH_CHECK_IN_PROGRESS',
      )
    }
    throw error
  }
}

async function checkBreachesForUser(userId, input = {}, now = new Date()) {
  if (input?.consent !== true) {
    throw new AppError(
      'Confirm that OwnTrace may send your account email to XposedOrNot before checking.',
      400,
      'BREACH_CHECK_CONSENT_REQUIRED',
    )
  }

  const existing = await getBreachReportForUser(userId)
  if (existing?.nextCheckAt && new Date(existing.nextCheckAt) > now) {
    return { report: serializeBreachReport(existing, now), reused: true }
  }

  const lock = await acquireCheckLock(userId, now)

  try {
    const user = await User.findById(userId).select('email').lean()
    if (!user) throw new AppError('Authentication is required.', 401, 'UNAUTHENTICATED')

    reserveProviderCheck(now.getTime())
    const breachNames = await requestXposedOrNot(user.email)
    const updated = await BreachReport.findOneAndUpdate(
      { checkingToken: lock.token, userId },
      {
        $set: {
          breaches: breachNames.map((name) => ({ name })),
          checkingStartedAt: null,
          checkingToken: null,
          lastCheckedAt: now,
          lastErrorCode: null,
          nextCheckAt: new Date(now.getTime() + CACHE_DURATION_MS),
          provider: XPOSED_OR_NOT_PROVIDER,
        },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean()
    if (!updated) {
      throw new AppError(
        'Your security check has been replaced by a newer request. Check back in a moment.',
        409,
        'BREACH_CHECK_IN_PROGRESS',
      )
    }
    return { report: serializeBreachReport(updated, now), reused: false }
  } catch (error) {
    await BreachReport.updateOne(
      { checkingToken: lock.token, userId },
      { $set: { checkingStartedAt: null, checkingToken: null, lastErrorCode: error.code || 'BREACH_CHECK_UNAVAILABLE' } },
    )
    throw error
  }
}

export {
  checkBreachesForUser,
  getBreachReportForUser,
  serializeBreachReport,
}
