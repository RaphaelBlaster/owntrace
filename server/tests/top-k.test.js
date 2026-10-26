import { expect, it } from 'vitest'
import { rankCategories } from '../src/services/top-k.service.js'
import request from 'supertest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import { MailAnalysis, MailInsight } from '../src/models/mail-insight.model.js'
import { encryptSecret } from '../src/utils/encryption.js'

it('ranks recent actionable jobs above old orders and excludes promotion volume', () => {
  const now = new Date('2026-10-26T00:00:00Z')
  const rows = [
    { category: 'jobs', occurredAt: now, importance: 3, actionRequired: true, title: 'Interview' },
    { category: 'orders', occurredAt: new Date('2026-10-01'), importance: 1, actionRequired: false },
    ...Array.from({ length: 100 }, () => ({ category: 'marketing', occurredAt: now, importance: 3, actionRequired: true })),
  ]
  const result = rankCategories(rows, 3, now)
  expect(result.topCategories).toEqual(['jobs', 'orders'])
  expect(result.categories.find(x => x.category === 'marketing').count).toBe(100)
})

it('changes ranked categories with the rolling input and honors K', () => {
  const now = new Date()
  const rows = ['social', 'finance', 'security'].map(category => ({ category, occurredAt: now, importance: 2 }))
  expect(rankCategories(rows, 1, now).topCategories).toHaveLength(1)
  expect(rankCategories([{ category: 'jobs', occurredAt: now, importance: 3 }], 3, now).topCategories).toEqual(['jobs'])
  expect(rankCategories([], 3, now).topCategories).toEqual([])
})

it('requires authentication and body consent and scopes results to the current user/run', async () => {
  await request(app).get('/api/top-k').expect(401)
  const agent = request.agent(app)
  await agent.post('/api/auth/register').send({ name: 'Top K Tester', email: 'topk@example.com', password: 'StrongPass123!' }).expect(201)
  const user = await User.findOne({ email: 'topk@example.com' })
  await agent.post('/api/top-k/scans').send({ provider: 'gmail' }).expect(403)
  await agent.put('/api/top-k/consent').send({ enabled: true, version: 1 }).expect(200)
  await MailAnalysis.updateOne({ userId: user.id }, { $set: { runId: 'current', status: 'COMPLETED', processed: 250 } })
  const common = { provider: 'gmail', connectionId: user._id, fingerprint: 'sample', category: 'jobs', title: 'Application received', occurredAt: new Date(), analyzedBy: 'mercury' }
  await MailInsight.create([
    { ...common, userId: user.id, runId: 'current', messageHash: 'current' },
    { ...common, userId: user.id, runId: 'older', messageHash: 'older' },
    { ...common, userId: new user.constructor()._id, runId: 'current', messageHash: 'foreign' },
  ])
  const response = await agent.get('/api/top-k?k=3').expect(200)
  expect(response.body.categories.find(x => x.category === 'jobs').count).toBe(1)
  expect(response.body.analysis.processed).toBe(250)
  expect(JSON.stringify(response.body)).not.toContain('messageHash')
  await agent.get('/api/top-k?k=9').expect(400)
  await agent.put('/api/top-k/consent').send({ enabled: false, version: 1 }).expect(200)
})

it('requires an expanded body grant while preserving the existing connection', async () => {
  const agent = request.agent(app)
  await agent.post('/api/auth/register').send({ name: 'Mailbox Tester', email: 'bodytopk@example.com', password: 'StrongPass123!' }).expect(201)
  const user = await User.findOne({ email: 'bodytopk@example.com' })
  await GoogleConnection.create({ userId: user.id, email: 'mail@example.com', googleAccountId: 'top-k-google', scopes: ['https://www.googleapis.com/auth/gmail.metadata'], encryptedAccessToken: encryptSecret('access'), encryptedRefreshToken: encryptSecret('refresh'), tokenExpiresAt: new Date(Date.now() + 3600000) })
  const state = await agent.get('/api/top-k').expect(200)
  expect(state.body.connections.find(x => x.provider === 'gmail')).toMatchObject({ connected: true, bodyAccess: false })
  expect(await GoogleConnection.countDocuments({ userId: user.id })).toBe(1)
})
