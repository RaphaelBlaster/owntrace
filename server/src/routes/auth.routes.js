import { Router } from 'express'
import {
  deleteAccount,
  login,
  logout,
  me,
  register,
  session,
} from '../controllers/auth.controller.js'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'
import { authRateLimiter } from '../middleware/security.middleware.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'

const authRouter = Router()

// Field-level messages come from utils/validation.js; this only gates types and sizes.
const credentialsBody = Joi.object({ email: Joi.string().allow('').max(320), password: Joi.string().allow('').max(1024), name: Joi.string().allow('').max(200) })
authRouter.post('/register', authRateLimiter, validate(credentialsBody), register)
authRouter.post('/login', authRateLimiter, validate(credentialsBody), login)
authRouter.post('/logout', logout)
authRouter.get('/session', session)
authRouter.get('/me', requireAuth, me)
const profileBody = Joi.object({ name: Joi.string().trim().min(2).max(80), workspaceGoal: Joi.string().valid('Get organized', 'Reduce recurring costs', 'Improve account security') }).min(1)
authRouter.patch('/profile', requireAuth, validate(profileBody), async (request, response) => {
  const body=request.body
  const goals=['Get organized','Reduce recurring costs','Improve account security']
  if(!body || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key=>!['name','workspaceGoal'].includes(key)) || ('name' in body && (typeof body.name!=='string'||body.name.trim().length<2||body.name.trim().length>80)) || ('workspaceGoal' in body && !goals.includes(body.workspaceGoal)))throw new AppError('Choose a valid display name and workspace focus.',400,'INVALID_PROFILE')
  const values={...('name' in body?{name:body.name.trim()}:{}),...('workspaceGoal' in body?{workspaceGoal:body.workspaceGoal}:{})}
  const user=await User.findOneAndUpdate({_id:request.auth.userId},{$set:values},{returnDocument:'after',runValidators:true})
  response.json({success:true,user:user.toJSON()})
})
const deleteAccountBody = Joi.object({ password: Joi.string().allow('').max(1024) })
authRouter.delete('/account', authRateLimiter, requireAuth, validate(deleteAccountBody), deleteAccount)

export default authRouter
