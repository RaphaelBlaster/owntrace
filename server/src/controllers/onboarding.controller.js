import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'

const supportedTransitions = {
  PRIVACY_REVIEWED: ['NOT_STARTED', 'PRIVACY_REVIEWED'],
  GMAIL_PENDING: ['PRIVACY_REVIEWED', 'GMAIL_PENDING'],
  COMPLETED: ['GMAIL_PENDING', 'SCAN_PENDING', 'COMPLETED'],
}

function getOnboarding(request, response) {
  response.status(200).json({
    success: true,
    onboarding: { status: request.user.onboardingStatus },
  })
}

async function updateOnboarding(request, response) {
  const status = typeof request.body?.status === 'string' ? request.body.status.trim() : ''
  const allowedCurrentStates = supportedTransitions[status]

  if (!allowedCurrentStates) {
    throw new AppError(
      'Choose a supported onboarding step.',
      400,
      'INVALID_ONBOARDING_STATUS',
    )
  }

  const user = await User.findOneAndUpdate(
    { _id: request.auth.userId, onboardingStatus: { $in: allowedCurrentStates } },
    { $set: { onboardingStatus: status } },
    { returnDocument: 'after', runValidators: true },
  )

  if (!user) {
    throw new AppError(
      'Complete the previous onboarding step before continuing.',
      409,
      'ONBOARDING_STEP_OUT_OF_ORDER',
    )
  }

  response.status(200).json({ success: true, onboarding: { status: user.onboardingStatus } })
}

export { getOnboarding, updateOnboarding }
