import { createHash, randomUUID } from 'node:crypto'
import { SESSION_DURATION_MS } from '../config/auth.js'
import Session from '../models/session.model.js'
import AppError from '../utils/app-error.js'
import { createSessionToken, verifySessionToken } from '../utils/session.js'

function hashTokenId(tokenId) {
  return createHash('sha256').update(tokenId).digest('base64url')
}

async function issueSession(userId) {
  const tokenId = randomUUID()
  await Session.create({
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    tokenIdHash: hashTokenId(tokenId),
    userId,
  })
  return createSessionToken(userId, tokenId)
}

async function verifyActiveSession(token) {
  let payload
  try {
    payload = verifySessionToken(token)
  } catch (error) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) throw error
    throw new AppError('Your session is invalid or has expired.', 401, 'INVALID_SESSION')
  }
  if (typeof payload.jti !== 'string' || !payload.jti) {
    throw new AppError('Your session is invalid or has expired.', 401, 'INVALID_SESSION')
  }
  let activeSession
  try {
    activeSession = await Session.exists({
      expiresAt: { $gt: new Date() },
      tokenIdHash: hashTokenId(payload.jti),
      userId: payload.sub,
    })
  } catch {
    throw new AppError('We could not verify your session right now. Please try again.', 503, 'SESSION_UNAVAILABLE')
  }
  if (!activeSession) throw new AppError('Your session is invalid or has expired.', 401, 'INVALID_SESSION')
  return payload
}

async function revokeSession(token) {
  if (!token) return
  let payload
  try {
    payload = verifySessionToken(token)
  } catch (error) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) return
    throw error
  }
  if (typeof payload.jti !== 'string' || !payload.jti) return
  try {
    await Session.deleteOne({
      tokenIdHash: hashTokenId(payload.jti),
      userId: payload.sub,
    })
  } catch {
    throw new AppError('We could not sign you out right now. Please try again.', 503, 'SESSION_UNAVAILABLE')
  }
}

export { hashTokenId, issueSession, revokeSession, verifyActiveSession }
