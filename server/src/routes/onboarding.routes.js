import { Router } from 'express'
import { getOnboarding, updateOnboarding } from '../controllers/onboarding.controller.js'
import Joi from 'joi'
import { validate } from '../middleware/error.middleware.js'
import requireAuth from '../middleware/auth.middleware.js'

const onboardingRouter = Router()

onboardingRouter.use(requireAuth)
onboardingRouter.get('/', getOnboarding)
const onboardingBody = Joi.object({ status: Joi.string().max(40).required() })
onboardingRouter.patch('/', validate(onboardingBody), updateOnboarding)

export default onboardingRouter
