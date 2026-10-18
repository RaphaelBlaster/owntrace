import AppError from '../utils/app-error.js'

function getTraceDecisionProvider() {
  const provider=process.env.TRACE_DECISION_PROVIDER?.trim() || 'provider'
  if(!['provider','typesafe'].includes(provider))throw new AppError('Choose a supported TRACE decision provider.',503,'TRACE_NOT_CONFIGURED')
  return provider
}
function traceConsentVersion() { return getTraceDecisionProvider()==='typesafe' ? 2 : 1 }
export {getTraceDecisionProvider,traceConsentVersion}
