import { beforeEach, expect, it, vi } from 'vitest'
import User from '../src/models/user.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import { MailAnalysis, MailInsight } from '../src/models/mail-insight.model.js'
import { processTopKPage, processMailEnrichmentPage, queueMailEnrichment, startTopKScan, stopTopK } from '../src/services/top-k.service.js'
import { fetchOrderPage, hashOrderValue } from '../src/services/order-mail.service.js'
import { fetchMailBody } from '../src/services/mail-body.service.js'
import { gateMessages, categorizeMessages } from '../src/services/mail-intelligence.service.js'

vi.mock('../src/services/order-mail.service.js', async original => ({ ...await original(), fetchOrderPage: vi.fn() }))
vi.mock('../src/services/mail-body.service.js', () => ({ canReadMailBody: (_provider, c) => Boolean(c?.scopes.includes('body')), fetchMailBody: vi.fn() }))
vi.mock('../src/services/mail-intelligence.service.js', () => ({
  intelligenceConfigured: () => true,
  MAIL_ENRICHMENT_VERSION: 2,
  sanitizeMailMetadata: message => ({ senderDomain: message.senderDomain, subject: message.subject, occurredAt: message.occurredAt }),
  sanitizeMailBody: text => text.replace('SECRET_EMAIL_BODY', '[redacted]'),
  gateMessages: vi.fn(),
  categorizeMessages: vi.fn(async inputs => inputs.map(() => ({ category: 'jobs', title: 'Application received', status: 'application_received', summary: 'Your application was received.', evidence: 'Application received.', importance: 2, actionRequired: false }))),
}))

async function fixture() {
  const user = await User.create({ name: 'Mail Tester', email: 'worker@example.com', passwordHash: 'test-hash' })
  const connection = await GoogleConnection.create({ userId: user.id, email: 'worker@example.com', googleAccountId: 'worker-google', scopes: ['body'], encryptedAccessToken: 'encrypted', encryptedRefreshToken: 'encrypted', tokenExpiresAt: new Date(Date.now() + 3600000) })
  const scan = await MailAnalysis.create({ userId: user.id, provider: 'gmail', connectionId: connection.id, enabled: true, acceptedAt: new Date(), runId: 'worker-run', status: 'QUEUED', until: new Date(), processed: 0 })
  return { user, connection, scan }
}
beforeEach(() => {
  fetchOrderPage.mockImplementation(async scan => ({ cursor: 'more', messages: Array.from({ length: Math.min(25, scan.limit - scan.processed) }, (_, i) => ({ providerId: `message-${scan.processed + i}`, senderDomain: 'jobs.example.com', subject: i % 2 ? 'Sale' : 'Application received', occurredAt: '2026-10-25T00:00:00Z' })) }))
  gateMessages.mockImplementation(async inputs => inputs.map(input => input.subject === 'Sale' ? 'marketing' : 'eligible'))
  fetchMailBody.mockResolvedValue('Application received. SECRET_EMAIL_BODY')
})

it('stops at 250 messages and reads bodies only for Jev-passed mail without storing raw bodies', async () => {
  const { scan } = await fixture()
  for (let i = 0; i < 11; i++) await processTopKPage(scan.id)
  const saved = await MailAnalysis.findById(scan.id)
  expect(saved).toMatchObject({ processed: 250, status: 'COMPLETED' })
  expect(fetchOrderPage).toHaveBeenCalledTimes(10)
  expect(fetchMailBody).toHaveBeenCalledTimes(130)
  expect(typeof fetchMailBody.mock.calls[0][0].connectionId).toBe('string')
  expect(await MailInsight.countDocuments()).toBe(250)
  const docs = await MailInsight.find().lean()
  expect(docs.filter(x => x.category === 'marketing')).toHaveLength(120)
  expect(JSON.stringify(docs)).not.toContain('SECRET_EMAIL_BODY')
  expect(docs.some(x => Object.hasOwn(x, 'body'))).toBe(false)
})

it('cancels in-flight work and prevents later writes', async () => {
  const { scan, user } = await fixture()
  let entered
  const started = new Promise(resolve => { entered = resolve })
  fetchMailBody.mockImplementationOnce((_scope, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); entered() }))
  const work = processTopKPage(scan.id)
  await started
  await stopTopK(user.id, 'gmail')
  await work
  expect((await MailAnalysis.findById(scan.id)).status).toBe('CANCELLED')
  expect(await MailInsight.countDocuments()).toBe(0)
})

it('keeps the cursor and counts on model failure', async () => {
  const { scan } = await fixture()
  await MailAnalysis.updateOne({ _id: scan.id }, { $set: { cursor: 'saved-page', processed: 25 } })
  gateMessages.mockRejectedValueOnce(Object.assign(new Error('Provider failed'), { code: 'MAIL_AI_UNAVAILABLE' }))
  await processTopKPage(scan.id)
  const result = await MailAnalysis.findById(scan.id).select('+cursor')
  expect(result).toMatchObject({ status: 'FAILED', cursor: 'saved-page', processed: 25, lastErrorCode: 'MAIL_AI_UNAVAILABLE' })
  expect(await MailInsight.countDocuments()).toBe(0)
})

it('resumes a failed run without restarting or discarding its checkpoint', async () => {
  const { scan, user } = await fixture()
  await MailAnalysis.updateOne({ _id: scan.id }, { $set: { status: 'FAILED', cursor: 'page-9', processed: 200, lastErrorCode: 'MAIL_AI_INVALID' } })
  await startTopKScan(user.id, 'gmail')
  const resumed = await MailAnalysis.findById(scan.id).select('+cursor')
  expect(resumed).toMatchObject({ status: 'QUEUED', processed: 200, cursor: 'page-9', runId: 'worker-run', lastErrorCode: null })
})

async function enrichmentFixture() {
  const fixtureData = await fixture()
  const { user, scan, connection } = fixtureData
  await MailAnalysis.updateOne({ _id: scan.id }, { $set: { status: 'COMPLETED', processed: 250, cursor: 'original-cursor', enrichmentStatus: 'QUEUED' } })
  const card = await MailInsight.create({ userId: user.id, provider: 'gmail', connectionId: connection.id, messageHash: hashOrderValue(user.id, 'gmail', connection.id, 'message-0'), fingerprint: 'old', runId: scan.runId, category: 'jobs', title: 'Old application', status: 'application_received', summary: 'Saved evidence', occurredAt: new Date(), analyzedBy: 'mercury', enrichmentVersion: 1 })
  return { ...fixtureData, card }
}

it('remembers the completed run when a notification starts the next refresh', async () => {
  const { user, scan } = await fixture()
  await MailAnalysis.updateOne({ _id: scan.id }, { $set: { status: 'COMPLETED', processed: 250 } })
  await startTopKScan(user.id, 'gmail', { push: true, followUp: true })
  expect(await MailAnalysis.findById(scan.id)).toMatchObject({ previousRunId: 'worker-run', status: 'QUEUED', processed: 0 })
})

it('enriches only existing legacy job cards and preserves the completed scan checkpoint', async () => {
  const { scan, card } = await enrichmentFixture()
  await processMailEnrichmentPage(scan.id)
  const result = await MailAnalysis.findById(scan.id).select('+cursor +enrichmentCursor')
  expect(result).toMatchObject({ status: 'COMPLETED', processed: 250, runId: 'worker-run', cursor: 'original-cursor', enrichmentStatus: 'QUEUED', enrichmentProcessed: 25, enrichmentCursor: 'more' })
  expect(fetchMailBody).toHaveBeenCalledTimes(1)
  expect(gateMessages).not.toHaveBeenCalled()
  expect(await MailInsight.countDocuments()).toBe(1)
  expect(await MailInsight.findById(card.id)).toMatchObject({ enrichmentVersion: 2, title: 'Application received' })
})

it('retains legacy evidence and pending enrichment when the model cannot validate a card', async () => {
  const { scan, card } = await enrichmentFixture()
  categorizeMessages.mockResolvedValueOnce([null])
  await processMailEnrichmentPage(scan.id)
  expect(await MailInsight.findById(card.id)).toMatchObject({ enrichmentVersion: 1, title: 'Old application', summary: 'Saved evidence' })
})

it('cancels enrichment without cancelling the already-completed scan or writing partial cards', async () => {
  const { scan, user, card } = await enrichmentFixture()
  let entered
  const started = new Promise(resolve => { entered = resolve })
  fetchMailBody.mockImplementationOnce((_scope, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); entered() }))
  const work = processMailEnrichmentPage(scan.id)
  await started
  await stopTopK(user.id, 'gmail')
  await work
  expect(await MailAnalysis.findById(scan.id)).toMatchObject({ status: 'COMPLETED', processed: 250, enrichmentStatus: 'CANCELLED', pushPending: false })
  expect(await MailInsight.findById(card.id)).toMatchObject({ enrichmentVersion: 1, title: 'Old application' })
})

it('keeps notifications arriving during enrichment and schedules one follow-up after it finishes', async () => {
  const { scan, user } = await enrichmentFixture()
  await MailAnalysis.updateOne({ _id: scan.id }, { $set: { enrichmentProcessed: 225 } })
  fetchOrderPage.mockImplementationOnce(async () => {
    await startTopKScan(user.id, 'gmail', { push: true })
    return { cursor: null, messages: [] }
  })
  await processMailEnrichmentPage(scan.id)
  expect(await MailAnalysis.findById(scan.id)).toMatchObject({ status: 'QUEUED', processed: 0, enrichmentStatus: 'COMPLETED', pushPending: false })
})

it('resumes failed enrichment without changing its checkpoint', async () => {
  const { scan, user } = await enrichmentFixture()
  await MailAnalysis.updateOne({ _id: scan.id }, { $set: { enrichmentStatus: 'FAILED', enrichmentProcessed: 200, enrichmentCursor: 'saved-enrichment' } })
  await queueMailEnrichment(user.id)
  expect(await MailAnalysis.findById(scan.id).select('+enrichmentCursor')).toMatchObject({ status: 'COMPLETED', processed: 250, enrichmentStatus: 'QUEUED', enrichmentProcessed: 200, enrichmentCursor: 'saved-enrichment' })
})

it('does not mistake a schema default for stored enrichment on legacy cached mail', async () => {
  const { scan, user, connection } = await fixture()
  const input = { senderDomain: 'jobs.example.com', subject: 'Application received', occurredAt: '2026-10-25T00:00:00Z' }
  const card = await MailInsight.create({ userId: user.id, provider: 'gmail', connectionId: connection.id, messageHash: hashOrderValue(user.id, 'gmail', connection.id, 'message-0'), fingerprint: hashOrderValue(user.id, 'gmail', connection.id, JSON.stringify(input)), runId: 'old-run', category: 'jobs', title: 'Old application', occurredAt: new Date(input.occurredAt), analyzedBy: 'mercury' })
  await MailInsight.collection.updateOne({ _id: card._id }, { $unset: { enrichmentVersion: '' } })
  await processTopKPage(scan.id)
  expect(fetchMailBody).toHaveBeenCalledTimes(13)
  expect(await MailInsight.findById(card.id)).toMatchObject({ enrichmentVersion: 2, title: 'Application received', runId: 'worker-run' })
})

it('retries explicit invalid-output fallback cards despite an old version-two cache marker', async () => {
  const { scan, user, connection } = await fixture()
  const input = { senderDomain: 'jobs.example.com', subject: 'Application received', occurredAt: '2026-10-25T00:00:00Z' }
  const card = await MailInsight.create({ userId: user.id, provider: 'gmail', connectionId: connection.id, messageHash: hashOrderValue(user.id, 'gmail', connection.id, 'message-0'), fingerprint: hashOrderValue(user.id, 'gmail', connection.id, JSON.stringify(input)), runId: 'old-run', category: 'other', title: 'Needs review', evidence: '', occurredAt: new Date(input.occurredAt), analyzedBy: 'mercury', enrichmentVersion: 2 })
  await processTopKPage(scan.id)
  expect(fetchMailBody).toHaveBeenCalledTimes(13)
  expect(await MailInsight.findById(card.id)).toMatchObject({ category: 'jobs', title: 'Application received', evidence: 'Application received.' })
})

it('includes invalid-output fallback cards in bounded enrichment but leaves valid non-job evidence alone', async () => {
  const { scan, user, connection, card } = await enrichmentFixture()
  await MailInsight.updateOne({ _id: card.id }, { $set: { category: 'other', title: 'Needs review', evidence: '', enrichmentVersion: 2 } })
  await MailInsight.create({ userId: user.id, provider: 'gmail', connectionId: connection.id, messageHash: hashOrderValue(user.id, 'gmail', connection.id, 'message-2'), fingerprint: 'valid-other', runId: scan.runId, category: 'other', title: 'Project update', evidence: 'Project completed', occurredAt: new Date(), analyzedBy: 'mercury', enrichmentVersion: 2 })
  await processMailEnrichmentPage(scan.id)
  expect(fetchMailBody).toHaveBeenCalledTimes(1)
  expect(await MailInsight.findById(card.id)).toMatchObject({ category: 'jobs', title: 'Application received', enrichmentVersion: 2 })
  expect(await MailInsight.findOne({ fingerprint: 'valid-other' })).toMatchObject({ title: 'Project update', evidence: 'Project completed' })
})

it('preserves an earlier supported card when a new analysis response is invalid', async () => {
  const { scan, user, connection } = await fixture()
  const card = await MailInsight.create({ userId: user.id, provider: 'gmail', connectionId: connection.id, messageHash: hashOrderValue(user.id, 'gmail', connection.id, 'message-0'), fingerprint: 'old-input', runId: 'old-run', category: 'jobs', title: 'Supported application', evidence: 'Saved application evidence', occurredAt: new Date(), analyzedBy: 'mercury', enrichmentVersion: 1 })
  categorizeMessages.mockImplementationOnce(async inputs => inputs.map(() => null))
  await processTopKPage(scan.id)
  expect(await MailInsight.findById(card.id)).toMatchObject({ title: 'Supported application', evidence: 'Saved application evidence', fingerprint: 'old-input', enrichmentVersion: 1, runId: scan.runId })
})
