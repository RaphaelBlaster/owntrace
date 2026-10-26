import { expect, it } from 'vitest'
import mongoose from 'mongoose'
import { groupMailInsights, paginateInsights, queryMailInsights } from '../src/services/mail-insight-query.service.js'
import { MailAnalysis, MailInsight } from '../src/models/mail-insight.model.js'

const event = (id, overrides = {}) => ({ _id: id, category: 'jobs', companyName: 'GE Vernova', roleName: 'Software Engineer Intern', eventKind: 'application', applicationReference: 'APP-123', referenceType: 'application', status: 'application_received', occurredAt: new Date('2026-10-01'), importance: 2, summary: 'Application received', evidence: 'Your application was received', senderDomain: 'myworkday.com', ...overrides })
it('groups one application across threads and preserves chronological updates', () => {
  const groups = groupMailInsights([event('3', { status: 'rejected', occurredAt: new Date('2026-10-03') }), event('1'), event('2', { status: 'interview', occurredAt: new Date('2026-10-02') })])
  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ status: 'rejected', messageCount: 3, company: { name: 'GE Vernova', domain: 'gevernova.com' }, match: 'reference' })
  expect(groups[0].events.map(x => x.status)).toEqual(['application_received', 'interview', 'rejected'])
})
it('does not merge different roles or references at the same employer', () => {
  const groups = groupMailInsights([event('1'), event('2', { applicationReference: 'APP-456', roleName: 'Data Engineer' }), event('3', { companyName: 'Amazon', applicationReference: 'APP-123' })])
  expect(groups).toHaveLength(3)
})
it('keeps opportunities and unsupported company-only matches separate', () => {
  const groups = groupMailInsights([event('1', { applicationReference: null, threadHash: 'thread-a' }), event('2', { applicationReference: null, threadHash: 'thread-b' }), event('3', { eventKind: 'opportunity', status: 'unknown', applicationReference: null })])
  expect(groups).toHaveLength(3)
  expect(groups.filter(x => x.kind === 'opportunity')).toHaveLength(1)
  expect(groups.find(x => x.kind === 'opportunity').status).toBe('unknown')
})
it('does not use an ATS sender as the employer', () => {
  const [group] = groupMailInsights([event('1', { companyName: null, companyDomain: null, applicationReference: null })])
  expect(group.company).toMatchObject({ name: null, domain: null, logoUrl: null })
  expect(group.match).toBe('unresolved')
})

it('does not merge conflicting roles even when the model extracted the same application reference', () => {
  const groups = groupMailInsights([event('1'), event('2', { roleName: 'Data Engineer' }), event('3', { roleName: null })])
  expect(groups).toHaveLength(3)
  expect(groups.find(group => group.role === null).match).toBe('unresolved')
})

it('filters before pagination and reports application totals separately from message totals', () => {
  const groups = groupMailInsights([event('1'), event('2', { status: 'rejected', occurredAt: new Date('2026-10-02') }), event('3', { applicationReference: 'APP-2', roleName: 'Data Engineer', status: 'rejected' }), event('4', { eventKind: 'opportunity', status: 'unknown' })])
  const page = paginateInsights(groups, { kind: 'applications', status: 'rejected', search: 'engineer', page: 2, limit: 1 })
  expect(page.insights).toHaveLength(1)
  expect(page.pagination).toEqual({ page: 2, limit: 1, total: 2, pages: 2 })
  expect(page.counts).toMatchObject({ messages: 3, applications: 2, opportunities: 0 })
  expect(paginateInsights(groups).counts).toMatchObject({ unresolved: 0, opportunities: 1 })
})

it('reports full saved status distributions even when a rejection is outside the returned page', () => {
  const groups = groupMailInsights([
    event('old', { status: 'rejected', occurredAt: new Date('2026-10-01') }),
    event('new', { status: 'application_received', occurredAt: new Date('2026-10-02') }),
    event('visible', { applicationReference: 'APP-456', occurredAt: new Date('2026-10-03') }),
  ])
  const result = paginateInsights(groups, { kind: 'applications', limit: 1 })
  expect(result.insights).toHaveLength(1)
  expect(result.insights[0].events.some(item => item.status === 'rejected')).toBe(false)
  expect(result.counts.currentStatuses).toEqual({ application_received: 2 })
  expect(result.counts.eventStatuses).toEqual({ application_received: 2, rejected: 1 })
})

it('queries only the signed-in user and current run, with pending enrichment coverage', async () => {
  const userId = new mongoose.Types.ObjectId(), otherUser = new mongoose.Types.ObjectId(), connectionId = new mongoose.Types.ObjectId()
  await MailAnalysis.create({ userId, runId: 'current', status: 'COMPLETED', processed: 250, enrichmentStatus: 'RUNNING', enrichmentProcessed: 50 })
  const base = { provider: 'gmail', connectionId, fingerprint: 'test', analyzedBy: 'mercury', ...event(undefined) }
  delete base._id
  await MailInsight.create([
    { ...base, userId, runId: 'current', messageHash: 'current', enrichmentVersion: 1 },
    { ...base, userId, runId: 'stale', messageHash: 'stale' },
    { ...base, userId: otherUser, runId: 'current', messageHash: 'other' },
  ])
  const result = await queryMailInsights(userId)
  expect(result.insights).toHaveLength(1)
  expect(result.counts).toMatchObject({ messages: 1, applications: 1, enrichmentPending: 1 })
  expect(result.scan).toMatchObject({ status: 'COMPLETED', processed: 250, enrichmentStatus: 'RUNNING', enrichmentProcessed: 50 })
})

it('keeps the previous saved results visible during refresh, then uses only the completed run', async () => {
  const userId = new mongoose.Types.ObjectId(), connectionId = new mongoose.Types.ObjectId()
  await MailAnalysis.create({ userId, connectionId, runId: 'refresh', previousRunId: 'saved', status: 'RUNNING', processed: 1 })
  const base = { userId, provider: 'gmail', connectionId, fingerprint: 'test', analyzedBy: 'mercury', ...event(undefined) }
  delete base._id
  await MailInsight.create([
    { ...base, runId: 'saved', messageHash: 'receipt', applicationReference: 'APP-1' },
    { ...base, runId: 'refresh', messageHash: 'rejection', applicationReference: 'APP-1', status: 'rejected', occurredAt: new Date('2026-10-03') },
    { ...base, runId: 'unrelated-old', messageHash: 'other', applicationReference: 'APP-2' },
  ])
  const refreshing = await queryMailInsights(userId)
  expect(refreshing.counts.messages).toBe(2)
  expect(refreshing.insights[0]).toMatchObject({ status: 'rejected', messageCount: 2 })
  await MailAnalysis.updateOne({ userId }, { $set: { status: 'COMPLETED' } })
  expect((await queryMailInsights(userId)).counts.messages).toBe(1)
})
