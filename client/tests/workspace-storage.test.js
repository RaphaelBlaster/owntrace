import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreWorkspace } from '../src/demo/workspace-storage.js'

test('invalid or obsolete browser data recovers the sample workspace', () => {
  for (const raw of [null, 'broken json', 'null', '{"version":0}', '{"version":1,"actions":{"find":4},"accounts":4,"checks":{"secure-linkedin":"bad"}}']) {
    const saved = restoreWorkspace(raw)
    assert.equal(saved.accounts.length, 12)
    assert.equal(saved.actions.length, 4)
    assert.equal(saved.profile.name, 'Alex Morgan')
    assert.deepEqual(saved.checks['secure-linkedin'], [])
  }
})

test('restores decisions and checked steps without replacing source evidence', () => {
  const saved = restoreWorkspace(JSON.stringify({ version: 1, actions: [{ id: 'secure-linkedin', state: 'Done', decision: 'Protection reviewed' }], accounts: [{ id: 'dropbox', reviewed: true, status: 'Active', cost: 0 }], checks: { 'secure-linkedin': [0, 1, 2, 2, -1, 90, '0'] }, profile: { name: ' Sam ', goal: 'Reduce recurring costs', digest: false }, providers: { Gmail: false } }))
  assert.equal(saved.actions[0].state, 'Done')
  assert.equal(saved.actions[0].decision, 'Protection reviewed')
  const dropbox = saved.accounts.find(account => account.id === 'dropbox')
  assert.equal(dropbox.reviewed, true)
  assert.equal(dropbox.status, 'Dormant')
  assert.equal(dropbox.cost, 11.99)
  assert.deepEqual(saved.checks['secure-linkedin'], [0, 1, 2])
  assert.equal(saved.profile.name, 'Sam')
  assert.equal(saved.profile.digest, false)
  assert.equal(saved.providers.Gmail, false)
})

test('restores valid manual plans and rejects incomplete or duplicate records', () => {
  const plans = [{ id: 'sample-1', name: ' Design tool ', cost: 12.5, category: 'Creative' }, { id: 'sample-1', name: 'Duplicate', cost: 20 }, { id: 'sample-2', name: 'Broken', cost: 'NaN' }, { id: 'sample-3', name: ' ', cost: 1 }, { id: 'sample-4', name: 'Too costly', cost: 10001 }]
  const saved = restoreWorkspace(JSON.stringify({ version: 1, accounts: plans }))
  assert.equal(saved.accounts.length, 13)
  assert.equal(saved.accounts.at(-1).name, 'Design tool')
  assert.equal(saved.accounts.at(-1).cost, 12.5)
  assert.deepEqual(saved.accounts.at(-1).evidence, ['Manually entered sample'])
})
