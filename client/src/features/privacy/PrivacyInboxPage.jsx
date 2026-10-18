import { Card } from '../../ui/components.jsx'
import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, Pagination, StatusPill } from './PrivacyPageLayout.jsx'
import { formatEnum } from './privacy-format.js'

function PrivacyInboxPage() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('OPEN')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const loadInbox = useCallback((signal) => {
    setError('')
    setResult(null)
    return api.get('/account-actions', { params: { limit: 12, page, status: statusFilter }, signal })
      .then((response) => setResult(response.data))
      .catch((requestError) => {
        if (requestError.code !== 'ERR_CANCELED') setError(requestError.response?.data?.message || 'OwnTrace could not load the Privacy Inbox.')
      })
  }, [page, statusFilter])

  useEffect(() => {
    const controller = new AbortController()
    loadInbox(controller.signal)
    return () => controller.abort()
  }, [loadInbox, refreshKey])

  async function updateStatus(actionId, status) {
    setBusyId(actionId)
    setError('')
    try {
      await api.patch(`/account-actions/${actionId}`, { status })
      setPage(1)
      setRefreshKey((value) => value + 1)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'OwnTrace could not update this action.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <PrivacyPageLayout
      description="Review suggestions, record your progress, and return to unfinished tasks."
      eyebrow="Actions"
      title="Action inbox"
    >
      <p className="privacy-note">OwnTrace does not perform third-party account changes. Complete each step through the service’s official settings, then record your progress here.</p>
      <label className="privacy-filter-label">Show actions
        <select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value) }}>
          <option value="OPEN">To review</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="DISMISSED">Dismissed</option>
        </select>
      </label>
      {error ? <><ErrorState>{error}</ErrorState><button className="privacy-action" onClick={() => setRefreshKey((value) => value + 1)} type="button">Retry actions</button></> : null}
      {!result && !error ? <LoadingState>Preparing your Privacy Inbox…</LoadingState> : null}
      {result?.actions.length ? (
        <Card className="privacy-card " aria-labelledby="privacy-inbox-list-title">
          <div className="privacy-section-heading"><h2 id="privacy-inbox-list-title">{formatEnum(statusFilter)}</h2><StatusPill>{result.pagination.total} actions</StatusPill></div>
          <ul className="privacy-list">
            {result.actions.map((action) => (
              <li className="privacy-list-item" key={action.id}>
                <div><strong>{action.title}</strong><p>{action.description}</p><small>{action.account?.serviceName || 'Account evidence'} · {action.reason}</small></div>
                <div className="privacy-actions">
                  <StatusPill tone={action.priority.toLowerCase()}>{formatEnum(action.priority)}</StatusPill>
                  {statusFilter === 'OPEN' ? <button className="privacy-action is-primary" disabled={Boolean(busyId)} onClick={() => updateStatus(action.id, 'IN_PROGRESS')} type="button">Start</button> : null}
                  {['OPEN', 'IN_PROGRESS'].includes(statusFilter) ? <><button className="privacy-action" disabled={Boolean(busyId)} onClick={() => updateStatus(action.id, 'COMPLETED')} type="button">Mark completed</button><button className="privacy-action" disabled={Boolean(busyId)} onClick={() => updateStatus(action.id, 'DISMISSED')} type="button">Dismiss</button></> : null}
                  {statusFilter !== 'OPEN' ? <button className="privacy-action" disabled={Boolean(busyId)} onClick={() => updateStatus(action.id, 'OPEN')} type="button">Return to review</button> : null}
                </div>
              </li>
            ))}
          </ul>
          <Pagination label="Privacy Inbox pages" onPageChange={setPage} pagination={result.pagination} />
        </Card>
      ) : result ? <EmptyState title="No actions in this view">Choose another status to find your other actions.</EmptyState> : null}
    </PrivacyPageLayout>
  )
}

export default PrivacyInboxPage
