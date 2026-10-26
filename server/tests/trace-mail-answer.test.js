import { expect, it } from 'vitest'
import { renderTraceMailAnswer } from '../src/services/trace-mail-answer.service.js'

it('renders exact saved counts and positive statuses without mistaking linked groups for all applications', () => {
  const answer = renderTraceMailAnswer([{ query: { category: 'jobs', kind: 'all' }, data: {
    counts: { messages: 80, applications: 4, applicationResults: 31, opportunities: 43, unresolved: 27, enrichmentPending: 23, currentStatuses: { interview: 3, assessment: 1, withdrawn: 3, unknown: 67 }, eventStatuses: { interview: 3, assessment: 1, withdrawn: 3, unknown: 73 } },
    pagination: { total: 74, page: 1, pages: 13 }, scan: { status: 'COMPLETED', processed: 250, limit: 250, enrichmentStatus: 'RUNNING', enrichmentProcessed: 175, unresolvedMessages: 27 },
    insights: [{ company: { name: null }, role: 'Engineer', status: 'interview', messageCount: 1, match: 'unresolved' }],
  } }])
  expect(answer).toContain('74 matching record groups from 80 messages')
  expect(answer).toContain('4 groups are linked')
  expect(answer).toContain('31 matching groups contain application-related updates; 43 are opportunity alerts')
  expect(answer).toContain('Interview: 3; Assessment: 1; Withdrawn: 3')
  expect(answer).toContain('23 saved job messages have not received')
  expect(answer).toContain('Company not identified — Engineer: Interview')
  expect(answer).toContain('page 1 of 13 (1 of 74 matching groups)')
  expect(answer).not.toMatch(/confirmed|No rejections|No interview|4 applications|still being resolved|companyName|null/)
})
