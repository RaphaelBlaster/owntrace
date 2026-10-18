import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../services/api.js'
import { ActionButton, EmptyResult, Modal, ScreenHeader, ServiceIcon, Tag } from '../../demo/components.jsx'
import { Link } from '../workspace/workspace-navigation.jsx'
import './orders.css'

const names = { gmail: 'Gmail', outlook: 'Outlook' }
const statuses = ['placed','confirmed','shipped','out_for_delivery','delivered','cancelled','refunded','unknown']
const readable = value => value.replaceAll('_', ' ')
const brandNames = { 'amazon.com':'Amazon', 'amazon.in':'Amazon', 'spotify.com':'Spotify', 'netflix.com':'Netflix', 'apple.com':'Apple', 'microsoft.com':'Microsoft', 'adobe.com':'Adobe', 'dropbox.com':'Dropbox' }
const logoName = merchant => Object.entries(brandNames).find(([domain]) => merchant.domain === domain || merchant.domain.endsWith('.' + domain))?.[1] || merchant.domain.charAt(0).toUpperCase()
const date = value => value ? new Date(value).toLocaleString() : 'Not available'
const amount = order => order.amountMinor === null || !order.currency ? 'Amount unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: order.currency }).format(order.amountMinor / (order.currency === 'JPY' ? 1 : 100))
export default function OrdersPage() {
  const [params, setParams] = useSearchParams(), query = params.toString()
  const [data, setData] = useState(null), [status, setStatus] = useState(null), [detail, setDetail] = useState(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [consentOpen, setConsentOpen] = useState(false)
  const [agree, setAgree] = useState(false), [daily, setDaily] = useState(false)
  const [period, setPeriod] = useState(''), [merchantDomain, setMerchantDomain] = useState('')
  const load = useCallback(async signal => {
    const search = new URLSearchParams(query)
    const page = /^\d+$/.test(search.get('page') || '') ? Number(search.get('page')) : 1
    const [list, state] = await Promise.all([api.get('/orders', { signal, params: { page, limit: 12, provider: search.get('provider') || undefined, status: search.get('status') || undefined } }), api.get('/orders/status', { signal })])
    setData(list.data); setStatus(state.data)
    const focus = search.get('focus')
    if (focus && /^[a-f\d]{24}$/i.test(focus)) setDetail((await api.get('/orders/' + focus, { signal })).data)
    else setDetail(null)
  }, [query])
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch(failure => { if (!controller.signal.aborted) setError(failure.response?.data?.message || 'Orders could not load.') })
    return () => controller.abort()
  }, [load])
  const active = status?.scans.some(scan => ['QUEUED','RUNNING'].includes(scan.status))
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const timer = setInterval(() => load(controller.signal).catch(() => {}), 4000)
    return () => { clearInterval(timer); controller.abort() }
  }, [active, load])
  function change(key, value) { setParams(previous => { const next = new URLSearchParams(previous); if(key !== 'focus')next.delete('page'); if(value)next.set(key, value); else next.delete(key); return next }) }
  async function mutate(operation) {
    setBusy(true); setError('')
    try { await operation(); await load(); setConsentOpen(false) }
    catch (failure) { setError(failure.response?.data?.message || 'This request could not complete.') }
    finally { setBusy(false) }
  }
  const scanOptions = { ...(period ? { days: Number(period) } : {}), ...(merchantDomain.trim() ? { merchantDomain: merchantDomain.trim().toLowerCase() } : {}) }
  return <section className="ot-orders">
    <ScreenHeader kicker="YOUR PURCHASE TIMELINE" title="Your orders, with the evidence." description="Purchase and delivery events reported by email. Missing details stay unknown; these are not live carrier updates." actions={<ActionButton onClick={() => { setAgree(Boolean(status?.consent.enabled)); setDaily(Boolean(status?.consent.daily)); setConsentOpen(true) }}>Email analysis settings</ActionButton>} />
    {error ? <p role="alert" className="ot-order-notice">{error} <button type="button" onClick={() => { setError(''); void load().catch(() => setError('Orders could not load.')) }}>Retry</button></p> : null}
    <div className="ot-order-controls dx-card">
      <div><h2>Scan connected mailboxes</h2><p>Initial import: up to 200 inbox messages from the last 30 days. Updates inspect new messages; on-demand scans process up to 50. Daily scans are optional.</p><p>Metadata only. No full messages or attachments are read.</p></div>
      <div className="ot-order-filters"><label>On-demand period<select value={period} onChange={event => setPeriod(event.target.value)}><option value="">Resume saved window / check updates</option>{[7,30,90].map(days => <option key={days} value={days}>Last {days} days</option>)}</select></label><label>On-demand sender domain<input value={merchantDomain} onChange={event => setMerchantDomain(event.target.value)} placeholder="Optional, e.g. amazon.in" maxLength={253} /></label><small>Filters apply within the bounded messages inspected; they do not search the entire inbox.</small></div>
      <div className="ot-order-actions">{Object.entries(names).map(([provider, name]) => {
        const scan = status?.scans.find(item => item.provider === provider), scanning = ['QUEUED','RUNNING'].includes(scan?.status)
        return <div key={provider}><strong>{name}</strong><p role="status">{scan ? `${readable(scan.status.toLowerCase())} · ${scan.processed}/${scan.limit} checked · ${scan.stored} saved · ${scan.reviewed} uncertain` : 'No order scan yet'}</p>{scan?.lastErrorCode ? <small>{({ ORDER_DAILY_BUDGET:'Daily allowance reached. Resume tomorrow.', ORDER_RUN_LIMIT:'Run limit reached; more messages remain.', ORDER_AI_INVALID:'Analysis returned unsupported data. Retry the scan.', ORDER_AI_UNAVAILABLE:'Analysis provider unavailable. Retry later.' })[scan.lastErrorCode] || 'Scan paused or failed. Reconnect the mailbox or retry.'}</small> : null}<div>{scanning ? <ActionButton disabled={busy} onClick={() => mutate(() => api.delete('/orders/scans/' + provider))}>Stop {name} scan</ActionButton> : <ActionButton disabled={busy || !status?.configured || !status?.consent.enabled} onClick={() => mutate(() => api.post('/orders/scans', { provider, mode: scan ? 'on_demand' : 'initial', ...(scan ? scanOptions : {}) }))}>{scan ? 'Update / resume' : 'Start import'}</ActionButton>} <Link to={provider === 'gmail' ? '/connect/gmail' : '/connect/microsoft'}>Connect {name}</Link></div></div>
      })}</div>
      {!status?.configured ? <p>Inception email analysis is not configured on this server.</p> : !status?.consent.enabled ? <p>Enable email analysis settings before scanning. Connecting a mailbox alone does not enable AI processing.</p> : <p>Daily updates: {status.consent.daily ? 'enabled' : 'disabled'}. Allowances can pause a scan; saved work resumes without reprocessing unchanged messages.</p>}
    </div>
    <div className="ot-order-filters"><label>Mailbox<select value={params.get('provider') || ''} onChange={event => change('provider', event.target.value)}><option value="">All mailboxes</option>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>Status<select value={params.get('status') || ''} onChange={event => change('status', event.target.value)}><option value="">All events</option>{statuses.map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label><span>{data?.pagination.total ?? '…'} email events</span></div>
    {!data ? <p role="status">Loading orders…</p> : !data.orders.length ? <EmptyResult title="No matching order evidence yet" description="Connect a mailbox, enable analysis and start an import. Only supported order events will appear here." /> : <div className="ot-order-grid">{data.orders.map(order => <article className="dx-card ot-order-card" key={order.id} data-trace-entity={order.id}>
      <header><ServiceIcon account={{ name: logoName(order.merchant), color: '#40849a' }} /><div><h2>{order.merchant.name}</h2><small>{order.merchant.domain}</small></div><Tag>{readable(order.status)}</Tag></header>
      <p>{order.summary}</p><dl><div><dt>Order reference</dt><dd>{order.orderReference || 'Not available'}</dd></div><div><dt>Amount</dt><dd>{amount(order)}</dd></div><div><dt>Expected delivery</dt><dd>{order.expectedDelivery || 'Not stated'}</dd></div></dl>
      <footer><small>{names[order.source.provider]} · {date(order.occurredAt)}</small><ActionButton onClick={() => change('focus', order.id)}>View evidence</ActionButton></footer>
    </article>)}</div>}
    {data?.pagination.pages > 1 ? <nav className="ot-order-pagination" aria-label="Order pages"><ActionButton disabled={data.pagination.page <= 1} onClick={() => change('page', String(data.pagination.page - 1))}>Previous</ActionButton><span>Page {data.pagination.page} of {data.pagination.pages}</span><ActionButton disabled={data.pagination.page >= data.pagination.pages} onClick={() => change('page', String(data.pagination.page + 1))}>Next</ActionButton></nav> : null}
    {detail ? <Modal title="Order evidence timeline" onClose={() => change('focus', '')} wide><p>Events are grouped only by the same sender domain and an explicit matching order reference. Email senders and fulfilment claims are not independently verified.</p>{detail.timeline.map(event => <article className="ot-order-evidence" key={event.id} data-trace-entity={event.id}><h3>{readable(event.status)} · {names[event.source.provider]}</h3><p>{date(event.occurredAt)} · {event.summary}</p>{Object.entries(event.evidence).filter(([, value]) => value).map(([key, value]) => <p key={key}><strong>{key}: </strong><q>{value}</q></p>)}</article>)}</Modal> : null}
    {consentOpen ? <Modal title="Order email analysis" onClose={() => !busy && setConsentOpen(false)} wide><p>With your permission, OwnTrace sends minimized inbox metadata (sender domain, a locally redacted subject and timestamp) to Inception Labs for classification and order-card extraction. Subjects can still contain personal information; redaction and classification are imperfect.</p><p>No email bodies or attachments are read. OwnTrace saves derived events, short evidence excerpts and message hashes. Personal or uncertain messages do not become order cards. Saved order evidence remains until its source or your account is deleted. Disabling analysis stops queued and active work.</p><label className="ot-order-check"><input type="checkbox" checked={agree} onChange={event => { setAgree(event.target.checked); if (!event.target.checked) setDaily(false) }} />I agree to this metadata processing by Inception Labs.</label><label className="ot-order-check"><input type="checkbox" checked={daily} disabled={!agree} onChange={event => setDaily(event.target.checked)} />Also check for new order emails daily, within the displayed limits.</label><div className="dx-modal-footer"><ActionButton disabled={busy} onClick={() => setConsentOpen(false)}>Cancel</ActionButton><ActionButton variant="primary" disabled={busy} onClick={() => mutate(() => api.put('/orders/consent', { enabled: agree, daily, version: 1 }))}>{busy ? 'Saving…' : 'Save preferences'}</ActionButton></div></Modal> : null}
  </section>
}
