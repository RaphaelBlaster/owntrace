import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Link } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import { formatAccountDate, formatEnum, getEvidenceLabel } from './account-format.js'
import './accounts.css'

function getRecommendation(account) {
  if (account.confidenceLevel === 'UNKNOWN' || account.confidenceLevel === 'POSSIBLE') {
    return 'Review the evidence before taking action. OwnTrace has limited support for this account inference.'
  }
  if (account.dormantStatus === 'DORMANT' || account.dormantStatus === 'POSSIBLY_DORMANT') {
    return 'Consider whether you still use this service. Visit the service directly to review or close the account.'
  }
  return 'Keep the service’s recovery information and sign-in security current. Manage changes directly with the service.'
}

function AccountDetailPage() {
  const { id } = useParams()
  const titleRef = useRef(null)
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadAccount() {
      setIsLoading(true)
      setError('')
      try {
        const response = await api.get(`/accounts/${id}`, { signal: controller.signal })
        setResult(response.data)
      } catch (requestError) {
        if (requestError.code !== 'ERR_CANCELED') {
          setError(
            requestError.response?.status === 404
              ? 'This account was not found in your inventory.'
              : requestError.response?.data?.message || 'OwnTrace could not load this account.',
          )
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadAccount()
    return () => controller.abort()
  }, [id])

  useEffect(() => {
    if (result || error) titleRef.current?.focus()
  }, [error, result])

  const account = result?.account

  return (
    <main className="accounts-page">
      <div className="accounts-shell">
        <Link className="accounts-back-link" to="/accounts">← Back to accounts</Link>

        {isLoading ? (
          <div className="accounts-loading accounts-detail-loading" role="status" aria-busy="true">
            <span className="accounts-spinner" aria-hidden="true" />
            <span>Loading account evidence…</span>
          </div>
        ) : error ? (
          <section className="accounts-error-state" role="alert">
            <h1 ref={titleRef} tabIndex="-1">Account unavailable</h1>
            <p>{error}</p>
            <Link to="/accounts">Return to your accounts</Link>
          </section>
        ) : (
          <>
            <section className="account-detail-hero" aria-labelledby="account-detail-title" data-trace-entity={account.id}>
              <span className="account-monogram" aria-hidden="true">
                {account.serviceName?.charAt(0).toUpperCase() || '?'}
              </span>
              <div>
                <p className="accounts-eyebrow">Discovered account</p>
                <h1 ref={titleRef} id="account-detail-title" tabIndex="-1">{account.serviceName}</h1>
                <p>{account.primaryDomain}</p>
              </div>
              <div className="account-detail-badges">
                <span className={`account-confidence is-${account.confidenceLevel.toLowerCase()}`}>
                  {formatEnum(account.confidenceLevel)} confidence
                </span>
                <span className={`account-dormancy is-${account.dormantStatus.toLowerCase()}`}>
                  {formatEnum(account.dormantStatus)}
                </span>
              </div>
            </section>

            <dl className="account-detail-grid" aria-label="Account facts">
              <div><dt>Confidence score</dt><dd>{account.confidenceScore}/100</dd></div>
              <div><dt>First signal</dt><dd>{formatAccountDate(account.firstSeenAt)}</dd></div>
              <div><dt>Last signal</dt><dd>{formatAccountDate(account.lastSeenAt)}</dd></div>
              <div><dt>Evidence signals</dt><dd>{account.evidenceCount}</dd></div>
            </dl>

            <div className="account-detail-columns">
              <section className="account-evidence-panel" aria-labelledby="evidence-title">
                <div className="account-section-heading">
                  <div><p className="accounts-eyebrow">Why OwnTrace connected this service</p><h2 id="evidence-title">Evidence</h2></div>
                  <span>{result.evidenceTotal} {result.evidenceTotal === 1 ? 'signal' : 'signals'}</span>
                </div>
                <p className="account-explanation">
                  Confidence comes from deterministic message-header patterns. Raw email bodies are not shown or stored.
                </p>
                <ol className="account-evidence-list">
                  {result.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <span className="evidence-marker" aria-hidden="true" />
                      <div>
                        <strong>{getEvidenceLabel(evidence.evidenceClass)}</strong>
                        <span>{evidence.sourceDomain} · {formatAccountDate(evidence.occurredAt)}</span>
                      </div>
                      <span className="evidence-weight">Weight {evidence.evidenceWeight}</span>
                    </li>
                  ))}
                </ol>
                {result.evidenceTruncated ? (
                  <p className="account-explanation">Showing the 100 most recent evidence signals.</p>
                ) : null}
              </section>

              <aside className="account-insight-panel" aria-labelledby="activity-title">
                <p className="accounts-eyebrow">Activity inference</p>
                <h2 id="activity-title">{formatEnum(account.dormantStatus)}</h2>
                <p>{account.dormantReason}</p>
                <div className="account-recommendation">
                  <strong>Recommended next step</strong>
                  <p>{getRecommendation(account)}</p>
                  <Link className="account-actions-link" to={`/account-actions?accountId=${account.id}`}>
                    View account actions
                  </Link>
                </div>
                <small>
                  OwnTrace does not claim it can delete this account or confirm its current state. These are evidence-based suggestions.
                </small>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default AccountDetailPage
