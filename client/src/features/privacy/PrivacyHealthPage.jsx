import { Card } from '../../ui/components.jsx'
import { useEffect, useState } from 'react'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, StatusPill } from './PrivacyPageLayout.jsx'
import { formatEnum } from './privacy-format.js'

function PrivacyHealthPage() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.get('/privacy-health', { signal: controller.signal })
      .then((response) => setHealth(response.data.health))
      .catch((requestError) => {
        if (requestError.code !== 'ERR_CANCELED') setError(requestError.response?.data?.message || 'OwnTrace could not calculate Privacy Health.')
      })
    return () => controller.abort()
  }, [])

  return (
    <PrivacyPageLayout
      description="A deterministic estimate based on current account confidence, dormancy, and open recommendation priority. The same inputs always produce the same result."
      eyebrow="Privacy Health"
      title="Privacy health"
    >
      {error ? <ErrorState>{error}</ErrorState> : null}
      {!health && !error ? <LoadingState>Calculating Privacy Health…</LoadingState> : null}
      {health?.score === null ? <EmptyState title="Not enough data">{health.summary}</EmptyState> : null}
      {health?.score !== null && health ? (
        <div className="privacy-grid">
          <Card className="privacy-card is-narrow" aria-labelledby="health-score-title">
            <p className="privacy-card-label">Current estimate</p>
            <h2 id="health-score-title">Privacy Health</h2>
            <div className="privacy-score" aria-label={`Privacy Health ${health.score} out of 100`}>{health.score}</div>
            <StatusPill tone="good">{formatEnum(health.confidence)}</StatusPill>
          </Card>
          <Card className="privacy-card is-wide" aria-labelledby="health-factors-title">
            <div className="privacy-section-heading"><div><p>Explainable calculation</p><h2 id="health-factors-title">Current penalty factors</h2></div></div>
            <ul className="privacy-list">
              {health.factors.map((factor) => (
                <li className="privacy-list-item" key={factor.id}><div><strong>{formatEnum(factor.id)}</strong><p>Deducted from the 100-point baseline using documented bounded rules.</p></div><StatusPill tone={factor.penalty ? 'medium' : 'good'}>−{factor.penalty}</StatusPill></li>
              ))}
            </ul>
            <p className="privacy-note">{health.summary}</p>
          </Card>
        </div>
      ) : null}
    </PrivacyPageLayout>
  )
}

export default PrivacyHealthPage
