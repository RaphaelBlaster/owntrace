import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from '../workspace/workspace-navigation.jsx'
import { readTopKQuery } from './top-k-query.js'
import api from '../../services/api.js'
import { ActionButton, EmptyResult, ScreenHeader, ServiceIcon, Tag } from '../../demo/components.jsx'
import './top-k.css'

const providers = { gmail: 'Gmail', outlook: 'Outlook' }
const important = new Set(['job', 'jobs', 'order', 'orders', 'subscription', 'subscriptions', 'security', 'finance', 'travel', 'social'])
const review = new Set(['marketing', 'spam', 'personal', 'other'])
const date = value => value ? new Date(value).toLocaleString() : 'Date unavailable'
const pretty = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
const messageOf = error => error.response?.data?.message || 'Top K could not be updated. Your displayed results are unchanged.'
const kindLabel = value => value === 'application' ? 'Application update' : value === 'opportunity' ? 'Job recommendation' : 'Other signal'

function retryDelay(error) {
  const value = error.response?.headers?.['retry-after']
  if (!value) return 5000
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 1000), 60000)
  const time = Date.parse(value)
  return Number.isFinite(time) ? Math.min(Math.max(time - Date.now(), 1000), 60000) : 5000
}

function CompanyLogo({ company }) {
  const fallback = String(company?.name || '?').trim().charAt(0).toUpperCase() || '?'
  return <span className="ot-top-k-company-logo" aria-hidden="true">
    <span>{fallback}</span>
    {company?.logoUrl ? <img src={company.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => event.currentTarget.remove()} /> : null}
  </span>
}

function ApplicationCard({ item }) {
  const events = Array.isArray(item.events) ? item.events : []
  const status = item.status ? pretty(item.status) : 'Status unknown'
  const isJob = item.category === 'jobs'
  return <article className="ot-top-k-application">
    <header className="ot-top-k-application-head">
      <CompanyLogo company={item.company} />
      <div className="ot-top-k-application-identity">
        <h4>{isJob ? item.company?.name || 'Company not identified' : item.title}</h4>
        {isJob ? <p>{item.role || item.title || 'Role not identified'}</p> : null}
        {item.company?.domain ? <small>{item.company.domain}</small> : null}
      </div>
      <div className="ot-top-k-application-badges">
        {isJob ? <span className={`ot-top-k-kind is-${item.kind || 'unresolved'}`}>{kindLabel(item.kind)}</span> : null}
        {isJob && item.kind !== 'opportunity' && item.match === 'unresolved' ? <span className="ot-top-k-kind is-unresolved">Unlinked update</span> : null}
        {item.kind !== 'opportunity' ? <span className="ot-top-k-status">{status}</span> : null}
      </div>
    </header>
    {item.summary ? <p className="ot-top-k-application-summary">{item.summary}</p> : null}
    <div className="ot-top-k-application-meta">
      <span>{date(item.occurredAt)}</span>
      <span>{item.messageCount || 1} {item.messageCount === 1 ? 'message' : 'messages'}</span>
      {item.senderDomain ? <span>Email from {item.senderDomain}</span> : null}
      {item.actionRequired ? <span className="ot-top-k-action-needed">Action needed</span> : null}
    </div>
    {events.length ? <details className="ot-top-k-timeline">
      <summary>Timeline <span>{events.length} {events.length === 1 ? 'update' : 'updates'}</span></summary>
      <ol>
        {events.map((event, index) => <li key={event.id || `${event.status}-${event.occurredAt}-${index}`}>
          <span className="ot-top-k-timeline-marker" aria-hidden="true" />
          <div className="ot-top-k-timeline-copy">
            <div><strong>{item.kind === 'opportunity' ? 'Job recommendation' : event.status ? pretty(event.status) : 'Update'}</strong><time dateTime={event.occurredAt || undefined}>{date(event.occurredAt)}</time></div>
            {event.summary ? <p>{event.summary}</p> : null}
            {event.evidence ? <blockquote>{event.evidence}</blockquote> : null}
          </div>
        </li>)}
      </ol>
    </details> : item.evidence ? <details className="ot-top-k-timeline ot-top-k-evidence">
      <summary>Evidence <span>1 message</span></summary>
      <blockquote>{item.evidence}</blockquote>
    </details> : null}
  </article>
}

export default function TopKPage() {
  const [params, setParams] = useSearchParams()
  const [k, setK] = useState(3)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [groupViews, setGroupViews] = useState({})
  const [loadingGroups, setLoadingGroups] = useState({})
  const query = readTopKQuery(params)
  const jobFilters = useMemo(() => ({ search: query.search, status: query.status, kind: query.kind }), [query.search, query.status, query.kind])
  const [jobSearch, setJobSearch] = useState(query.search)
  useEffect(() => { setJobSearch(query.search) }, [query.search])

  const load = useCallback(async ({ signal } = {}) => {
    try {
      const response = await api.get('/top-k', { params: { k }, signal })
      setData(response.data)
      setRefreshVersion(value => value + 1)
      setError('')
      return 5000
    } catch (failure) {
      if (failure.code === 'ERR_CANCELED') return 5000
      setError(messageOf(failure))
      return retryDelay(failure)
    }
  }, [k])

  useEffect(() => {
    const controller = new AbortController()
    void load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])

  const active = ['QUEUED', 'RUNNING'].includes(data?.analysis?.status)
  useEffect(() => {
    if (!active || busy) return undefined
    let timer, controller
    let cancelled = false
    const poll = async () => {
      controller = new AbortController()
      const delay = await load({ signal: controller.signal })
      if (!cancelled) timer = setTimeout(poll, delay)
    }
    timer = setTimeout(poll, 5000)
    return () => { cancelled = true; clearTimeout(timer); controller?.abort() }
  }, [active, busy, load])

  const top = useMemo(() => {
    const byCategory = new Map((data?.categories || []).map(category => [category.category, category]))
    return (data?.topCategories || []).map(category => byCategory.get(category)).filter(category => category && important.has(category.category)).slice(0, k)
  }, [data, k])
  const selectedName = params.has('category') ? query.category : top[0]?.category || 'jobs'
  const selectedCategory = selectedName === 'all' ? { category: 'all', label: 'All email updates', count: data?.categories?.reduce((sum, category) => sum + category.count, 0) || 0 } : data?.categories?.find(category => category.category === selectedName) || { category: selectedName, label: pretty(selectedName), count: 0 }
  const scansBusy = active || busy

  async function changeConsent(enabled) {
    setBusy(true); setError('')
    try {
      await api.put('/top-k/consent', { enabled, version: 1 })
      await load()
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function scan(provider) {
    setBusy(true); setError('')
    try { await api.post('/top-k/scans', { provider }); await load() }
    catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function stop(provider) {
    setBusy(true); setError('')
    try { await api.delete(`/top-k/scans/${provider}`); await load() }
    catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function updateCompanyDetails() {
    setBusy(true); setError('')
    try { await api.post('/top-k/enrichment', {}); await load() }
    catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  function updateView(patch) {
    setParams(current => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(patch)) {
        if (value === '') next.delete(key)
        else next.set(key, String(value))
      }
      return next
    })
  }
  const fetchGroups = useCallback(async (category, options) => {
    const { page, limit, filters, signal } = options
    const key = JSON.stringify([category, limit, filters, page])
    setLoadingGroups({ [key]: true })
    try {
      const response = await api.get('/top-k/groups', { params: { category: category === 'all' ? '' : category, page, limit, ...filters }, signal })
      if (!signal.aborted) { setGroupViews({ [key]: response.data }); setError('') }
    } catch (failure) { if (!signal.aborted) setError(messageOf(failure)) }
    finally { if (!signal.aborted) setLoadingGroups({}) }
  }, [])
  const ready = Boolean(data), observedAt = data?.analysis?.observedAt
  useEffect(() => {
    if (!ready) return undefined
    const controller = new AbortController()
    void fetchGroups(selectedName, { page: query.page, limit: query.limit, filters: jobFilters, signal: controller.signal })
    return () => controller.abort()
  }, [ready, selectedName, query.page, query.limit, jobFilters, observedAt, refreshVersion, fetchGroups])

  function applyJobFilters(event) { event.preventDefault(); updateView({ search: jobSearch.trim(), page: 1 }) }
  function changeJobFilter(name, value) { updateView({ [name]: value, page: 1 }) }
  function changeCategoryLimit(_category, limit) { updateView({ limit, page: 1 }) }

  function renderCategory(category, rankIndex = null) {
    const limit = query.limit
    const key = JSON.stringify([category.category, limit, jobFilters, query.page])
    const view = groupViews[key] || { insights: [], pagination: { page: query.page, limit, total: 0, pages: 0 }, pending: true }
    const rows = view.insights || []
    const page = view.pagination?.page || 1
    const pages = Math.max(1, view.pagination?.pages || Math.ceil((view.pagination?.total || 0) / limit))
    const total = view.pagination?.total ?? category.count ?? rows.length
    const loading = Boolean(view.pending || loadingGroups[key])
    return <article className={`dx-card ot-top-k-category${review.has(category.category) ? ' ot-top-k-reviewed' : ''}`} key={category.category}>
      <header>
        {rankIndex !== null ? <span className="ot-top-k-rank">{String(rankIndex + 1).padStart(2, '0')}</span> : null}
        <div><h3>{category.label || pretty(category.category)}</h3><p>{view.pending ? 'Loading matching results...' : `${view.counts?.messages ?? total} emails / ${total} results`}</p></div>
        <Tag>{pretty(category.category)}</Tag>
      </header>
      <form className="ot-top-k-job-filters" onSubmit={applyJobFilters}>
        <label>{category.category === 'jobs' ? 'Search jobs' : 'Search updates'} <input type="search" value={jobSearch} onChange={event => setJobSearch(event.target.value)} placeholder="Company or role" /></label>
        <button type="submit" disabled={loading}>Search</button>
        <label>Show <select value={jobFilters.kind} onChange={event => void changeJobFilter('kind', event.target.value)}><option value="all">Applications and job recommendations</option><option value="applications">Applications</option><option value="opportunities">Job recommendations</option></select></label>
        <label>Status <select value={jobFilters.status} onChange={event => void changeJobFilter('status', event.target.value)}><option value="">All statuses</option><option value="application_received">Received</option><option value="assessment">Assessment</option><option value="interview">Interview</option><option value="offer">Offer</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option><option value="unknown">Unknown</option><option value="alert">Alert</option><option value="received">Received update</option><option value="confirmed">Confirmed</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="charged">Charged</option><option value="updated">Updated</option></select></label>
      </form>
      {view.counts && category.category === 'jobs' && jobFilters.kind !== 'opportunities' ? <div className="ot-top-k-status-totals" aria-label="Saved application status totals">{[['application_received', 'Received'], ['rejected', 'Rejected'], ['interview', 'Interview'], ['assessment', 'Assessment'], ['offer', 'Offer'], ['withdrawn', 'Withdrawn']].filter(([status]) => view.counts.eventStatuses?.[status]).map(([status, label]) => <button key={status} type="button" aria-pressed={jobFilters.status === status} onClick={() => changeJobFilter('status', jobFilters.status === status ? '' : status)}>{label} <strong>{view.counts.eventStatuses[status]}</strong></button>)}</div> : null}
      {rows.length ? <div className="ot-top-k-application-list">{rows.map(item => <ApplicationCard key={item.id} item={item} />)}</div> : <p className="ot-top-k-muted">{loading ? 'Loading results...' : 'No results in this category yet.'}</p>}
      <footer className="ot-top-k-pagination">
        <label>Per page <select aria-label={`${category.label || category.category} results per page`} value={limit} onChange={event => void changeCategoryLimit(category.category, event.target.value)}><option value={6}>6</option><option value={12}>12</option><option value={24}>24</option></select></label>
        <span>Page {page} of {pages}</span>
        <div><button type="button" disabled={loading || page <= 1} onClick={() => updateView({ page: page - 1 })}>Previous</button><button type="button" disabled={loading || page >= pages} onClick={() => updateView({ page: page + 1 })}>Next</button></div>
      </footer>
    </article>
  }

  const connections = data?.connections || []
  return <section className="ot-top-k">
    <ScreenHeader kicker="EMAIL SIGNALS" title="The few things worth your attention." description="Jev filters mailbox noise first. Mercury classifies eligible messages; OwnTrace groups application updates and ranks useful signals." actions={<><label className="ot-top-k-count">Show top <select aria-label="Number of top categories" value={k} disabled={scansBusy} onChange={event => setK(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => index + 1).map(value => <option key={value}>{value}</option>)}</select></label><ActionButton disabled={scansBusy} onClick={async () => { setBusy(true); setError(''); try { await load() } finally { setBusy(false) } }}>{busy ? 'Refreshing...' : active ? 'Scanning...' : 'Refresh'}</ActionButton></>} />

    {error ? <p role="alert" className="ot-top-k-error">{error}</p> : null}

    <details className="ot-top-k-settings" open={!data?.analysis?.enabled}>
      <summary>Analysis settings and mailbox access</summary>
    <section className="dx-card ot-top-k-panel" aria-labelledby="top-k-consent-title">
      <div><h2 id="top-k-consent-title">Private email analysis</h2><p>Each scan checks at most the latest 250 messages from a connected mailbox. Jev receives minimized sender-domain and subject data to remove marketing, spam, personal mail and noise. Mercury receives eligible redacted body excerpts to classify jobs, orders, subscriptions, security, finance, travel and social updates.</p><p>No attachments are sent. OwnTrace stores derived summaries and short evidence excerpts only. You can disable analysis at any time; this stops queued and active scans.</p></div>
      <p className="ot-top-k-consent-state" role="status">{data ? (data.analysis.enabled ? 'Analysis is enabled' : 'Analysis is disabled') : 'Loading analysis settings...'}</p>
      <ActionButton disabled={!data || busy} onClick={() => void changeConsent(!data?.analysis?.enabled)}>{data?.analysis?.enabled ? 'Disable analysis' : 'Enable analysis'}</ActionButton>
    </section>

    <section className="ot-top-k-panel" aria-labelledby="top-k-mailboxes-title">
      <header className="ot-top-k-section-heading"><div><h2 id="top-k-mailboxes-title">Mailboxes</h2><p>Body access is requested only when you choose to connect a provider for this feature.</p></div><Tag>{data?.analysis?.processed ?? 0}/{data?.analysis?.limit ?? 250} processed</Tag></header>
      <div className="ot-top-k-connections">{Object.entries(providers).map(([provider, label]) => {
        const connection = connections.find(item => item.provider === provider)
        const running = data?.analysis?.provider === provider && ['QUEUED', 'RUNNING'].includes(data.analysis.status)
        return <article className="dx-card ot-top-k-connection" key={provider}>
          <ServiceIcon account={{ name: label, color: provider === 'gmail' ? '#4285f4' : '#1473e6' }} />
          <div><h3>{label}</h3><p>{connection?.connected ? (connection.bodyAccess ? 'Connected / body access granted' : 'Connected / body access needed') : 'Not connected'}</p></div>
          {connection?.oauthUrl && !connection.bodyAccess ? <a className="ot-top-k-link" href={connection.oauthUrl}>Grant body access</a> : null}
          {connection?.connected && connection.bodyAccess ? <ActionButton disabled={running ? busy : !data?.analysis?.enabled || scansBusy || !data?.configured} onClick={() => running ? void stop(provider) : void scan(provider)}>{running ? 'Stop scan' : data?.analysis?.provider === provider && data.analysis.status === 'FAILED' ? 'Resume scan' : 'Scan latest 250'}</ActionButton> : connection?.oauthUrl ? null : <span className="ot-top-k-muted">Connect mailbox in Settings</span>}
        </article>
      })}</div>
      {!data?.configured ? <p className="ot-top-k-muted">Email classification is not configured on this server.</p> : null}
      {data?.analysis?.phase === 'enrichment' ? <p role="status">Updating company details: {data.analysis.enrichmentProcessed}/250 messages checked. Your completed scan is preserved.</p> : null}
      {data?.analysis?.enabled && data.analysis.processed === 250 ? <ActionButton disabled={scansBusy} onClick={() => void updateCompanyDetails()}>Update company details</ActionButton> : null}
      {data?.analysis?.lastErrorCode ? <p className="ot-top-k-error" role="status">Last scan: {pretty(data.analysis.lastErrorCode)}</p> : null}
    </section>

    </details>

    <section aria-labelledby="top-k-ranked-title">
      <header className="ot-top-k-section-heading"><div><h2 id="top-k-ranked-title">Your top {k} categories</h2><p>Choose one category to open its results.</p></div><Tag>{top.length} ranked</Tag></header>
      <nav className="ot-top-k-category-tabs" aria-label="Top categories">
        {top.map((category, index) => <Link key={category.category} to={`/top-k?category=${category.category}`} aria-current={selectedCategory?.category === category.category ? 'page' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{category.label}<small>{category.count} messages</small></Link>)}
      </nav>
      {data ? <label className="ot-top-k-category-select">Browse category <select value={selectedCategory?.category || 'jobs'} onChange={event => updateView({ category: event.target.value, kind: 'all', status: '', search: '', page: 1 })}><option value="all">All email updates</option>{data.categories.map(category => <option key={category.category} value={category.category}>{category.label} ({category.count})</option>)}</select></label> : null}
    </section>

    <section className="ot-top-k-single" aria-label="Selected category results">
      {active ? <p role="status" className="ot-top-k-muted">Refreshing results. Saved findings stay visible while updates are processed.</p> : null}
      {!data ? <p role="status">Loading results…</p> : selectedCategory ? renderCategory(selectedCategory) : <EmptyResult title="No results yet" description="Enable analysis and scan a connected mailbox to get started." />}
    </section>
  </section>
}
