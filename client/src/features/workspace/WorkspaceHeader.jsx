import { useState } from 'react'
import { Link, NavLink, useWorkspaceNavigate as useNavigate } from '../workspace/workspace-navigation.jsx'
import useAuth from '../auth/useAuth.js'
import './workspace.css'

function WorkspaceHeader() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState('')

  async function handleLogout() {
    setIsSigningOut(true)
    setError('')
    try {
      await logout()
      navigate('/', { replace: true })
    } catch {
      setError('OwnTrace could not sign you out. Try again.')
      setIsSigningOut(false)
    }
  }

  return (
    <header className="workspace-header">
      <Link className="workspace-brand" to="/">OwnTrace</Link>
      <nav aria-label="OwnTrace workspace">
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/accounts">Accounts</NavLink>
        <NavLink to="/identity">Identity</NavLink>
        <NavLink to="/account-actions">Actions</NavLink>
        <NavLink to="/privacy-inbox">Privacy Inbox</NavLink>
        <NavLink to="/connect">Connections</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <button type="button" onClick={handleLogout} disabled={isSigningOut}>
        {isSigningOut ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? <p className="workspace-header-error" role="alert">{error}</p> : null}
    </header>
  )
}

export default WorkspaceHeader
