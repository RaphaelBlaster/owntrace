import { ScreenHeader } from '../../demo/components.jsx'
import useAuth from '../auth/useAuth.js'
import { useState } from 'react'
import api from '../../services/api.js'
import './account-settings.css'

function AccountSettingsPage() {
  const {user,restoreSession}=useAuth()
  const [name,setName]=useState(user.name), [goal,setGoal]=useState(user.workspaceGoal || 'Get organized')
  const [saving,setSaving]=useState(false), [notice,setNotice]=useState('')
  const [values, setValues] = useState({ confirmation: '', password: '' })
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  function updateField(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: value }))
    setError('')
  }

  async function handleDelete(event) {
    event.preventDefault()
    setIsDeleting(true)
    setError('')

    try {
      const response = await api.delete('/auth/account', { data: values })
      const revocation = response.data.providerRevocation === 'FAILED' ? 'failed' : 'complete'
      window.location.replace(`/login?account=deleted&providerRevocation=${revocation}`)
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not delete your account. Your data has not been reported as deleted.',
      )
      setIsDeleting(false)
    }
  }

  const canDelete = values.confirmation === 'DELETE' && Boolean(values.password) && !isDeleting

  return (
    <div>
      <ScreenHeader kicker="MAKE IT YOURS" title="A workspace that works for you." description="Manage your private profile, workspace focus and account data." />
      <div className="dx-settings-grid">
        <section className="dx-panel"><h2>Your profile</h2><p className="dx-description">Saved privately to your OwnTrace account.</p><form onSubmit={async event=>{event.preventDefault();setSaving(true);setNotice('');try{await api.patch('/auth/profile',{name,workspaceGoal:goal});await restoreSession({showLoading:false});setNotice('Your profile and focus were saved.')}catch(failure){setNotice(failure.response?.data?.message || 'Your profile could not be saved.')}finally{setSaving(false)}}}><label className="dx-field">Display name<input value={name} onChange={event=>setName(event.target.value)} minLength={2} maxLength={80} required /></label><label className="dx-field">Your focus<select value={goal} onChange={event=>setGoal(event.target.value)}>{['Get organized','Reduce recurring costs','Improve account security'].map(value=><option key={value}>{value}</option>)}</select></label><button type="submit" className="dx-button dx-button-primary" disabled={saving}>{saving?'Saving…':'Save profile'}</button>{notice?<p role="status">{notice}</p>:null}</form></section>


        <section className="dx-panel" aria-labelledby="stored-data-title">
          <div>
            <p className="settings-eyebrow">Stored by OwnTrace</p>
            <h2 id="stored-data-title">Your current workspace data</h2>
          </div>
          <ul>
            <li>OwnTrace profile and password hash</li>
            <li>Encrypted Google or Microsoft connection credentials, when connected</li>
            <li>Minimized mail signals, derived account evidence, accounts, and actions</li>
          </ul>
        </section>

        <section className="dx-panel dx-settings-data" aria-labelledby="delete-account-title">
          <div className="settings-danger-copy">
            <p className="settings-eyebrow">Permanent action</p>
            <h2 id="delete-account-title">Delete your OwnTrace account</h2>
            <p>
              OwnTrace will attempt to revoke its connected provider access, then permanently remove your
              profile and all of your OwnTrace workspace data. This does not delete accounts or data
              held by Google, Microsoft, or other services.
            </p>
          </div>

          {error ? <p className="settings-error" role="alert">{error}</p> : null}

          <form className="settings-delete-form" onSubmit={handleDelete} aria-busy={isDeleting}>
            <label htmlFor="delete-confirmation">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              id="delete-confirmation"
              name="confirmation"
              value={values.confirmation}
              onChange={updateField}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck="false"
              required
            />

            <label htmlFor="delete-password">Current password</label>
            <input
              id="delete-password"
              name="password"
              type="password"
              value={values.password}
              onChange={updateField}
              autoComplete="current-password"
              maxLength="128"
              required
            />

            <button type="submit" disabled={!canDelete}>
              {isDeleting ? 'Deleting account…' : 'Delete OwnTrace account'}
            </button>
          </form>

          <p className="settings-provider-note">
            If a provider cannot confirm revocation, OwnTrace still removes its local copy. Review
            connected-app access directly with Google or Microsoft when prompted.
          </p>
        </section>
      </div>
    </div>
  )
}

export default AccountSettingsPage
