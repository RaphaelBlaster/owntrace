import { Card } from '../../ui/components.jsx'
import { useEffect, useState } from 'react'
import { Link } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, Pagination, StatusPill } from './PrivacyPageLayout.jsx'
import { formatDate, formatEnum } from './privacy-format.js'

function NotificationsPage() {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.get('/notifications', { params: { limit: 20, page }, signal: controller.signal })
      .then((response) => setResult(response.data))
      .catch((requestError) => {
        if (requestError.code !== 'ERR_CANCELED') setError(requestError.response?.data?.message || 'OwnTrace could not load notifications.')
      })
    return () => controller.abort()
  }, [page])

  return (
    <PrivacyPageLayout
      description="A bounded, read-only view derived from open account recommendations and privacy requests that are ready or awaiting an outcome."
      eyebrow="Notifications"
      title="Notifications"
    >
      {error ? <ErrorState>{error}</ErrorState> : null}
      {!result && !error ? <LoadingState>Loading notifications…</LoadingState> : null}
      {result?.notifications.length ? (
        <Card className="privacy-card " aria-labelledby="notification-list-title">
          <div className="privacy-section-heading"><div><p>Derived status</p><h2 id="notification-list-title">Attention queue</h2></div><StatusPill>{result.pagination.total} current</StatusPill></div>
          <ul className="privacy-list">
            {result.notifications.map((notification) => (
              <li className="privacy-list-item" key={notification.id}>
                <div><strong>{notification.title}</strong><p>{notification.message}</p><small>{formatDate(notification.createdAt)} · {formatEnum(notification.kind)}</small></div>
                <div className="privacy-actions"><StatusPill tone={notification.priority.toLowerCase()}>{formatEnum(notification.priority)}</StatusPill><Link className="privacy-action" to={notification.target}>Review</Link></div>
              </li>
            ))}
          </ul>
          <Pagination label="Notification pages" onPageChange={setPage} pagination={result.pagination} />
        </Card>
      ) : result ? <EmptyState title="No current notifications">OwnTrace has no open account-action or privacy-request status that needs attention.</EmptyState> : null}
    </PrivacyPageLayout>
  )
}

export default NotificationsPage
