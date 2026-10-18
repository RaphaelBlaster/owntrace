/* oxlint-disable react/only-export-components -- Shared navigation components and hooks use one routing boundary. */
import { useContext } from 'react'
import { Link as RouterLink, useNavigate as useRouterNavigate } from 'react-router-dom'
import { DemoContext } from './context.js'
import { Link as WorkspaceLink, useWorkspaceNavigate } from '../features/workspace/workspace-navigation.jsx'

const livePaths = { '': 'dashboard', actions: 'privacy-inbox', connections: 'connect', security: 'breaches', report: 'privacy-health', start: 'onboarding' }
export function prismPath(to) {
  if (typeof to !== 'string' || !/^\/demo(?:\/|\?|#|$)/.test(to)) return to
  return to.replace(/^\/demo(?:\/([^?#]*))?/, (_, path = '') => `/${livePaths[path] || path}`)
}
export function Link({ to, ...props }) {
  const live = useContext(DemoContext)?.live
  return live ? <WorkspaceLink {...props} to={prismPath(to)} /> : <RouterLink {...props} to={to} />
}
export function useNavigate() {
  const live = useContext(DemoContext)?.live
  const normal = useRouterNavigate(), workspace = useWorkspaceNavigate()
  return (to, options) => live ? workspace(prismPath(to), options) : normal(to, options)
}
export function usePrismPathname(pathname) {
  const live = useContext(DemoContext)?.live
  if (!live) return pathname
  const path = pathname.replace(/^\/trace\/view/, '')
  for (const [demo, real] of Object.entries(livePaths)) if (path === `/${real}`) return `/demo${demo ? '/' + demo : ''}`
  return `/demo${path}`
}
