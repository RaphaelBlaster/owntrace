export function label(value) { return value ? value.toLowerCase().replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) : 'Unknown' }
export function date(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Not available' }
export function accountView(account, detail) {
  return { id: account.id, name: account.serviceName, domain: account.primaryDomain, category: 'Account evidence', color: '#368aa4', letter: account.serviceName?.[0] || '?',
    status: label(account.dormantStatus), confidence: label(account.confidenceLevel), lastSeen: date(account.lastSeenAt), joined: date(account.firstSeenAt), signals: account.evidenceCount,
    source: 'Mail metadata', plan: 'Not available', cost: null, risk: null, reviewed: false, raw: account, evidence: detail?.evidence || [], evidenceTotal: detail?.evidenceTotal, evidenceTruncated: detail?.evidenceTruncated }
}
export function subscriptionView(subscription) {
  const currency = subscription.currency
  const digits = currency ? new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits : 2
  const amount = Number.isFinite(subscription.amountMinor) && currency ? subscription.amountMinor / (10 ** digits) : null
  return { id: subscription.id, name: subscription.serviceName, domain: subscription.primaryDomain, color: '#368aa4', category: 'Subscription signals', plan: label(subscription.billingCycle),
    cost: amount, currency, status: label(subscription.confidenceLevel), confidence: label(subscription.confidenceLevel), source: ({ GMAIL_METADATA: 'Gmail metadata', MICROSOFT_METADATA: 'Microsoft metadata', MULTI_PROVIDER_METADATA: 'Gmail and Microsoft metadata' })[subscription.source] || 'Mail metadata',
    signals: subscription.evidenceCount, lastSeen: date(subscription.lastSeenAt), renewal: date(subscription.nextRenewalAt), renewalIsEstimated: subscription.renewalIsEstimated, raw: subscription }
}
export function actionView(action) {
  return { ...action, name: action.account?.serviceName, priority: label(action.priority), state: ({ OPEN: 'To do', IN_PROGRESS: 'In progress', COMPLETED: 'Done', DISMISSED: 'Dismissed' })[action.status],
    category: label(action.type), time: 'Review', raw: action }
}
