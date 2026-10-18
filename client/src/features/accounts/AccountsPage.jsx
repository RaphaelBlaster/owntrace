import { PageHeader } from '../../ui/components.jsx'
import { useDeferredValue, useEffect, useState } from 'react'
import { Link } from '../workspace/workspace-navigation.jsx'
import api from '../../services/api.js'
import { formatAccountDate, formatEnum } from './account-format.js'
import './accounts.css'

const emptySummary = {
  dormant: 0,
  highConfidence: 0,
  possiblyDormant: 0,
  recentlySeen: 0,
  total: 0,
}

function AccountCard({ account }) {
  const initial = account.serviceName?.charAt(0).toUpperCase() || '?'

  return (
    <li className="account-card">
      <Link to={`/accounts/${account.id}`} aria-label={`View ${account.serviceName} account evidence`}>
        <span className="account-monogram" aria-hidden="true">{initial}</span>
        <span className="account-card-main">
          <span className="account-card-title-row">
            <strong>{account.serviceName}</strong>
            <span className={`account-confidence is-${account.confidenceLevel.toLowerCase()}`}>
              {formatEnum(account.confidenceLevel)}
            </span>
          </span>
          <span className="account-domain">{account.primaryDomain}</span>
          <span className="account-card-meta">
            Last signal {formatAccountDate(account.lastSeenAt)}
            <span aria-hidden="true">·</span>
            {account.evidenceCount} {account.evidenceCount === 1 ? 'signal' : 'signals'}
          </span>
        </span>
        <span className={`account-dormancy is-${account.dormantStatus.toLowerCase()}`}>
          {formatEnum(account.dormantStatus)}
        </span>
        <span className="account-card-arrow" aria-hidden="true">→</span>
      </Link>
    </li>
  )
}

function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [summary, setSummary] = useState(emptySummary)
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 })
  const [search, setSearch] = useState('')
  const [confidence, setConfidence] = useState('')
  const [dormant, setDormant] = useState('')
  const [sort, setSort] = useState('lastSeen')
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    const controller = new AbortController()

    async function loadAccounts() {
      setIsLoading(true)
      setError('')

      try {
        const accountsResponse = await api.get('/accounts', {
          params: {
            confidence: confidence || undefined,
            dormant: dormant || undefined,
            limit: 12,
            page,
            search: deferredSearch || undefined,
            sort,
          },
          signal: controller.signal,
        })
        setAccounts(accountsResponse.data.accounts)
        setPagination(accountsResponse.data.pagination)
      } catch (requestError) {
        if (requestError.code !== 'ERR_CANCELED') {
          setError(
            requestError.response?.data?.message ||
              'OwnTrace could not load your discovered accounts. Try again.',
          )
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadAccounts()
    return () => controller.abort()
  }, [confidence, deferredSearch, dormant, page, sort])

  useEffect(() => {
    const controller = new AbortController()

    api.get('/accounts/summary', { signal: controller.signal })
      .then((response) => setSummary(response.data.summary))
      .catch((requestError) => {
        if (requestError.code !== 'ERR_CANCELED') {
          setError(
            requestError.response?.data?.message ||
              'OwnTrace could not load your account summary. Try again.',
          )
        }
      })

    return () => controller.abort()
  }, [])

  function updateFilter(setter) {
    return (event) => {
      setter(event.target.value)
      setPage(1)
    }
  }

  const hasFilters = Boolean(search || confidence || dormant)

  return (
    <main className="accounts-page">
      <div className="accounts-shell">

        <PageHeader id="accounts-title" eyebrow="Account inventory" title="Your accounts" description="Review the services discovered from your connected sources. Every finding includes its evidence and confidence." />

        <dl className="accounts-summary" aria-label="Account summary">
          <div><dt>Total discovered</dt><dd>{summary.total}</dd></div>
          <div><dt>Likely or confirmed</dt><dd>{summary.highConfidence}</dd></div>
          <div><dt>Dormant</dt><dd>{summary.dormant}</dd></div>
          <div><dt>Seen in 90 days</dt><dd>{summary.recentlySeen}</dd></div>
        </dl>

        <section className="accounts-workspace" aria-labelledby="account-list-title" aria-busy={isLoading}>
          <div className="accounts-workspace-heading">
            <div>
              <p className="accounts-eyebrow">Your services</p>
              <h2 id="account-list-title">Discovered accounts</h2>
            </div>
            <span className="accounts-result-count" role="status">
              {pagination.total} {pagination.total === 1 ? 'result' : 'results'}
            </span>
          </div>

          <div className="accounts-controls">
            <label className="accounts-search">
              <span>Search accounts</span>
              <input
                type="search"
                value={search}
                onChange={updateFilter(setSearch)}
                placeholder="Service or domain"
              />
            </label>
            <label>
              <span>Confidence</span>
              <select value={confidence} onChange={updateFilter(setConfidence)}>
                <option value="">All confidence</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="LIKELY">Likely</option>
                <option value="POSSIBLE">Possible</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </label>
            <label>
              <span>Activity</span>
              <select value={dormant} onChange={updateFilter(setDormant)}>
                <option value="">All activity</option>
                <option value="ACTIVE">Active signal</option>
                <option value="POSSIBLY_DORMANT">Possibly dormant</option>
                <option value="DORMANT">Dormant</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </label>
            <label>
              <span>Sort by</span>
              <select value={sort} onChange={updateFilter(setSort)}>
                <option value="lastSeen">Last signal</option>
                <option value="firstSeen">First signal</option>
                <option value="serviceName">Service name</option>
                <option value="confidence">Confidence</option>
              </select>
            </label>
          </div>

          {error ? <p className="accounts-notice" role="alert">{error}</p> : null}

          {isLoading ? (
            <div className="accounts-loading" role="status">
              <span className="accounts-spinner" aria-hidden="true" />
              <span>Loading discovered accounts…</span>
            </div>
          ) : accounts.length ? (
            <ul className="account-list">
              {accounts.map((account) => <AccountCard key={account.id} account={account} />)}
            </ul>
          ) : (
            <div className="accounts-empty">
              <span className="account-monogram" aria-hidden="true">?</span>
              <h3>{hasFilters ? 'No accounts match these filters.' : 'No accounts discovered yet.'}</h3>
              <p>
                {hasFilters
                  ? 'Adjust the search or filters to see more of your account inventory.'
                  : 'Connect a supported mail source and complete a metadata scan to build your evidence-based inventory.'}
              </p>
              {hasFilters ? (
                <button type="button" onClick={() => {
                  setSearch('')
                  setConfidence('')
                  setDormant('')
                  setPage(1)
                }}>Clear filters</button>
              ) : <Link to="/connect">Go to mail connections</Link>}
            </div>
          )}

          {pagination.pages > 1 ? (
            <nav className="accounts-pagination" aria-label="Account result pages">
              <button type="button" onClick={() => setPage((value) => value - 1)} disabled={page <= 1}>
                Previous
              </button>
              <span>Page {pagination.page} of {pagination.pages}</span>
              <button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= pagination.pages}>
                Next
              </button>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  )
}

export default AccountsPage
