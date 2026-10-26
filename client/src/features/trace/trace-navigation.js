const pages = new Set(['dashboard', 'accounts', 'subscriptions', 'orders', 'top-k', 'privacy-inbox', 'account-actions', 'privacy-health', 'breaches', 'exposures', 'connect', 'settings'])
const validId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)
function actionDestination(action) {
  if (!action || typeof action !== 'object') return null
  if(action.type==='close_preview')return '/trace'
  if (action.type === 'navigate_to_page' && pages.has(action.page)) return workspaceDestination(`/${action.page}`,true)
  if (action.type === 'show_subscriptions') return workspaceDestination('/subscriptions',true)
  if (action.type === 'open_order' && validId(action.orderId)) return workspaceDestination(`/orders?focus=${action.orderId}`,true)
  if (action.type === 'open_account' && validId(action.accountId)) return workspaceDestination(`/accounts/${action.accountId}`,true)
  if (action.type === 'focus_entity' && validId(action.entityId)) {
    if (action.entityType === 'account') return workspaceDestination(`/accounts/${action.entityId}`,true)
    if (action.entityType === 'subscription' && Number.isInteger(action.page) && action.page >= 1 && action.page <= 10000) return workspaceDestination(`/subscriptions?page=${action.page}&focus=${action.entityId}`,true)
  }
  return null
}
export { actionDestination }
import { workspaceDestination } from '../workspace/workspace-paths.js'
