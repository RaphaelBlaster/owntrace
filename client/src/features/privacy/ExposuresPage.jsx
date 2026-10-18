import { Card } from '../../ui/components.jsx'
import { useEffect, useState } from 'react'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, Pagination, StatusPill } from './PrivacyPageLayout.jsx'
import { formatDate, formatEnum } from './privacy-format.js'

function ExposuresPage() {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.get('/exposures', { params: { limit: 12, page }, signal: controller.signal })
      .then((response) => setResult(response.data))
      .catch((requestError) => {
        if (requestError.code !== 'ERR_CANCELED') setError(requestError.response?.data?.message || 'OwnTrace could not load exposure review signals.')
      })
    return () => controller.abort()
  }, [page])

  return (
    <PrivacyPageLayout
      description="A review queue derived from your discovered services, activity inference, and security metadata. It does not claim that personal data is publicly exposed."
      eyebrow="Exposures"
      title="Digital exposure"
    >
      <p className="privacy-note">Every item is an OwnTrace account-evidence signal. Public exposure remains unverified until a dedicated source is integrated.</p>
      {error ? <ErrorState>{error}</ErrorState> : null}
      {!result && !error ? <LoadingState>Loading exposure review signals…</LoadingState> : null}
      {result?.exposureSignals.length ? (
        <Card className="privacy-card " aria-labelledby="exposure-list-title">
          <div className="privacy-section-heading"><div><p>Evidence-based review</p><h2 id="exposure-list-title">Service footprint</h2></div><StatusPill>{result.pagination.total} services</StatusPill></div>
          <ul className="privacy-list">
            {result.exposureSignals.map((signal) => (
              <li className="privacy-list-item" key={signal.accountId}>
                <div><strong>{signal.serviceName}</strong><p>{signal.primaryDomain} · First observed {formatDate(signal.firstSeenAt)}</p><small>{formatEnum(signal.dormantStatus)} · {formatEnum(signal.confidenceLevel)} evidence</small></div>
                <StatusPill tone={signal.level.toLowerCase()}>{formatEnum(signal.level)} review</StatusPill>
              </li>
            ))}
          </ul>
          <Pagination label="Exposure review pages" onPageChange={setPage} pagination={result.pagination} />
        </Card>
      ) : result ? <EmptyState title="No account evidence yet">Complete a mail metadata scan to build the service footprint.</EmptyState> : null}
    </PrivacyPageLayout>
  )
}

export default ExposuresPage
