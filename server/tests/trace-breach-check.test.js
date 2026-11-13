import { expect, it } from 'vitest'
import mongoose from 'mongoose'
import BreachReport from '../src/models/breach-report.model.js'
import { executeTraceTool } from '../src/services/trace-tools.service.js'
import { XPOSED_OR_NOT_PROVIDER } from '../src/services/xposed-or-not.service.js'

it('gives TRACE the saved XposedOrNot verified breach check for leak questions', async () => {
  const userId = new mongoose.Types.ObjectId()
  const empty = await executeTraceTool(String(userId), 'privacy_overview', { section: 'security', page: 1 })
  expect(empty.data.verifiedBreachCheck.provider.status).toBe('NOT_CHECKED')
  const now = new Date()
  await BreachReport.create({ userId, provider: XPOSED_OR_NOT_PROVIDER, breaches: [{ name: 'Canva' }, { name: 'LinkedIn' }], lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + 86400000) })
  const found = await executeTraceTool(String(userId), 'privacy_overview', { section: 'security', page: 1 })
  expect(found.data.verifiedBreachCheck.provider.status).toBe('BREACHES_FOUND')
  expect(found.data.verifiedBreachCheck.breaches).toEqual([{ name: 'Canva' }, { name: 'LinkedIn' }])
  expect(found.sources[0].action).toEqual({ type: 'navigate_to_page', page: 'breaches' })
})
