import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { MICROSOFT_OAUTH_DURATION_MS, MICROSOFT_SCOPES, getMicrosoftConfig } from '../config/microsoft.js'
import { TOKEN_AUDIENCE, TOKEN_ISSUER, getJwtSecret } from '../config/auth.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import MicrosoftSignal from '../models/microsoft-signal.model.js'
import MicrosoftSyncJob from '../models/microsoft-sync-job.model.js'
import AppError from '../utils/app-error.js'
import { decryptSecret, encryptSecret } from '../utils/encryption.js'
import User from '../models/user.model.js'
import { removeConnectionDiscoveries } from './account-discovery.service.js'
import { removeMicrosoftSubscriptionsForUser } from './microsoft-subscription.service.js'

const issuer = `${TOKEN_ISSUER}:microsoft-oauth`
const audience = `${TOKEN_AUDIENCE}:microsoft-oauth`
const refreshLocks = new Map()

function hash(value) { return crypto.createHash('sha256').update(value).digest('base64url') }
function stateMatches(first, second) { const a = Buffer.from(first || ''); const b = Buffer.from(second || ''); return a.length === b.length && crypto.timingSafeEqual(a, b) }
function endpoints() { const { tenant } = getMicrosoftConfig(); return { authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token` } }
function validExpiry(value) { return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 86_400 }

function createAuthorizationUrl(userId) {
  const state = crypto.randomBytes(32).toString('base64url')
  const cookieState = jwt.sign({ stateHash: hash(state) }, getJwtSecret(), { algorithm: 'HS256', audience, expiresIn: Math.floor(MICROSOFT_OAUTH_DURATION_MS / 1000), issuer, subject: userId.toString() })
  const { clientId, redirectUri } = getMicrosoftConfig()
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_mode: 'query', response_type: 'code', scope: MICROSOFT_SCOPES.join(' '), state })
  return { authorizationUrl: `${endpoints().authorize}?${params}`, cookieState }
}

async function readBoundedJson(response, maximumBytes = 128_000) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new AppError('Microsoft returned an invalid response.', 502, 'MICROSOFT_REQUEST_FAILED')
  const reader = response.body?.getReader()
  if (!reader) throw new AppError('Microsoft returned an invalid response.', 502, 'MICROSOFT_REQUEST_FAILED')
  const chunks = []; let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) { await reader.cancel(); throw new AppError('Microsoft returned an invalid response.', 502, 'MICROSOFT_REQUEST_FAILED') }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('Microsoft returned an invalid response.', 502, 'MICROSOFT_REQUEST_FAILED')
  }
}

async function requestJson(url, options, { reconnectOnInvalidGrant = false } = {}) {
  let response
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) }) } catch { throw new AppError('Microsoft could not be reached. Try again.', 502, 'MICROSOFT_REQUEST_FAILED') }
  const value = await readBoundedJson(response)
  if (!response.ok) {
    if (reconnectOnInvalidGrant && (response.status === 401 || value?.error === 'invalid_grant')) {
      throw new AppError('Reconnect Microsoft before scanning.', 409, 'MICROSOFT_RECONNECT_REQUIRED')
    }
    const error = new AppError('Microsoft could not complete the connection.', 502, 'MICROSOFT_REQUEST_FAILED')
    error.microsoftProviderCode = typeof value?.error === 'string' ? value.error : 'UNKNOWN_PROVIDER_ERROR'
    throw error
  }
  return value
}

async function completeAuthorization({ code, cookieState, requestState, userId }) {
  let payload
  try { payload = jwt.verify(cookieState, getJwtSecret(), { algorithms: ['HS256'], audience, issuer }) } catch { throw new AppError('Microsoft connection state is invalid or expired.', 400, 'INVALID_OAUTH_STATE') }
  if (!stateMatches(payload.stateHash, hash(requestState))) throw new AppError('Microsoft connection state is invalid or expired.', 400, 'INVALID_OAUTH_STATE')
  if (payload.sub !== userId.toString()) throw new AppError('Microsoft connection state does not match this session.', 403, 'OAUTH_USER_MISMATCH')

  const config = getMicrosoftConfig()
  let token
  try {
    token = await requestJson(endpoints().token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: config.redirectUri, scope: MICROSOFT_SCOPES.join(' ') }) })
  } catch (error) {
    error.microsoftStage = 'token_exchange'
    throw error
  }
  const existingConnection = await MicrosoftConnection.findOne({ userId }).select('+encryptedRefreshToken')
  if (['SYNCING', 'DISCONNECTING'].includes(existingConnection?.status)) {
    throw new AppError('Stop the current scan or finish disconnecting before reconnecting.', 409, 'MICROSOFT_CONNECTION_BUSY')
  }
  const encryptedRefreshToken = typeof token.refresh_token === 'string' ? encryptSecret(token.refresh_token) : existingConnection?.encryptedRefreshToken
  if (typeof token.access_token !== 'string' || !encryptedRefreshToken || !validExpiry(token.expires_in)) throw new AppError('Microsoft did not provide offline access. Reconnect and approve consent again.', 409, 'MICROSOFT_REFRESH_TOKEN_MISSING')
  let profile
  try {
    profile = await requestJson('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', { headers: { authorization: `Bearer ${token.access_token}` } })
  } catch (error) {
    error.microsoftStage = 'graph_profile'
    throw error
  }
  const email = typeof profile.mail === 'string' ? profile.mail : profile.userPrincipalName
  if (typeof profile.id !== 'string' || typeof email !== 'string' || !email.trim()) throw new AppError('Microsoft did not return a valid account identity.', 502, 'MICROSOFT_IDENTITY_INVALID')
  const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : MICROSOFT_SCOPES
  if (!scopes.includes('Mail.ReadBasic')) throw new AppError('Microsoft did not grant basic mail metadata permission.', 409, 'MICROSOFT_SCOPE_MISSING')
  if (existingConnection?.microsoftAccountId && existingConnection.microsoftAccountId !== profile.id) {
    throw new AppError('Disconnect the current Microsoft account before connecting a different one.', 409, 'MICROSOFT_ACCOUNT_MISMATCH')
  }
  const connection = await MicrosoftConnection.findOneAndUpdate({ userId }, { $set: { connectedAt: existingConnection?.connectedAt || new Date(), email: email.trim().toLowerCase(), encryptedAccessToken: encryptSecret(token.access_token), encryptedRefreshToken, microsoftAccountId: profile.id, scopes, status: 'CONNECTED', lastErrorCode: null, tokenExpiresAt: new Date(Date.now() + Number(token.expires_in) * 1000) } }, { returnDocument: 'after', runValidators: true, upsert: true })
  await User.updateOne({ _id: userId }, { $addToSet: { authProviders: 'microsoft' } })
  return connection
}

async function getConnectionForUser(userId, includeSecrets = false) { const query = MicrosoftConnection.findOne({ userId }); if (includeSecrets) query.select('+encryptedAccessToken +encryptedRefreshToken'); return query }

async function refreshAccessToken(userId, connection) {
  const existing = refreshLocks.get(connection.id)
  if (existing) return existing
  const refresh = (async () => {
    const current = await getConnectionForUser(userId, true)
    if (!current || ['NEEDS_RECONNECT', 'DISCONNECTING'].includes(current.status)) throw new AppError('Reconnect Microsoft before starting a scan.', 409, 'MICROSOFT_RECONNECT_REQUIRED')
    if (current.tokenExpiresAt > new Date(Date.now() + 60_000)) return { accessToken: decryptSecret(current.encryptedAccessToken), connection: current }
    const config = getMicrosoftConfig()
    try {
      const token = await requestJson(endpoints().token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: decryptSecret(current.encryptedRefreshToken), scope: MICROSOFT_SCOPES.join(' ') }) }, { reconnectOnInvalidGrant: true })
      if (typeof token.access_token !== 'string' || !validExpiry(token.expires_in)) throw new AppError('Reconnect Microsoft before starting a scan.', 409, 'MICROSOFT_RECONNECT_REQUIRED')
      const update = await MicrosoftConnection.findOneAndUpdate({ _id: current.id, userId, encryptedRefreshToken: current.encryptedRefreshToken }, { $set: { encryptedAccessToken: encryptSecret(token.access_token), ...(typeof token.refresh_token === 'string' ? { encryptedRefreshToken: encryptSecret(token.refresh_token) } : {}), lastErrorCode: null, tokenExpiresAt: new Date(Date.now() + Number(token.expires_in) * 1000) } }, { returnDocument: 'after' }).select('+encryptedAccessToken +encryptedRefreshToken')
      if (!update) {
        const latest = await getConnectionForUser(userId, true)
        if (latest?.encryptedAccessToken && latest.tokenExpiresAt > new Date(Date.now() + 60_000)) {
          return { accessToken: decryptSecret(latest.encryptedAccessToken), connection: latest }
        }
        throw new AppError('Reconnect Microsoft before starting a scan.', 409, 'MICROSOFT_RECONNECT_REQUIRED')
      }
      return { accessToken: token.access_token, connection: update }
    } catch (error) {
      if (error.code === 'MICROSOFT_RECONNECT_REQUIRED') await MicrosoftConnection.updateOne({ _id: current.id, userId }, { $set: { lastErrorCode: error.code, status: 'NEEDS_RECONNECT' } })
      throw error
    }
  })().finally(() => refreshLocks.delete(connection.id))
  refreshLocks.set(connection.id, refresh)
  return refresh
}

async function withMicrosoftAccessToken(userId, callback) {
  let connection = await getConnectionForUser(userId, true)
  if (!connection) throw new AppError('Connect Microsoft before starting a scan.', 409, 'MICROSOFT_NOT_CONNECTED')
  if (connection.status === 'DISCONNECTING') throw new AppError('Microsoft is disconnecting. Try again shortly.', 409, 'MICROSOFT_DISCONNECT_IN_PROGRESS')
  if (connection.status === 'NEEDS_RECONNECT') throw new AppError('Reconnect Microsoft before starting a scan.', 409, 'MICROSOFT_RECONNECT_REQUIRED')
  let accessToken = decryptSecret(connection.encryptedAccessToken)
  if (connection.tokenExpiresAt <= new Date(Date.now() + 60_000)) ({ accessToken, connection } = await refreshAccessToken(userId, connection))
  return callback({ accessToken, connection })
}

async function disconnectMicrosoft(userId) {
  const connection = await getConnectionForUser(userId, true)
  if (connection) await MicrosoftConnection.updateOne({ _id: connection.id, userId }, { $set: { lastErrorCode: null, status: 'DISCONNECTING' } })
  const { cancelAndWaitForSync } = await import('./microsoft-sync.service.js')
  await cancelAndWaitForSync(userId)
  const { removeOrderSource } = await import('./order-control.service.js')
  await removeOrderSource(userId, 'outlook', connection?.id)
  await Promise.all([
    ...(connection ? [removeConnectionDiscoveries(userId, connection.id)] : []),
    MicrosoftSignal.deleteMany({ userId, ...(connection ? { connectionId: connection.id } : {}) }),
    MicrosoftSyncJob.deleteMany({ userId, ...(connection ? { connectionId: connection.id } : {}) }),
    removeMicrosoftSubscriptionsForUser(userId),
    MicrosoftConnection.deleteMany({ userId }),
    User.updateOne({ _id: userId }, { $pull: { authProviders: 'microsoft' } }),
  ])
  return Boolean(connection)
}

export { completeAuthorization, createAuthorizationUrl, disconnectMicrosoft, getConnectionForUser, readBoundedJson, stateMatches, withMicrosoftAccessToken }
