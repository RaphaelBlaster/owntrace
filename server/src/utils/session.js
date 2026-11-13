import jwt from 'jsonwebtoken'
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  getClearSessionCookieOptions,
  getJwtSecret,
  getSessionCookieOptions,
} from '../config/auth.js'

function createSessionToken(userId, tokenId) {
  return jwt.sign({}, getJwtSecret(), {
    algorithm: 'HS256',
    audience: TOKEN_AUDIENCE,
    expiresIn: Math.floor(SESSION_DURATION_MS / 1000),
    issuer: TOKEN_ISSUER,
    jwtid: tokenId,
    subject: userId.toString(),
  })
}

function verifySessionToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    audience: TOKEN_AUDIENCE,
    issuer: TOKEN_ISSUER,
  })
}

function setSessionCookie(response, token) {
  response.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions())
}

function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE_NAME, getClearSessionCookieOptions())
}

export { clearSessionCookie, createSessionToken, setSessionCookie, verifySessionToken }
