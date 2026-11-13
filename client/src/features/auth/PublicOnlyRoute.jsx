import { Navigate } from 'react-router-dom'
import useAuth from './useAuth.js'
import { getDefaultAuthenticatedRoute } from './auth-navigation.js'

function PublicOnlyRoute({ children }) {
  const { isLoading, restoreSession, sessionError, user } = useAuth()

  if (isLoading) {
    return (
      <main className="auth-route-status" aria-busy="true">
        <span className="auth-spinner" aria-hidden="true" />
        <p>Checking your session…</p>
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

  return user ? <Navigate to={getDefaultAuthenticatedRoute(user)} replace /> : children
}

export default PublicOnlyRoute
