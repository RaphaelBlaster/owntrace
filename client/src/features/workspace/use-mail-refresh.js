import { useEffect } from 'react'
import api from '../../services/api.js'
import { createMailRefresher } from './mail-refresh.js'

// One refresher per page load, so remounting the workspace between sections
// does not send another request.
const refresher = createMailRefresher({ request: () => api.post('/mail/sync-now', {}) })

function useMailRefresh(enabled) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined
    refresher.trigger()
    const onVisibility = () => { if (document.visibilityState === 'hidden') refresher.hidden(); else refresher.visible() }
    const onBlur = () => refresher.hidden()
    const onFocus = () => refresher.visible()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])
}

export default useMailRefresh
