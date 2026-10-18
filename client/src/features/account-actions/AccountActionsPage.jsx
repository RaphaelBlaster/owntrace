import { PageHeader } from '../../ui/components.jsx'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import { formatAccountDate, formatEnum } from '../accounts/account-format.js'
import './account-actions.css'

const emptySummary = { completed: 0, dismissed: 0, highPriority: 0, inProgress: 0, open: 0 }

function ActionButtons({ action, busy, onStatusChange }) {
  if (action.status === 'OPEN') {
    return (
      <>
        <button type="button" onClick={() => onStatusChange(action.id, 'IN_PROGRESS')} disabled={busy}>Start</button>
        <button type="button" onClick={() => onStatusChange(action.id, 'COMPLETED')} disabled={busy}>Complete</button>
        <button className="is-quiet" type="button" onClick={() => onStatusChange(action.id, 'DISMISSED')} disabled={busy}>Dismiss</button>
      </>
    )
  }

  if (action.status === 'IN_PROGRESS') {
    return (
      <>
        <button type="button" onClick={() => onStatusChange(action.id, 'COMPLETED')} disabled={busy}>Mark complete</button>
        <button className="is-quiet" type="button" onClick={() => onStatusChange(action.id, 'OPEN')} disabled={busy}>Reopen</button>
        <button className="is-quiet" type="button" onClick={() => onStatusChange(action.id, 'DISMISSED')} disabled={busy}>Dismiss</button>
      </>
    )
  }

  return (
    <button type="button" onClick={() => onStatusChange(action.id, 'OPEN')} disabled={busy}>
      Reopen recommendation
    </button>
  )
}

function AccountActionCard({ action, busy, onStatusChange }) {
  return (
    <li className="cleanup-card">
      <div className="cleanup-card-heading">
        <span className={`cleanup-priority is-${action.priority.toLowerCase()}`}>
          {formatEnum(action.priority)} priority
        </span>
        <span className="cleanup-status">{formatEnum(action.status)}</span>
      </div>
      <div className="cleanup-card-service">
        <span className="cleanup-service-mark" aria-hidden="true">
          {action.account?.serviceName?.charAt(0).toUpperCase() || '?'}
        </span>
        <div>
          <strong>{action.account?.serviceName || 'Unavailable account'}</strong>
          <span>{action.account?.primaryDomain || 'Account record unavailable'}</span>
        </div>
        {action.account ? <Link to={`/accounts/${action.accountId}`}>View evidence</Link> : null}
      </div>
      <h3>{action.title}</h3>
      <p>{action.description}</p>
      <div className="cleanup-reason">
        <strong>Why this is suggested</strong>
        <p>{action.reason}</p>
      </div>
      <div className="cleanup-card-footer">
        <span>Updated {formatAccountDate(action.statusUpdatedAt)}</span>
        <div
          className="cleanup-card-actions"
          role="group"
          aria-label={`Update ${action.title} for ${action.account?.serviceName || 'account'}`}
        >
          <ActionButtons action={action} busy={busy} onStatusChange={onStatusChange} />
        </div>
      </div>
    </li>
  )
}

function AccountActionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [actions, setActions] = useState([])
  const [summary, setSummary] = useState(emptySummary)
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [busyActionId, setBusyActionId] = useState('')
  const [error, setError] = useState('')
  const status = searchParams.get('status') || 'OPEN'
  const accountId = searchParams.get('accountId') || ''
  const page = Number(searchParams.get('page')) || 1

  const loadActions = useCallback(async ({ showLoading = true, signal } = {}) => {
    if (showLoading) setIsLoading(true)
    setError('')
    try {
      const [actionsResponse, summaryResponse] = await Promise.all([
        api.get('/account-actions', {
          params: { accountId: accountId || undefined, limit: 12, page, status },
          signal,
        }),
        api.get('/account-actions/summary', { signal }),
      ])
      setActions(actionsResponse.data.actions)
      setPagination(actionsResponse.data.pagination)
      setSummary(summaryResponse.data.summary)
    } catch (requestError) {
      if (requestError.code !== 'ERR_CANCELED') {
        setError(
          requestError.response?.data?.message ||
            'OwnTrace could not load account recommendations. Try again.',
        )
      }
    } finally {
      if (showLoading && !signal?.aborted) setIsLoading(false)
    }
  }, [accountId, page, status])

  useEffect(() => {
    const controller = new AbortController()
    loadActions({ signal: controller.signal })
    return () => controller.abort()
  }, [loadActions])

  function updateQuery(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setSearchParams(next)
  }

  async function handleStatusChange(actionId, nextStatus) {
    setBusyActionId(actionId)
    setError('')
    try {
      await api.patch(`/account-actions/${actionId}`, { status: nextStatus })
      await loadActions({ showLoading: false })
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not update this recommendation. Try again.',
      )
    } finally {
      setBusyActionId('')
    }
  }

  return (
    <main className="cleanup-page">
      <div className="cleanup-shell">

        <PageHeader id="cleanup-title" eyebrow="Privacy actions" title="Account cleanup" description="Review suggested next steps based on account evidence. You decide which actions to take." />

        <dl className="cleanup-summary" aria-label="Account action summary">
          <div><dt>Open</dt><dd>{summary.open}</dd></div>
          <div><dt>In progress</dt><dd>{summary.inProgress}</dd></div>
          <div><dt>Completed</dt><dd>{summary.completed}</dd></div>
          <div><dt>High priority</dt><dd>{summary.highPriority}</dd></div>
        </dl>

        <section className="cleanup-workspace" aria-labelledby="cleanup-list-title" aria-busy={isLoading}>
          <div className="cleanup-workspace-heading">
            <div>
              <p className="cleanup-eyebrow">Recommendations</p>
              <h2 id="cleanup-list-title">Account actions</h2>
            </div>
            <span role="status">{pagination.total} {pagination.total === 1 ? 'action' : 'actions'}</span>
          </div>

          <div className="cleanup-filters">
            <label>
              <span>Status</span>
              <select value={status} onChange={(event) => updateQuery('status', event.target.value)}>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="DISMISSED">Dismissed</option>
              </select>
            </label>
            {accountId ? (
              <div className="cleanup-account-filter" role="status">
                Filtered to one account
                <button type="button" onClick={() => updateQuery('accountId', '')}>Show all accounts</button>
              </div>
            ) : null}
          </div>

          {error ? <p className="cleanup-notice" role="alert">{error}</p> : null}

          {isLoading ? (
            <div className="cleanup-state" role="status">
              <span className="cleanup-spinner" aria-hidden="true" />
              <span>Preparing account recommendations…</span>
            </div>
          ) : actions.length ? (
            <ul className="cleanup-list">
              {actions.map((action) => (
                <AccountActionCard
                  key={action.id}
                  action={action}
                  busy={busyActionId === action.id}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </ul>
          ) : (
            <div className="cleanup-state is-empty">
              <span className="cleanup-service-mark" aria-hidden="true">✓</span>
              <h3>No {formatEnum(status).toLowerCase()} account actions.</h3>
              <p>
                {status === 'OPEN'
                  ? 'Your current account evidence does not produce any open recommendations in this view.'
                  : 'Choose another status to review the rest of your account action history.'}
              </p>
              {accountId ? <button type="button" onClick={() => updateQuery('accountId', '')}>Show all accounts</button> : null}
            </div>
          )}

          {pagination.pages > 1 ? (
            <nav className="cleanup-pagination" aria-label="Account action pages">
              <button type="button" disabled={page <= 1} onClick={() => updateQuery('page', String(page - 1))}>Previous</button>
              <span>Page {pagination.page} of {pagination.pages}</span>
              <button type="button" disabled={page >= pagination.pages} onClick={() => updateQuery('page', String(page + 1))}>Next</button>
            </nav>
          ) : null}
        </section>

        <p className="cleanup-footnote">
          Recommendations use OwnTrace account evidence only. Subscription, breach, exposure,
          Privacy Inbox, and privacy-request workflows remain separate owned features.
        </p>
      </div>
    </main>
  )
}

export default AccountActionsPage
