import { createContext, useContext } from 'react'
import { Link as RouterLink, NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom'

const EmbeddedWorkspaceContext = createContext(false)
const LegacyShellContext = createContext(false)
import { workspaceDestination } from './workspace-paths.js'
function useDestination(to) { return workspaceDestination(to, useContext(EmbeddedWorkspaceContext), new URLSearchParams(useLocation().search).get('chat')) }
function Link({ to, ...props }) { return <RouterLink {...props} to={useDestination(to)} /> }
function NavLink({ to, ...props }) { return <RouterNavLink {...props} to={useDestination(to)} /> }
function useWorkspaceNavigate() {
  const navigate = useNavigate()
  const embedded = useContext(EmbeddedWorkspaceContext)
  const chat = new URLSearchParams(useLocation().search).get('chat')
  return (to, options) => navigate(workspaceDestination(to, embedded, chat), options)
}
// Context, links and navigation hook intentionally share the same routing boundary.
// oxlint-disable-next-line react/only-export-components
export { EmbeddedWorkspaceContext, LegacyShellContext, Link, NavLink, useWorkspaceNavigate }
