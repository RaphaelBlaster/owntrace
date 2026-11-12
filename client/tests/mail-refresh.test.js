import test from 'node:test'
import assert from 'node:assert/strict'
import { createMailRefresher } from '../src/features/workspace/mail-refresh.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('the workspace refresh fires once on load and is debounced', async () => {
  let clock = 0, calls = 0
  const refresher = createMailRefresher({ request: async () => { calls += 1 }, now: () => clock })
  assert.equal(refresher.trigger(), true)
  await tick()
  assert.equal(refresher.trigger(), false)
  clock = 10_000
  assert.equal(refresher.trigger(), false)
  assert.equal(calls, 1)
})

test('it refreshes when the tab returns after more than a minute hidden, not sooner', async () => {
  let clock = 0, calls = 0
  const refresher = createMailRefresher({ request: async () => { calls += 1 }, now: () => clock })
  refresher.trigger(); await tick()
  clock = 100_000; refresher.hidden(); clock = 130_000
  assert.equal(refresher.visible(), false)
  refresher.hidden(); refresher.hidden(); clock = 200_000
  assert.equal(refresher.visible(), true)
  await tick()
  assert.equal(refresher.visible(), false)
  assert.equal(calls, 2)
})

test('request failures are swallowed and do not block later refreshes', async () => {
  let clock = 0, calls = 0
  const refresher = createMailRefresher({ request: async () => { calls += 1; throw new Error('offline') }, now: () => clock })
  refresher.trigger(); await tick()
  clock = 31_000
  assert.equal(refresher.trigger(), true)
  await tick()
  assert.equal(calls, 2)
})
