import test from 'node:test'
import assert from 'node:assert/strict'
import { mailViewPath, readTopKQuery } from '../src/features/top-k/top-k-query.js'

test('an exact mail view round-trips filters, search and pagination without losing chat context', () => {
  const action = { type: 'show_mail_insights', category: 'jobs', kind: 'applications', status: 'rejected', search: 'Acme & Co', page: 2 }
  const path = mailViewPath(action)
  assert.deepEqual(readTopKQuery(new URL(path, 'https://owntrace.local').searchParams), { category: 'jobs', kind: 'applications', status: 'rejected', search: 'Acme & Co', page: 2, limit: 6 })
  assert.equal(mailViewPath({ ...action, url: 'https://evil.example' }), null)
  assert.equal(mailViewPath({ ...action, category: '../settings' }), null)
  assert.equal(mailViewPath({ ...action, page: 0 }), null)
})
test('all-category views and invalid public URL parameters have bounded defaults', () => {
  assert.equal(readTopKQuery(new URL(mailViewPath({ type: 'show_mail_insights', category: '', kind: 'all', status: '', search: '', page: 1 }), 'https://owntrace.local').searchParams).category, 'all')
  assert.deepEqual(readTopKQuery(new URLSearchParams('page=-2&limit=9999&kind=bad&status=https://evil')), { category: 'jobs', kind: 'all', status: '', search: '', page: 1, limit: 6 })
})
