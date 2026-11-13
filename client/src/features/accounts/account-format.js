const evidenceLabels = {
  ACCOUNT_CREATED: 'Account creation',
  ACCOUNT_DELETION: 'Account deletion',
  ACCOUNT_VERIFICATION: 'Account verification',
  LOGIN_ALERT: 'Login activity',
  OTHER: 'Other account signal',
  OTP: 'One-time code',
  PASSWORD_RESET: 'Password recovery',
  PAYMENT: 'Payment activity',
  SECURITY_ALERT: 'Security activity',
  SUBSCRIPTION: 'Subscription activity',
  WELCOME: 'Welcome message',
}

function formatAccountDate(value, fallback = 'Not available') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function formatEnum(value) {
  if (!value) return 'Unknown'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getEvidenceLabel(value) {
  return evidenceLabels[value] || formatEnum(value)
}

export { formatAccountDate, formatEnum, getEvidenceLabel }
