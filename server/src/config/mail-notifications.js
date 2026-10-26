function publicApiUrl() {
  const raw = process.env.PUBLIC_API_URL?.trim()
  if (!raw) return null
  let url
  try { url = new URL(raw) } catch { throw new Error('PUBLIC_API_URL must be a valid HTTPS origin') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_API_URL must be an HTTPS origin without credentials or a path')
  }
  return url.origin
}

function getGooglePushConfig() {
  const values = ['GMAIL_PUBSUB_TOPIC', 'GMAIL_PUBSUB_AUDIENCE', 'GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL']
    .map(name => process.env[name]?.trim() || '')
  if (values.every(value => !value)) return null
  if (values.some(value => !value)) throw new Error('Configure all GMAIL_PUBSUB_* values to enable Gmail push sync')
  const [topicName, audience, serviceAccountEmail] = values
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topicName)) throw new Error('GMAIL_PUBSUB_TOPIC must be a full Pub/Sub topic name')
  let audienceUrl
  try { audienceUrl = new URL(audience) } catch { throw new Error('GMAIL_PUBSUB_AUDIENCE must be a valid HTTPS URL') }
  if (audienceUrl.protocol !== 'https:' || audienceUrl.username || audienceUrl.password) throw new Error('GMAIL_PUBSUB_AUDIENCE must use HTTPS')
  if (!/^[^\s@]+@[^\s@]+$/.test(serviceAccountEmail)) throw new Error('GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL must be an email address')
  return { topicName, audience, serviceAccountEmail }
}

function microsoftNotificationsEnabled() { return Boolean(publicApiUrl()) }

export { getGooglePushConfig, microsoftNotificationsEnabled, publicApiUrl }
