// Version 2 consent also authorized the configured conversation provider, so
// it remains compatible now that TRACE no longer sends questions to Jev.
function traceConsentVersion() { return 1 }
function hasTraceConsent(user, provider) {
  return user?.traceAiConsent?.provider === provider && [1, 2].includes(user.traceAiConsent.version) && Boolean(user.traceAiConsent.acceptedAt)
}
export { hasTraceConsent, traceConsentVersion }
