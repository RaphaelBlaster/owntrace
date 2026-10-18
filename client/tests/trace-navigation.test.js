import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceDestination, tracePreviewPath } from '../src/features/workspace/workspace-paths.js'

test('TRACE navigation accepts only structured known destinations', async () => {
  const { actionDestination } = await import('../src/features/trace/trace-navigation.js')
  assert.equal(actionDestination({ type: 'open_account', accountId: 'a'.repeat(24) }), `/trace?panel=accounts&entity=${'a'.repeat(24)}`)
  assert.equal(actionDestination({ type: 'show_subscriptions' }), '/trace?panel=subscriptions')
  assert.equal(actionDestination({type:'close_preview'}),'/trace')
  assert.equal(actionDestination({type:'navigate_to_page',page:'orders'}),'/trace?panel=orders')
  assert.equal(actionDestination({type:'open_order',orderId:'c'.repeat(24)}),`/trace?focus=${'c'.repeat(24)}&panel=orders`)
  assert.equal(actionDestination({type:'open_order',orderId:'../foreign'}),null)
  assert.equal(actionDestination({ type: 'navigate_to_page', page: 'settings' }), '/settings')
  assert.equal(actionDestination({ type: 'navigate_to_page', page: 'https://example.com' }), null)
  assert.equal(actionDestination({ type: 'open_account', accountId: '../other-user' }), null)
  assert.equal(actionDestination({ type: 'focus_entity', entityType: 'subscription', entityId: 'b'.repeat(24), page: 3 }), `/trace?page=3&focus=${'b'.repeat(24)}&panel=subscriptions`)
})
test('pane links preserve chat and relevant target query/hash/state; privileged flows exit normally', () => {
  assert.equal(workspaceDestination('/accounts?search=Spotify#evidence', true, 'owned'), '/trace?search=Spotify&panel=accounts&chat=owned#evidence')
  assert.equal(workspaceDestination('/connect/gmail', true, 'owned'), '/connect/gmail')
  assert.equal(workspaceDestination('/settings', true, 'owned'), '/settings')
  assert.equal(workspaceDestination('/accounts', false, 'owned'), '/accounts')
  const state = { from: 'test' }
  assert.deepEqual(workspaceDestination({ pathname: '/accounts', search: '?page=2', state }, true, 'owned'), { pathname: '/trace', search: '?page=2&panel=accounts&chat=owned', hash: '', state })
  assert.equal(tracePreviewPath({pathname:'/trace',search:`?panel=accounts&entity=${'a'.repeat(24)}`}),`/accounts/${'a'.repeat(24)}`)
  assert.equal(tracePreviewPath({pathname:'/trace',search:'?panel=https://example.com'}),null)
  assert.equal(tracePreviewPath({pathname:'/trace',search:'?panel=accounts&entity=../other'}),null)
  assert.equal(tracePreviewPath({pathname:'/trace/view/subscriptions',search:''}),'/subscriptions')
})
