import { Navigate, useLocation } from 'react-router-dom'
import { canAccessAuthenticatedRoute, getDefaultAuthenticatedRoute } from './auth-navigation.js'
import useAuth from './useAuth.js'

function ProtectedRoute({ children }) {
  const { isLoading, restoreSession, sessionError, user } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <main className="auth-route-status" aria-busy="true">
        <span className="auth-spinner" aria-hidden="true" />
        <p>Restoring your session…</p>
      </main>
    )
  }

  if (sessionError) {
    return (
      <main className="auth-route-status" role="alert">
        <p>OwnTrace could not reach the server. It may still be starting.</p>
        <button type="button" onClick={() => restoreSession()}>Try again</button>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname.startsWith('/trace') ? `${location.pathname}${location.search}${location.hash}` : location.pathname }} />
  }

  if (!canAccessAuthenticatedRoute(user, location.pathname)) {
    return <Navigate to={getDefaultAuthenticatedRoute(user)} replace />
  }

  return children
}

export default ProtectedRoute
