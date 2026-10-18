import { Card } from '../../ui/components.jsx'
import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, Pagination, StatusPill } from './PrivacyPageLayout.jsx'
import { formatDate, formatEnum } from './privacy-format.js'

function BreachesPage() {
  const [breachPage, setBreachPage] = useState(1)
  const [result, setResult] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [checkError, setCheckError] = useState('')
  const [consent, setConsent] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [notice, setNotice] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [signalPage, setSignalPage] = useState(1)

  const loadBreaches = useCallback((signal) => api.get('/breaches', {
    params: {
      breachLimit: 12,
      breachPage,
      signalLimit: 12,
      signalPage,
    },
    signal,
  })
    .then((response) => {
      setResult(response.data)
      setLoadError('')
    }), [breachPage, signalPage])

  useEffect(() => {
    const controller = new AbortController()
    loadBreaches(controller.signal)
      .catch((requestError) => {
        if (requestError.code !== 'ERR_CANCELED') setLoadError(requestError.response?.data?.message || 'OwnTrace could not load breach information.')
      })
    return () => controller.abort()
  }, [loadBreaches, refreshVersion])

  async function checkBreaches() {
    setIsChecking(true)
    setCheckError('')
    setNotice('')
    try {
      const response = await api.post('/breaches/check', { consent: true })
      setNotice(response.data.reused
        ? 'Showing your verified breach results from the current 24-hour cache.'
        : 'Your account email was checked and the verified results below are now cached for 24 hours.')
      setBreachPage(1)
      setConsent(false)
      setRefreshVersion((version) => version + 1)
    } catch (requestError) {
      setCheckError(requestError.response?.data?.message || 'OwnTrace could not check for verified breaches.')
    } finally {
      setIsChecking(false)
    }
  }

  function retryLoad() {
    setLoadError('')
    setRefreshVersion((version) => version + 1)
  }

  const provider = result?.provider || {
    cached: false,
    message: 'Run a security check whenever you are ready.',
    status: 'NOT_CHECKED',
  }

  return (
    <PrivacyPageLayout
      description="OwnTrace separates verified breach records from security-related account metadata so a password-reset or alert email is never misrepresented as proof of a breach."
      eyebrow="Breaches"
      title="Breach checks"
    >
      <Card className="privacy-card privacy-breach-check" aria-labelledby="breach-check-title">
          <div className="privacy-section-heading">
            <div><p>Manual check</p><h2 id="breach-check-title">Check your OwnTrace account email</h2></div>
            <StatusPill tone={provider.status === 'BREACHES_FOUND' ? 'high' : provider.status === 'CLEAR' ? 'good' : 'medium'}>{formatEnum(provider.status)}</StatusPill>
          </div>
          <p>OwnTrace will send your signed-in account email to XposedOrNot, an external breach-data service, to check known breach records. Gmail messages, passwords, and discovered account data are not sent.</p>
          <label className="privacy-consent">
            <input checked={consent} disabled={isChecking} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
            <span>I understand and want OwnTrace to send my account email to XposedOrNot for this breach check.</span>
          </label>
          <div className="privacy-breach-check-actions">
            <button className="privacy-action is-primary" disabled={!consent || isChecking} onClick={checkBreaches} type="button">
              {isChecking ? 'Checking…' : provider.cached ? 'Use current check' : 'Check for known breaches'}
            </button>
            <p>{provider.message}</p>
          </div>
          {checkError ? <p className="privacy-error privacy-check-error" role="alert">{checkError}</p> : null}
          <p className="privacy-breach-disclaimer">Source: XposedOrNot. A verified breach record means the account email appeared in a known breach; it does not prove a current account compromise.</p>
      </Card>
      {notice ? <p aria-live="polite" className="privacy-note">{notice}</p> : null}
      {loadError ? <ErrorState>{loadError} <button className="privacy-action" onClick={retryLoad} type="button">Retry</button></ErrorState> : null}
      {!result && !loadError ? <LoadingState>Loading breach and security status…</LoadingState> : null}
      {result?.breaches.length ? (
        <Card className="privacy-card " aria-labelledby="verified-breaches-title">
          <div className="privacy-section-heading"><div><p>Verified check results</p><h2 id="verified-breaches-title">Known breaches</h2></div><StatusPill tone="high">{result.breachPagination.total} found</StatusPill></div>
          <ul className="privacy-list">
            {result.breaches.map((breach) => (
              <li className="privacy-list-item" key={breach.name}>
                <div><strong>{breach.name}</strong><p>Review this breach and update credentials through the affected service.</p></div>
                <StatusPill tone="high">Verified</StatusPill>
              </li>
            ))}
          </ul>
          <Pagination label="Verified breach pages" onPageChange={setBreachPage} pagination={result.breachPagination} />
        </Card>
      ) : result?.provider.status === 'CLEAR' ? <EmptyState title="No verified breaches found">No known breach records were found for your account email at the time of the check.</EmptyState> : null}
      {result?.securitySignals.length ? (
        <Card className="privacy-card " aria-labelledby="security-signals-title">
          <div className="privacy-section-heading"><div><p>Not verified breaches</p><h2 id="security-signals-title">Security-related signals</h2></div><StatusPill tone="medium">Review only</StatusPill></div>
          <ul className="privacy-list">
            {result.securitySignals.map((signal) => (
              <li className="privacy-list-item" key={signal.accountId}>
                <div><strong>{signal.serviceName}</strong><p>{signal.primaryDomain} · Last signal {formatDate(signal.lastSeenAt)}</p><small>Observed classes: {signal.basis.map(formatEnum).join(', ')}</small></div>
                <StatusPill tone="medium">Unverified</StatusPill>
              </li>
            ))}
          </ul>
          <Pagination label="Security signal pages" onPageChange={setSignalPage} pagination={result.pagination} />
        </Card>
      ) : result ? <EmptyState title="No security-related metadata signals">No security-alert or password-reset metadata signals are currently available. These signals remain separate from verified breach results.</EmptyState> : null}
    </PrivacyPageLayout>
  )
}

export default BreachesPage
