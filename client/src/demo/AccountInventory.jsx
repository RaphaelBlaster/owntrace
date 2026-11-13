import { useMemo } from 'react'
import Pagination from './Pagination.jsx'
import { usePagination } from './use-pagination.js'
import { useSearchParams } from 'react-router-dom'
import { Link } from './prism-navigation.jsx'
import { useDemo } from './context.js'
import { ActionButton, EmptyResult, Icon, ScreenHeader, ServiceIcon, Tag } from './components.jsx'

const statuses = ['All accounts', 'Active', 'Needs review', 'Dormant']
const toneFor = value => ['Confirmed', 'Active'].includes(value) ? 'green' : ['Likely', 'Needs review'].includes(value) ? 'amber' : 'neutral'
function AccountLabel({ account }) {
  return <div className="dx-account-name"><ServiceIcon account={account} /><div><strong>{account.name}</strong><span>{account.domain}</span></div></div>
}

export default function AccountInventory() {
  const { live, summary, accountPagination, accounts } = useDemo()
  const [params, setParams] = useSearchParams()
  const categories = [...new Set(accounts.map(account => account.category))]
  const search = params.get('q') || ''
  const availableStatuses = live ? ['All accounts','Active','Possibly dormant','Dormant','Unknown'] : statuses
  const status = availableStatuses.includes(params.get('status')) ? params.get('status') : 'All accounts'
  const category = categories.includes(params.get('category')) ? params.get('category') : 'All categories'
  const sort = params.get('sort') === (live ? 'Recent' : 'Risk') ? (live ? 'Recent' : 'Risk') : 'Name'
  function update(key, value, defaultValue) {
    setParams(current => { const next = new URLSearchParams(current); next.delete('page'); if (value === defaultValue) next.delete(key); else next.set(key, value); return next }, { replace: true })
  }
  const filtered = useMemo(() => accounts.filter(account => (!search.trim() || `${account.name} ${account.domain}`.toLowerCase().includes(search.trim().toLowerCase())) && (status === 'All accounts' || status === account.status) && (category === 'All categories' || category === account.category)).sort((a, b) => sort === 'Risk' ? ({ High: 0, Medium: 1, Low: 2 }[a.risk] - { High: 0, Medium: 1, Low: 2 }[b.risk]) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)), [accounts, search, status, category, sort])
  const pagination = usePagination(live ? accounts : filtered, [6, 12, 24], live ? accountPagination : null)
  return <>
    <ScreenHeader kicker="YOUR FOOTPRINT" title="Know what’s out there." description="An organized inventory, with the evidence behind every account." actions={<ActionButton to="/demo/connections"><Icon name="plus" size={16} />Add a source</ActionButton>} />
    <div className="dx-page-metrics"><div><strong>{live ? summary.total : accounts.length}</strong><span>Total discovered</span></div><div><strong>{live ? summary.highConfidence : accounts.filter(account => account.confidence === 'Confirmed').length}</strong><span>{live ? "High confidence" : "Confirmed evidence"}</span></div><div><strong>{live ? summary.dormant : accounts.filter(account => account.status === 'Dormant').length}</strong><span>Quiet accounts</span></div><div><strong>{live ? summary.possiblyDormant : accounts.filter(account => account.reviewed).length}</strong><span>{live ? "Possibly dormant" : "Reviewed by you"}</span></div></div>
    <section className="dx-panel dx-inventory-panel" id="ot-accounts-list" tabIndex={-1} aria-label="Account inventory">
      <div className="dx-panel-toolbar"><div className="dx-tabs" aria-label="Account status">{availableStatuses.map(value => <button type="button" aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => update('status', value, 'All accounts')} key={value}>{value}</button>)}</div><span className="dx-result-count" role="status">{pagination.total} {pagination.total === 1 ? 'account' : 'accounts'}</span></div>
      <div className="dx-filters"><label className="dx-filter-search"><Icon name="search" size={17} /><input aria-label="Filter accounts by name" placeholder="Search name or domain" value={search} onChange={event => update('q', event.target.value, '')} /></label><label><span className="dx-sr-only">Account category</span><select disabled={live} value={category} onChange={event => update('category', event.target.value, 'All categories')}><option>All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label><span className="dx-sr-only">Sort accounts</span><select value={sort} onChange={event => update('sort', event.target.value, 'Name')}><option value="Name">Sort: Name</option><option value={live ? "Recent" : "Risk"}>{live ? "Sort: Most recent" : "Sort: Risk first"}</option></select></label></div>
      <div className="dx-table-wrap dx-inventory-desktop"><table className="dx-table"><thead><tr><th>Account</th><th>Category</th><th>Evidence</th><th>Last signal</th><th>Status</th><th><span className="dx-sr-only">Details</span></th></tr></thead><tbody>{pagination.items.map(account => <tr key={account.id} data-trace-entity={account.id}><td><Link to={'/demo/accounts/' + account.id}><AccountLabel account={account} /></Link></td><td>{account.category}</td><td><span className="dx-evidence-count"><i className={`dx-dot ${toneFor(account.confidence)}`} />{account.confidence}<small>{account.signals} {live ? "signals" : "sample signals"}</small></span></td><td>{account.lastSeen}</td><td><Tag tone={toneFor(account.status)}>{account.status}</Tag>{account.reviewed ? <span className="dx-reviewed-note"><Icon name="check" size={12} />Reviewed</span> : null}</td><td><Link className="dx-row-link" to={'/demo/accounts/' + account.id} aria-label={`Review ${account.name}`}><Icon name="chevron" size={17} /></Link></td></tr>)}</tbody></table></div>
      <div className="dx-inventory-mobile">{pagination.items.map(account => <Link className="dx-account-mobile-card" aria-label={`Review ${account.name}`} key={account.id} data-trace-entity={account.id} to={'/demo/accounts/' + account.id}><div><AccountLabel account={account} /><Icon name="chevron" size={17} /></div><div><Tag tone={toneFor(account.status)}>{account.status}</Tag><span>{account.category}</span>{account.reviewed ? <span className="dx-reviewed-note"><Icon name="check" size={12} />Reviewed</span> : null}</div><dl><div><dt>Evidence</dt><dd>{account.confidence} · {account.signals} signals</dd></div><div><dt>Last signal</dt><dd>{account.lastSeen}</dd></div></dl></Link>)}</div>
      {!(live ? accounts : filtered).length ? <EmptyResult title="No accounts match" description="Try a different name, category, or status." onReset={() => setParams(previous => { const next=new URLSearchParams(previous);for(const key of ['q','status','category','sort','page','focus'])next.delete(key);return next })} /> : null}
      <Pagination pagination={pagination} label="accounts" target="ot-accounts-list" />
      <div className="dx-table-footer"><Icon name="info" size={15} />{live ? "Sender, subject and date evidence. Marketing mail alone is not proof of account ownership." : "Sample evidence from Gmail and Outlook. Marketing mail alone is not proof of account ownership."}</div>
    </section>
  </>
}
