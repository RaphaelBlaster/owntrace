import TraceConversation from '../models/trace-conversation.model.js'
import bcrypt from 'bcryptjs'
import { getBcryptRounds } from '../config/auth.js'
import AccountAction from '../models/account-action.model.js'
import AccountEvidence from '../models/account-evidence.model.js'
import Account from '../models/account.model.js'
import GmailSignal from '../models/gmail-signal.model.js'
import GmailSyncJob from '../models/gmail-sync-job.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import MicrosoftSignal from '../models/microsoft-signal.model.js'
import MicrosoftSubscription from '../models/microsoft-subscription.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import Session from '../models/session.model.js'
import User from '../models/user.model.js'
import { drainBufferedOrderWrites } from './order-write-buffer.service.js'
import AppError from '../utils/app-error.js'
import { revokeGoogleAccessForUser } from './google-oauth.service.js'
import { disconnectMicrosoft } from './microsoft-oauth.service.js'
import { deleteRaphaelOwnedDataForUser } from './raphael-data.service.js'

const DUMMY_PASSWORD_HASH = '$2b$12$OnbP9kWdyUNUxvOW.s950OcEToRQb8xqltZWIdmkSeXsYPip5BlS6'

function serializeUser(user) {
  return user.toJSON()
}

async function registerUser({ name, email, password }) {
  const existingUser = await User.exists({ email })

  if (existingUser) {
    throw new AppError('An account with this email already exists.', 409, 'EMAIL_IN_USE')
  }

  const passwordHash = await bcrypt.hash(password, getBcryptRounds())

  try {
    const user = await User.create({ email, name, passwordHash })
    return user
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError('An account with this email already exists.', 409, 'EMAIL_IN_USE')
    }

    throw error
  }
}

async function authenticateUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash')
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH)

  if (!user || !passwordMatches) {
    throw new AppError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS')
  }

  return user
}

async function getUserById(userId) {
  const user = await User.findById(userId)

  if (!user) {
    throw new AppError('Authentication is required.', 401, 'UNAUTHENTICATED')
  }

  return user
}

async function deleteUserAccount(userId, password) {
  const user = await User.findById(userId).select('+passwordHash')
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH)

  if (!user || !passwordMatches) {
    throw new AppError(
      'Password confirmation failed.',
      401,
      'ACCOUNT_DELETION_CONFIRMATION_FAILED',
    )
  }

  let providerRevocation = 'NOT_CONNECTED'

  try {
    const revoked = await revokeGoogleAccessForUser(userId)
    if (revoked) providerRevocation = 'REVOKED'
  } catch {
    providerRevocation = 'FAILED'
  }

  try {
    await disconnectMicrosoft(userId)
  } catch {
    // Local account deletion must not be blocked by a partial Microsoft cleanup.
    // The provider-owned data is removed again by the final local deletion phase.
  }

  const { cancelOrderWork } = await import('./order-control.service.js')
  await cancelOrderWork(userId)
  const { removeTopKSource } = await import('./top-k.service.js')
  await removeTopKSource(userId)
  // Flush buffered writes first so a queued page cannot resurrect deleted data.
  await drainBufferedOrderWrites()
  const orderModels = await Promise.all(['order-event','order-scan','order-preference','order-receipt'].map(name => import(`../models/${name}.model.js`)))
  const { default: OrderBudget } = await import('../models/order-budget.model.js')
  await Promise.all([
    ...orderModels.map(({ default: Model }) => Model.deleteMany({ userId })),
    OrderBudget.deleteMany({ owner: 'user:' + userId }),
    AccountAction.deleteMany({ userId }),
    AccountEvidence.deleteMany({ userId }),
    Account.deleteMany({ userId }),
    GmailSignal.deleteMany({ userId }),
    GmailSyncJob.deleteMany({ userId }),
    GoogleConnection.deleteMany({ userId }),
    MicrosoftConnection.deleteMany({ userId }),
    MicrosoftSignal.deleteMany({ userId }),
    MicrosoftSubscription.deleteMany({ userId }),
    MicrosoftSyncJob.deleteMany({ userId }),
    Session.deleteMany({ userId }),
    TraceConversation.deleteMany({ userId }),
    deleteRaphaelOwnedDataForUser(userId),
  ])
  await User.deleteOne({ _id: userId })

  return { providerRevocation }
}

export { authenticateUser, deleteUserAccount, getUserById, registerUser, serializeUser }
