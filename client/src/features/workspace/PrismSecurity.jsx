import { useState } from 'react'
import { useDemo } from '../../demo/context.js'
import { Link } from '../../demo/prism-navigation.jsx'
import { ActionButton, Icon, ScreenHeader, SectionTitle, Tag } from '../../demo/components.jsx'
import { usePagination } from '../../demo/use-pagination.js'
import Pagination from '../../demo/Pagination.jsx'
import api from '../../services/api.js'
import { date, label } from './prism-data.js'

function PrismSecurity() {
  const { security } = useDemo()
  const [consent,setConsent]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''), [checked,setChecked]=useState(null)
  const result=checked || security
  const signals=usePagination(result.securitySignals, [12], {...result.pagination,pageKey:'signalPage'})
  const breaches=usePagination(result.breaches, [12], {...result.breachPagination,pageKey:'breachPage'})
  async function check() {
    setBusy(true);setError('')
    try { await api.post('/breaches/check',{consent:true});const {data}=await api.get('/breaches',{params:{breachLimit:12,signalLimit:12}});setChecked(data);setConsent(false) }
    catch(failure){setError(failure.response?.data?.message || 'The breach check could not complete.')}
    finally{setBusy(false)}
  }
  return <><ScreenHeader kicker="SECURITY & EXPOSURE" title="Know what needs protecting." description="Keep alerts, evidence, and next steps together—without turning signals into certainty." />
    <div className="dx-security-summary"><div className="dx-security-shield"><Icon name="shield" size={38} /></div><div><Tag tone={result.pagination.total?'amber':'neutral'}>{result.pagination.total} account signals</Tag><h2>{result.pagination.total?'Review the security signals behind your accounts.':'No security signals returned.'}</h2><p>Inbox signals are separate from verified breach records.</p></div><ActionButton to="/demo/actions" variant="primary">Review next steps <Icon name="arrow" size={16} /></ActionButton></div>
    <div className="dx-security-metrics"><section className="dx-panel"><Icon name="shield" size={22} /><strong>{result.pagination.total}</strong><span>Accounts with security signals</span></section><section className="dx-panel"><Icon name="lock" size={22} /><strong>Unknown</strong><span>Two-step verification on external services</span></section><section className="dx-panel"><Icon name="globe" size={22} /><strong>{result.provider?.lastCheckedAt ? result.breachPagination.total : 'Not checked'}</strong><span>Verified breach records</span></section></div>
    <section className="dx-panel"><SectionTitle title="Your security evidence" description="Each item explains what is known." />{signals.items.map(account=><div className="dx-security-row" key={account.accountId}><span className="dx-priority-icon red"><Icon name="shield" size={22} /></span><div><strong>{account.serviceName}</strong><p>{account.basis.map(label).join(', ')} · {date(account.lastSeenAt)}</p></div><Tag>{label(account.confidenceLevel)}</Tag><ActionButton to={`/demo/accounts/${account.accountId}`}>View evidence</ActionButton></div>)}<Pagination pagination={signals} label="signals" target="prism-security-signals" /></section>
    <section className="dx-panel"><SectionTitle title="Verified breach records" description={result.provider?.lastCheckedAt ? `Last checked ${date(result.provider.lastCheckedAt)}` : 'Your email has not been checked by the configured provider.'} />{breaches.items.map((breach,index)=><div className="dx-security-row" key={breach.name || index}><span className="dx-priority-icon red"><Icon name="globe" /></span><div><strong>{breach.title || breach.name}</strong><p>Verified provider record · checked {date(result.provider.lastCheckedAt)}</p></div><Tag tone="red">Verified record</Tag></div>)}<Pagination pagination={breaches} label="breaches" target="prism-security-breaches" /><p className="dx-fine-print">Checking sends your account email to the configured breach provider. A record does not prove a current compromise.</p><label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} /> I agree to this email check.</label><ActionButton disabled={!consent || busy} onClick={check}>{busy?'Checking…':'Check my email'}</ActionButton>{error?<p role="alert">{error}</p>:null}<p>{result.provider?.message}</p></section>
    <div className="dx-info-box"><Icon name="info" /><p>Review alerts and account protection through each service’s settings. <Link to="/demo/actions">OwnTrace recommendations</Link> help you track your decisions.</p></div></>
}
export default PrismSecurity
