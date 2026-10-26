import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'
import { getTraceProviderName } from './trace-provider.service.js'
import { hasTraceConsent } from './trace-decision-config.js'

export async function checkTraceConsent(userId, provider = getTraceProviderName()) {
  const user = await User.findById(userId).select('traceAiConsent onboardingStatus')
  if (!user || user.onboardingStatus !== 'COMPLETED') throw new AppError('Complete OwnTrace setup before opening TRACE.', 403, 'TRACE_SETUP_REQUIRED')
  if (!hasTraceConsent(user, provider)) throw new AppError('Enable the selected AI providers in TRACE before asking about your workspace.', 403, 'TRACE_CONSENT_REQUIRED')
}
