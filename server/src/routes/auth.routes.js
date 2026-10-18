import { Router } from 'express'
import {
  deleteAccount,
  login,
  logout,
  me,
  register,
  session,
} from '../controllers/auth.controller.js'
import requireAuth from '../middleware/auth.middleware.js'
import { authRateLimiter } from '../middleware/security.middleware.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'

const authRouter = Router()

authRouter.post('/register', authRateLimiter, register)
authRouter.post('/login', authRateLimiter, login)
authRouter.post('/logout', logout)
authRouter.get('/session', session)
authRouter.get('/me', requireAuth, me)
authRouter.patch('/profile', requireAuth, async (request, response) => {
  const body=request.body
  const goals=['Get organized','Reduce recurring costs','Improve account security']
  if(!body || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key=>!['name','workspaceGoal'].includes(key)) || ('name' in body && (typeof body.name!=='string'||body.name.trim().length<2||body.name.trim().length>80)) || ('workspaceGoal' in body && !goals.includes(body.workspaceGoal)))throw new AppError('Choose a valid display name and workspace focus.',400,'INVALID_PROFILE')
  const values={...('name' in body?{name:body.name.trim()}:{}),...('workspaceGoal' in body?{workspaceGoal:body.workspaceGoal}:{})}
  const user=await User.findOneAndUpdate({_id:request.auth.userId},{$set:values},{returnDocument:'after',runValidators:true})
  response.json({success:true,user:user.toJSON()})
})
authRouter.delete('/account', authRateLimiter, requireAuth, deleteAccount)

export default authRouter
