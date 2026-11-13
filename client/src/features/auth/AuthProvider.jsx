import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api, { SESSION_ENDED_EVENT } from '../../services/api.js'
import AuthContext from './auth-context.js'

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionError, setSessionError] = useState(false)
  const restoreController = useRef(null)

  const restoreSession = useCallback(async ({ showLoading = true } = {}) => {
    restoreController.current?.abort()
    const controller = new AbortController()
    restoreController.current = controller
    if (showLoading) setIsLoading(true)
    setSessionError(false)

    try {
      const response = await api.get('/auth/session', { signal: controller.signal })
      if (controller.signal.aborted) return undefined
      setUser(response.data.user)
      return response.data.user
    } catch {
      if (!controller.signal.aborted) setSessionError(true)
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    restoreSession()
    return () => restoreController.current?.abort()
  }, [restoreSession])

  useEffect(() => {
    function handleSessionEnded() {
      restoreController.current?.abort()
      setUser(null)
      setSessionError(false)
      setIsLoading(false)
    }

    window.addEventListener(SESSION_ENDED_EVENT, handleSessionEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, handleSessionEnded)
  }, [])

  const login = useCallback(async (credentials) => {
    restoreController.current?.abort()
    const response = await api.post('/auth/login', credentials)
    setUser(response.data.user)
    setSessionError(false)
    return response.data.user
  }, [])

  const register = useCallback(async (details) => {
    restoreController.current?.abort()
    const response = await api.post('/auth/register', details)
    setUser(response.data.user)
    setSessionError(false)
    return response.data.user
  }, [])

  const logout = useCallback(async () => {
    restoreController.current?.abort()
    await api.post('/auth/logout')
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ isLoading, login, logout, register, restoreSession, sessionError, user }),
    [isLoading, login, logout, register, restoreSession, sessionError, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
