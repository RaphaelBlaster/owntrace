import { expect, it } from 'vitest'
import { renderTraceMailAnswer } from '../src/services/trace-mail-answer.service.js'

it('renders exact saved counts and positive statuses without mistaking linked groups for all applications', () => {
  const answer = renderTraceMailAnswer([{ query: { category: 'jobs', kind: 'all' }, data: {
    counts: { messages: 80, applications: 4, applicationResults: 31, opportunities: 43, unresolved: 27, enrichmentPending: 23, currentStatuses: { interview: 3, assessment: 1, withdrawn: 3, unknown: 67 }, eventStatuses: { interview: 3, assessment: 1, withdrawn: 3, unknown: 73 } },
    pagination: { total: 74, page: 1, pages: 13 }, scan: { status: 'COMPLETED', processed: 250, limit: 250, enrichmentStatus: 'RUNNING', enrichmentProcessed: 175, unresolvedMessages: 27 },
    insights: [{ company: { name: null }, role: 'Engineer', status: 'interview', messageCount: 1, match: 'unresolved' }],
  } }])
  expect(answer).toContain('80 job-related emails')
  expect(answer).toContain('43 job recommendations')
  expect(answer).toContain('3 interview updates')
  expect(answer).toContain('1 assessment')
  expect(answer).toContain('still being analyzed')
  expect(answer).toContain('Engineer (company not identified): interview update')
  expect(answer).not.toMatch(/matching record groups|Historical saved events|Latest saved status|27 matching job|23 saved job/)
  expect(answer).not.toMatch(/confirmed|No rejections|No interview|4 applications|still being resolved|companyName|null/)
})

it('summarizes overlapping lookups once and keeps useful examples from the narrower query', () => {
  const data = { counts: { messages: 35, applications: 27, applicationResults: 35, opportunities: 0, unresolved: 8, currentStatuses: { application_received: 19, rejected: 5, interview: 4, assessment: 1, unknown: 6 }, eventStatuses: { application_received: 19, rejected: 5, interview: 4, assessment: 1, unknown: 6 } }, pagination: { total: 35, page: 1, pages: 6 }, scan: { status: 'COMPLETED', processed: 250, unresolvedMessages: 12 }, insights: [{ id: 'receipt', company: { name: 'Acme' }, role: 'Intern', status: 'application_received' }] }
  const assessment = { ...data, counts: { ...data.counts, messages: 1, currentStatuses: { assessment: 1 }, eventStatuses: { assessment: 1 } }, pagination: { total: 1, page: 1, pages: 1 }, insights: [{ id: 'assessment', company: { name: 'Contoso' }, role: 'Engineer', status: 'assessment' }] }
  const result = renderTraceMailAnswer([{ query: { category: 'jobs', kind: 'applications', status: '', search: '' }, data }, { query: { category: 'jobs', kind: 'applications', status: 'assessment', search: '' }, data: assessment }])
  expect(result).toContain('35 application-related emails')
  expect(result).toContain('19 application confirmations')
  expect(result).toContain('5 rejection updates')
  expect(result).toContain('4 interview updates')
  expect(result).toContain('Contoso — Engineer: assessment')
  expect(result.match(/I found/g)).toHaveLength(1)
  expect(result).not.toContain('27')
  expect(result.length).toBeLessThan(1100)
})
