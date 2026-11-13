import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EmbeddedWorkspaceContext } from '../workspace/workspace-navigation.jsx'
import { workspaceRoutes, WorkspaceRouteContent } from '../workspace/workspace-routes.jsx'
import { canPreviewPath, tracePreviewPath, workspaceDestination } from '../workspace/workspace-paths.js'

function TracePreview({ close }) {
  const location = useLocation()
  const navigate = useNavigate()
  const root = useRef(null)
  const [focusError, setFocusError] = useState('')
  const path = tracePreviewPath(location)?.slice(1) || ''
  const route=workspaceRoutes.find(route=>route.path===path || (route.path==='accounts/:id' && /^accounts\/[a-f\d]{24}$/i.test(path)))
  const title=route?.title || 'Workspace'
  useEffect(() => {
    setFocusError('')
    const params = new URLSearchParams(location.search)
    // A filtered Top K view opened by TRACE (e.g. search=IBM) highlights its first matching result.
    const topKMatch = path === 'top-k' && (params.get('search') || params.get('status')) ? '.ot-top-k-application' : null
    const target = params.get('focus') || (path.startsWith('accounts/') ? path.split('/')[1] : null)
    if (!topKMatch && (!target || !/^[a-f\d]{24}$/i.test(target))) return undefined
    let highlighted = null
    const focus = () => {
      const element = root.current?.querySelector(topKMatch && !target ? topKMatch : `[data-trace-entity="${target}"]`)
      if (!element) return false
      observer.disconnect(); clearTimeout(timeout)
      element.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
      // Filtered mail results stay outlined so the user can see exactly where the matches are.
      highlighted = topKMatch && !target ? [...root.current.querySelectorAll(topKMatch)] : [element]
      highlighted.forEach(item => item.classList.add('trace-entity-highlight'))
      return true
    }
    const observer = new MutationObserver(focus)
    const timeout = setTimeout(() => { observer.disconnect(); setFocusError('The requested item is no longer visible. Refresh the view or select another source.') }, 15000)
    observer.observe(root.current, { childList: true, subtree: true })
    focus()
    return () => { observer.disconnect(); clearTimeout(timeout); highlighted?.forEach(item => item.classList.remove('trace-entity-highlight')) }
  }, [location.pathname, location.search, path])
  return <section className="trace-preview" aria-label="Live OwnTrace dashboard preview">
    <header className="trace-preview-header"><span><i aria-hidden="true" /> Live workspace</span><strong>{title}</strong><button type="button" onClick={close} aria-label="Close dashboard preview">×</button></header>
    <nav className="trace-preview-navigation" aria-label="Dashboard preview pages"><select aria-label="Choose preview page" value={path.startsWith('accounts/') ? 'accounts' : path} onChange={(event) => navigate(workspaceDestination(`/${event.target.value}`,true,new URLSearchParams(location.search).get('chat')))}>{workspaceRoutes.filter((route) => canPreviewPath(`/${route.path}`)).map((route) => <option key={route.path} value={route.path}>{route.title}</option>)}</select><button type="button" onClick={() => { if (window.history.state?.idx > 0) navigate(-1); else close() }} aria-label="Go back">←</button><button type="button" onClick={() => navigate(1)} aria-label="Go forward">→</button></nav>
    {focusError ? <p className="trace-preview-notice" role="status">{focusError}</p> : null}
    <div className="trace-preview-content" ref={root}><EmbeddedWorkspaceContext value={true}>{route ? <WorkspaceRouteContent route={route} entityId={path.startsWith('accounts/')?path.split('/')[1]:undefined} /> : null}</EmbeddedWorkspaceContext></div>
  </section>
}
export default TracePreview
