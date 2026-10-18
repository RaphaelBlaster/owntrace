import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'
import { getTraceProviderName } from './trace-provider.service.js'
import { traceConsentVersion } from './trace-decision-config.js'

export async function checkTraceConsent(userId, provider = getTraceProviderName()) {
  const user = await User.findById(userId).select('traceAiConsent onboardingStatus')
  if (!user || user.onboardingStatus !== 'COMPLETED') throw new AppError('Complete OwnTrace setup before opening TRACE.', 403, 'TRACE_SETUP_REQUIRED')
  if (user.traceAiConsent?.provider !== provider || user.traceAiConsent.version !== traceConsentVersion() || !user.traceAiConsent.acceptedAt) throw new AppError('Enable the selected AI providers in TRACE before asking about your workspace.', 403, 'TRACE_CONSENT_REQUIRED')
}
