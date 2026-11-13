import { SESSION_COOKIE_NAME } from '../config/auth.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'
import { verifyActiveSession } from '../services/session.service.js'

async function requireAuth(request, _response, next) {
  const token = request.cookies?.[SESSION_COOKIE_NAME]

  if (!token) {
    return next(new AppError('Authentication is required.', 401, 'UNAUTHENTICATED'))
  }

  let payload

  try {
    payload = await verifyActiveSession(token)
  } catch (error) {
    return next(error)
  }

  const user = await User.findById(payload.sub)

  if (!user) {
    return next(new AppError('Authentication is required.', 401, 'UNAUTHENTICATED'))
  }

  request.auth = { userId: user.id }
  request.user = user
  return next()
}

export default requireAuth
