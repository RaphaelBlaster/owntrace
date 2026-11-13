// Pages TRACE may render inside its live preview panel. 'connect' is the read-only
// connections overview; its provider sub-flows (/connect/gmail, /connect/microsoft) and
// /settings (account deletion, provider revocation) stay privileged full-page routes.
const previewPages = ['dashboard', 'connect', 'accounts', 'subscriptions', 'orders', 'top-k', 'privacy-inbox', 'account-actions', 'privacy-health', 'breaches', 'exposures', 'identity', 'notifications']
function canPreviewPath(path) {
  return typeof path === 'string' && (previewPages.some((page) => path === `/${page}`) || /^\/accounts\/[a-f\d]{24}$/i.test(path))
}
function tracePreviewPath(location) {
  if(location.pathname.startsWith('/trace/view/')) {
    const path=location.pathname.slice('/trace/view'.length)
    return canPreviewPath(path)?path:null
  }
  const params=new URLSearchParams(location.search), view=params.get('panel'), entity=params.get('entity')
  const path=entity ? `/accounts/${entity}` : `/${view}`
  return view==='accounts' && entity && !/^[a-f\d]{24}$/i.test(entity) ? null : canPreviewPath(path) && (!entity || view==='accounts') ? path : null
}
const validChat = (chat) => typeof chat === 'string' && /^[\w-]{1,64}$/.test(chat)
// A privileged page opened from TRACE (e.g. /settings?chat=...) links back to the same conversation.
function returnToTrace(to, chat) {
  if (!validChat(chat) || typeof to === 'number') return to
  const raw = typeof to === 'string' ? to : to?.pathname ? `${to.pathname}${to.search || ''}${to.hash || ''}` : null
  if (!raw) return to
  const url = new URL(raw, 'https://owntrace.local')
  if (url.origin !== 'https://owntrace.local' || url.pathname !== '/trace' || url.searchParams.has('chat')) return to
  url.searchParams.set('chat', chat)
  if (typeof to === 'object') return { ...to, search: url.search, hash: url.hash }
  return url.pathname + url.search + url.hash
}
function workspaceDestination(to, embedded, chat) {
  if (typeof to === 'number') return to
  if (!embedded) return returnToTrace(to, chat)
  const path = typeof to === 'string' ? to : to?.pathname
  if (!path) return to
  const url = new URL(typeof to === 'string' ? to : `${path}${to.search || ''}${to.hash || ''}`, 'https://owntrace.local')
  if (!canPreviewPath(url.pathname) || url.origin !== 'https://owntrace.local') return to
  const entity=/^\/accounts\/([a-f\d]{24})$/i.exec(url.pathname)?.[1]
  url.searchParams.set('panel',entity?'accounts':url.pathname.slice(1))
  if(entity)url.searchParams.set('entity',entity)
  else url.searchParams.delete('entity')
  url.pathname = '/trace'
  if (chat) url.searchParams.set('chat', chat)
  if (typeof to === 'object') return { ...to, pathname: url.pathname, search: url.search, hash: url.hash }
  return url.pathname + url.search + url.hash
}
export { canPreviewPath, previewPages, workspaceDestination, tracePreviewPath }
