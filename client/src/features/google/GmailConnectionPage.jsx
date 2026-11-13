import { PageHeader } from '../../ui/components.jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import useAuth from '../auth/useAuth.js'
import PrivacyWorkspace from '../privacy/PrivacyWorkspace.jsx'
import './google-connection.css'

const callbackMessages = {
  connected: 'Gmail connected successfully. OwnTrace can now prepare a metadata-only scan.',
  denied: 'Google access was not granted. Nothing was connected.',
  invalid_callback: 'Google returned an incomplete connection response. Please try again.',
  invalid_oauth_state: 'The connection request expired or could not be verified. Please try again.',
  oauth_user_mismatch: 'The Google response did not match this OwnTrace session.',
  google_refresh_token_missing: 'Google did not provide offline access. Reconnect and approve consent again.',
  google_scope_missing: 'Gmail metadata access was not granted. OwnTrace left the account disconnected.',
  connection_failed: 'Google connection could not be completed. Please try again.',
  google_account_mismatch: 'Choose the Google account already connected here, or disconnect it before choosing a different account.',
  google_connection_busy: 'Finish or cancel the current scan before reconnecting Google.',
}

const syncNotes = {
  MESSAGE_LIMIT_REACHED:
    'OwnTrace stopped at the configured safety limit. This scan might not include your entire mailbox.',
  PARTIAL_METADATA_RESULTS:
    'Some message metadata was unavailable. Saved progress is safe, and you can run another scan later.',
}

function getSyncTitle(sync, isSyncing) {
  if (isSyncing) return 'Scanning email metadata'
  if (!sync) return 'Ready to scan'
  if (sync.lastErrorCode === 'MESSAGE_LIMIT_REACHED') return 'Stopped at the safety limit'
  if (sync.status === 'COMPLETED') return 'Scan complete'
  if (sync.status === 'CANCELLED') return 'Scan cancelled'
  if (sync.status === 'FAILED') return 'Scan needs attention'
  if (sync.status === 'QUEUED') return 'Ready to resume'
  return 'Finishing the current batch'
}

function formatDate(value) {
  if (!value) return 'Not yet'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
      <path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10.1 10.1 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.5 14a6 6 0 0 1 0-4V7.3H3.1a10.1 10.1 0 0 0 0 9.4L6.5 14Z" />
      <path fill="#ea4335" d="M12 5.9c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2 10.1 10.1 0 0 0 3.1 7.3L6.5 10A5.9 5.9 0 0 1 12 5.9Z" />
    </svg>
  )
}

function CapabilityList({ items }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <span className={`google-capability-state ${item.active ? 'is-active' : ''}`}>
            {item.active ? 'Available now' : 'Not available'}
          </span>
          <strong>{item.label}</strong>
          <p>{item.summary}</p>
        </li>
      ))}
    </ul>
  )
}

function GmailConnectionPage() {
  const { restoreSession } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const titleRef = useRef(null)
  const stopSyncRef = useRef(false)
  const [callbackStatus] = useState(() => searchParams.get('google'))
  const [googleState, setGoogleState] = useState({
    available: false,
    capabilities: { confirmed: [], inferred: [], unsupported: [] },
    connection: null,
    syncPolicy: { batchSize: 25, messageLimit: null },
  })
  const [sync, setSync] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!searchParams.has('google')) return

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('google')
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const loadConnection = useCallback(async ({ clearError = true } = {}) => {
    setIsLoading(true)
    if (clearError) setError('')

    try {
      const [connectionResponse, syncResponse] = await Promise.all([
        api.get('/google/connection'),
        api.get('/google/sync'),
      ])
      setGoogleState(connectionResponse.data.google)
      setSync(syncResponse.data.sync)
      if (syncResponse.data.sync?.status === 'COMPLETED') await restoreSession({ showLoading: false })
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not load the Google connection. Try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [restoreSession])

  useEffect(() => {
    stopSyncRef.current = false
    titleRef.current?.focus()
    loadConnection()
    return () => { stopSyncRef.current = true }
  }, [loadConnection])

  useEffect(() => {
    if (!['QUEUED', 'SCANNING', 'PROCESSING'].includes(sync?.status) || isSyncing || isDisconnecting) return undefined
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get('/google/sync')
        setSync(response.data.sync)
        if (response.data.sync?.status === 'COMPLETED') await restoreSession({ showLoading: false })
      } catch {}
    }, 2500)
    return () => window.clearInterval(timer)
  }, [sync?.status, isSyncing, isDisconnecting, restoreSession])

  async function handleDisconnect() {
    stopSyncRef.current = true
    setIsDisconnecting(true)
    setError('')

    try {
      await api.delete('/google/connection')
      await restoreSession({ showLoading: false })
      await loadConnection()
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not disconnect Google. Try again.',
      )
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function runSyncBatches(initialSync) {
    let currentSync = initialSync
    stopSyncRef.current = false
    setIsSyncing(true)
    setError('')

    try {
      while (['QUEUED', 'SCANNING', 'PROCESSING'].includes(currentSync?.status) && !stopSyncRef.current) {
        await new Promise(resolve => window.setTimeout(resolve, 2000))
        const response = await api.get('/google/sync')
        if (stopSyncRef.current) return
        currentSync = response.data.sync
        setSync(currentSync)
      }

      if (!stopSyncRef.current) await loadConnection()
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not continue the metadata scan. Your saved progress is preserved.',
      )
      if (!stopSyncRef.current) await loadConnection({ clearError: false })
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleStartSync() {
    stopSyncRef.current = false
    setIsSyncing(true)
    setError('')

    try {
      const response = await api.post('/google/sync')
      if (stopSyncRef.current) return
      setSync(response.data.sync)
      await runSyncBatches(response.data.sync)
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not start the metadata scan. Try again.',
      )
      setIsSyncing(false)
    }
  }

  async function handleCancelSync() {
    stopSyncRef.current = true

    try {
      const response = await api.delete('/google/sync')
      setSync(response.data.sync)
      await loadConnection()
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || 'OwnTrace could not cancel the scan. Try again.',
      )
    }
  }

  const connection = googleState.connection
  const isConnected = Boolean(connection)

  return (
    <PrivacyWorkspace title="Gmail">
    <main className="google-page">
      <div className="google-shell">
        <header className="google-header">
          <Link to="/connect" className="google-brand">All connections</Link>
          <nav aria-label="Google connection">
            {isConnected ? <Link to="/dashboard">Dashboard</Link> : null}
            <Link to="/onboarding">Review privacy setup</Link>
          </nav>
        </header>

        <PageHeader id="google-title" eyebrow="Connections / Gmail" title="Gmail connection" description="Find account clues using mail metadata. OwnTrace cannot send, modify, or delete your mail." titleRef={titleRef} titleTabIndex={-1} />

        {callbackStatus && callbackMessages[callbackStatus] ? (
          <p className={`google-notice ${callbackStatus === 'connected' ? 'is-success' : ''}`} role="status">
            {callbackMessages[callbackStatus]}
          </p>
        ) : null}
        {error ? <p className="google-notice" role="alert">{error}</p> : null}

        <section className="google-connection-card" aria-labelledby="connection-title" aria-busy={isLoading}>
          <div>
            <p className="google-card-kicker">Connection status</p>
            <h2 id="connection-title">
              {isLoading ? 'Checking connection…' : isConnected ? connection.status.replace('_', ' ') : 'Not connected'}
            </h2>
            <p>
              {isConnected
                ? `Connected as ${connection.email}. Tokens remain encrypted on the server.`
                : 'No Google account or Gmail permission is currently linked to this OwnTrace account.'}
            </p>
          </div>

          {isConnected ? (
            <dl className="google-connection-details">
              <div><dt>Connected</dt><dd>{formatDate(connection.connectedAt)}</dd></div>
              <div><dt>Last metadata sync</dt><dd>{formatDate(connection.lastSyncAt)}</dd></div>
              <div><dt>Automatic updates</dt><dd>{connection.pushStatus === 'ACTIVE' ? 'On' : connection.pushStatus === 'ERROR' ? 'Needs setup' : 'Not configured'}</dd></div>
              <div><dt>Gmail access</dt><dd>Metadata only</dd></div>
            </dl>
          ) : null}

          <div className="google-actions">
            {isConnected ? (
              <>
                {!isSyncing && !isDisconnecting ? <a className="google-provider-action" href="/api/google/oauth/start"><GoogleMark />Reconnect Google</a> : null}
                <button type="button" onClick={handleDisconnect} disabled={isDisconnecting}>
                  {isDisconnecting ? 'Disconnecting…' : 'Disconnect Google'}
                </button>
              </>
            ) : googleState.available ? (
              <a className="google-provider-action" href="/api/google/oauth/start"><GoogleMark />Continue with Google</a>
            ) : (
              <button type="button" disabled>Google connection unavailable</button>
            )}
          </div>

          {!isConnected && !isLoading && !googleState.available ? (
            <p className="google-configuration-note">
              Google OAuth has not been configured for this environment. No access can be requested yet.
            </p>
          ) : null}
        </section>

        {isConnected ? (
          <section className="google-sync-card" aria-labelledby="sync-title" aria-busy={isSyncing}>
            <div>
              <p className="google-card-kicker">Metadata scan</p>
              <h2 aria-live="polite" id="sync-title">{getSyncTitle(sync, isSyncing)}</h2>
              <p>
                OwnTrace checks up to {googleState.syncPolicy.messageLimit?.toLocaleString() || 'the configured limit'}
                {' '}email metadata records per scan, {googleState.syncPolicy.batchSize} at a time, and can
                finish sooner when no more results remain. It safely deduplicates messages already seen.
                A saved clue represents one message, not one discovered account. The scan stops when it reaches this limit or runs out of results.
              </p>
            </div>
            <dl>
              <div><dt>Email metadata checked</dt><dd>{sync?.processedCount ?? 0}</dd></div>
              <div><dt>Signals queued</dt><dd>{sync?.storedCount ?? 0}</dd></div>
            </dl>
            {sync?.lastErrorCode ? (
              <p className="google-configuration-note">
                {syncNotes[sync.lastErrorCode] || 'The scan finished with a provider note. Your saved progress is safe.'}
              </p>
            ) : null}
            <div className="google-actions google-sync-actions">
              {sync?.status === 'COMPLETED' ? (
                <Link className="google-primary-action" to="/accounts">Review discovered accounts</Link>
              ) : null}
              {sync?.status === 'QUEUED' && !isSyncing ? (
                <button className="google-primary-action" type="button" disabled={isDisconnecting || connection.status === 'NEEDS_RECONNECT'} onClick={() => runSyncBatches(sync)}>
                  Resume scan
                </button>
              ) : (
                <button className="google-primary-action" type="button" onClick={handleStartSync} disabled={isSyncing || isDisconnecting || ['SCANNING', 'PROCESSING'].includes(sync?.status) || connection.status === 'NEEDS_RECONNECT'}>
                  {isSyncing ? 'Scanning metadata…' : sync?.status === 'COMPLETED' ? 'Check for newer messages' : 'Start metadata scan'}
                </button>
              )}
              {['QUEUED', 'SCANNING', 'PROCESSING'].includes(sync?.status) ? <button type="button" disabled={isDisconnecting} onClick={handleCancelSync}>Cancel scan</button> : null}
              {!isSyncing ? <button type="button" onClick={() => loadConnection()}>Refresh status</button> : null}
            </div>
          </section>
        ) : null}

        <details className="google-capabilities">
          <summary>Permissions, evidence, and limitations</summary>
          <div className="google-capabilities-heading">
            <h2 id="capabilities-title">What this connection can show</h2>
            <p>
              Connection facts come from Google OAuth. Account relationships remain OwnTrace
              inferences. Provider-wide app permissions stay with Google.
            </p>
          </div>
          <div className="google-capability-grid">
            <article>
              <span className="google-capability-label is-confirmed">Confirmed</span>
              <h3>Provider facts</h3>
              <CapabilityList items={googleState.capabilities.confirmed} />
            </article>
            <article>
              <span className="google-capability-label is-inferred">Inferred</span>
              <h3>Evidence-based relationships</h3>
              <CapabilityList items={googleState.capabilities.inferred} />
            </article>
            <article>
              <span className="google-capability-label is-unsupported">Unsupported</span>
              <h3>Google-wide app access</h3>
              <CapabilityList items={googleState.capabilities.unsupported} />
              <a
                className="google-account-link"
                href="https://myaccount.google.com/connections"
                aria-label="Review connections in Google Account (opens in a new tab)"
                target="_blank"
                rel="noreferrer"
              >
                Review connections in Google Account
              </a>
            </article>
          </div>
        </details>

        <section className="google-boundaries" aria-labelledby="boundaries-title">
          <div><p className="google-eyebrow">Before you connect</p><h2 id="boundaries-title">What this permission means</h2></div>
          <ul>
            <li><strong>Read selected headers</strong><span>Sender, subject signals, and dates needed for account evidence.</span></li>
            <li><strong>Never send or modify mail</strong><span>The requested scope does not grant those capabilities.</span></li>
            <li><strong>Disconnect when you choose</strong><span>OwnTrace revokes provider access before removing its local connection.</span></li>
          </ul>
        </section>
      </div>
    </main>
    </PrivacyWorkspace>
  )
}

export default GmailConnectionPage
