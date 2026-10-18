import { Connections } from '../../demo/screens.jsx'
import { useState } from 'react'
import { useWorkspaceNavigate as useNavigate } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import useAuth from '../auth/useAuth.js'

import '../google/google-connection.css'

function MailConnectionsPage() {
  const { restoreSession } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function skipConnection() {
    setSaving(true)
    setError('')
    try {
      await api.patch('/onboarding', { status: 'COMPLETED' })
      await restoreSession({ showLoading: false })
      navigate('/dashboard', { replace: true })
    } catch { setError('We could not save your choice. Please try again.') }
    finally { setSaving(false) }
  }
  return <><Connections/><div className="dx-panel">{error ? <p role="alert">{error}</p> : null}<p>Scanning is deferred. Your workspace is ready to use without a mail connection.</p><button className="dx-button dx-button-primary" type="button" disabled={saving} onClick={skipConnection}>{saving ? "Saving…" : "Continue without connecting"}</button></div></>
}
export default MailConnectionsPage
