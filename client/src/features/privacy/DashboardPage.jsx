import { Card } from '../../ui/components.jsx'
import { useEffect, useState } from 'react'
import { Link } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, StatusPill } from './PrivacyPageLayout.jsx'
import { formatDate, formatEnum } from './privacy-format.js'

function DashboardPage() {
  const [result, setResult] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    setResult(null)
    Promise.allSettled([
      api.get('/accounts', { ...options, params: { limit: 5, page: 1 } }),
      api.get('/account-actions', { ...options, params: { limit: 5, page: 1, status: 'OPEN' } }),
    ]).then(([accounts, actions]) => {
      if (!controller.signal.aborted) setResult({ accounts, actions })
    })
    return () => controller.abort()
  }, [refreshKey])

  const accounts = result?.accounts.status === 'fulfilled' ? result.accounts.value.data : null
  const actions = result?.actions.status === 'fulfilled' ? result.actions.value.data : null
  const hasErrors = result && (!accounts || !actions)

  return (
    <PrivacyPageLayout eyebrow="Dashboard" title="What needs your attention?" description="Review the accounts OwnTrace found, then choose which actions to take.">
      {!result ? <LoadingState>Loading your accounts and next steps…</LoadingState> : null}
      {hasErrors ? <><ErrorState>Some of your overview could not load. Available results are shown below.</ErrorState><button className="privacy-action" onClick={() => setRefreshKey((value) => value + 1)} type="button">Retry overview</button></> : null}
      {accounts?.pagination.total === 0 ? (
        <Card className="privacy-card dashboard-next-step">
          <p className="privacy-card-label">Your next step</p><h2>Choose a mail source to find account clues.</h2>
          <p>Connect Gmail or Microsoft and run a scan. You can review its findings before taking any action.</p>
          <Link className="privacy-action is-primary" to="/connect">Choose a mail connection</Link>
        </Card>
      ) : accounts ? (
        <Card className="privacy-card dashboard-next-step">
          <p className="privacy-card-label">Your next step</p><h2>{actions?.pagination.total ? 'Review your suggested actions.' : 'Check the evidence behind your accounts.'}</h2>
          <p>{accounts.pagination.total} discovered {accounts.pagination.total === 1 ? 'account' : 'accounts'}. Findings are based on available evidence, not a complete inventory of your online life.</p>
          <Link className="privacy-action is-primary" to={actions?.pagination.total ? '/privacy-inbox' : '/accounts'}>{actions?.pagination.total ? 'Review actions' : 'Review accounts'}</Link>
        </Card>
      ) : null}
      <div className="privacy-grid">
        {actions ? <Card className="privacy-card is-half" aria-labelledby="dashboard-actions-title">
          <div className="privacy-section-heading"><h2 id="dashboard-actions-title">Suggested actions</h2><Link to="/privacy-inbox">All actions</Link></div>
          {actions.actions.length ? <ul className="privacy-list">{actions.actions.map((action) => <li className="privacy-list-item" key={action.id}>
            <div><strong>{action.title}</strong><p>{action.reason}</p></div><StatusPill tone={action.priority.toLowerCase()}>{formatEnum(action.priority)}</StatusPill>
          </li>)}</ul> : <EmptyState title="No open suggestions">You can review in-progress and completed items on the Actions page. This does not mean every account is secure.</EmptyState>}
        </Card> : null}
        {accounts ? <Card className="privacy-card is-half" aria-labelledby="dashboard-accounts-title">
          <div className="privacy-section-heading"><h2 id="dashboard-accounts-title">Recent account evidence</h2><Link to="/accounts">All accounts</Link></div>
          {accounts.accounts.length ? <ul className="privacy-list">{accounts.accounts.map((account) => <li className="privacy-list-item" key={account.id}>
            <div><Link to={'/accounts/' + account.id}>{account.serviceName}</Link><p>{account.primaryDomain} · Last signal {formatDate(account.lastSeenAt)}</p></div><StatusPill>{formatEnum(account.confidenceLevel)}</StatusPill>
          </li>)}</ul> : <EmptyState title="No accounts found yet">Your scan results will appear here. You can add or review connections at any time.</EmptyState>}
        </Card> : null}
      </div>
    </PrivacyPageLayout>
  )
}

export default DashboardPage
