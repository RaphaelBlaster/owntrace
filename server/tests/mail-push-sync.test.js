import mongoose from 'mongoose'
import { expect, it, vi } from 'vitest'
import { MailAnalysis } from '../src/models/mail-insight.model.js'
import { queuePushSync } from '../src/services/mail-push-sync.service.js'
import { startTopKScan } from '../src/services/top-k.service.js'
import { startSync as startGmailSync } from '../src/services/gmail-sync.service.js'
import { startSync as startMicrosoftSync } from '../src/services/microsoft-sync.service.js'

vi.mock('../src/services/top-k.service.js', () => ({ startTopKScan: vi.fn(async () => undefined) }))
vi.mock('../src/services/gmail-sync.service.js', () => ({ startSync: vi.fn(async () => ({})) }))
vi.mock('../src/services/microsoft-sync.service.js', () => ({ startSync: vi.fn(async () => ({})) }))

async function analysis(provider) {
  const userId = new mongoose.Types.ObjectId()
  await MailAnalysis.create({ userId, enabled: true, acceptedAt: new Date(), ...(provider ? { provider } : {}), status: 'COMPLETED' })
  return userId
}

it('routes a push from the analysed provider to Top K', async () => {
  const userId = await analysis('gmail')
  await expect(queuePushSync('gmail', userId)).resolves.toBe(true)
  expect(startTopKScan).toHaveBeenCalledWith(userId, 'gmail', { push: true })
  expect(startGmailSync).not.toHaveBeenCalled()
})

it('maps Microsoft pushes to the outlook analysis provider', async () => {
  const userId = await analysis('outlook')
  await queuePushSync('microsoft', userId)
  expect(startTopKScan).toHaveBeenCalledWith(userId, 'outlook', { push: true })
  expect(startMicrosoftSync).not.toHaveBeenCalled()
})

it('routes a push to Top K before the first scan has chosen a provider', async () => {
  const userId = await analysis(null)
  await queuePushSync('microsoft', userId)
  expect(startTopKScan).toHaveBeenCalledWith(userId, 'outlook', { push: true })
})

it('sends a push from the other provider to the metadata path without switching the analysis', async () => {
  const userId = await analysis('gmail')
  await expect(queuePushSync('microsoft', userId)).resolves.toBe(true)
  expect(startTopKScan).not.toHaveBeenCalled()
  expect(startMicrosoftSync).toHaveBeenCalledWith(userId, { trigger: 'push' })
  expect(await MailAnalysis.findOne({ userId })).toMatchObject({ provider: 'gmail', pushPending: false })
})

it('parks a push in pushPending when Top K reports a busy scan', async () => {
  const userId = await analysis('gmail')
  startTopKScan.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'MAIL_SCAN_BUSY' }))
  await queuePushSync('gmail', userId)
  expect(await MailAnalysis.findOne({ userId })).toMatchObject({ pushPending: true })
})
