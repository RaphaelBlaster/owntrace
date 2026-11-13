import { Link } from './prism-navigation.jsx'
import { useDemo } from './context.js'
import { money } from './data.js'
import { ActionButton, Icon, ScreenHeader, ServiceIcon, Tag } from './components.jsx'
import SpotlightCard from './react-bits/SpotlightCard.jsx'
import { BitsSurface, MetricNumber } from './BitsSurface.jsx'
import FootprintExplorer from './FootprintExplorer.jsx'
import StatusMark from './react-bits/StatusMark.jsx'

function Stat({ to, icon, label, value, currency, description, foot, tone = '' }) {
  return <SpotlightCard className="ot-metric-card" spotlightColor="rgba(85, 212, 242, 0.16)"><Link to={to}><span className="ot-metric-label"><Icon name={icon} size={17} />{label}<Icon name="up" size={14} /></span><strong><MetricNumber value={value} currency={currency} /></strong><p>{description}</p><span className={`ot-metric-foot ${tone}`}><i />{foot}</span></Link></SpotlightCard>
}

export default function OverviewV2() {
  const { live, summary, actionSummary, subscriptionTotal, subscriptions, health, accounts, actions, profile, providers, scanning, setScanning, setModal } = useDemo()
  const pending = actions.filter(action => action.state === 'To do')
  const done = live ? actionSummary.completed : actions.length - pending.length
  const reviewTotal = live ? actionSummary.open + actionSummary.inProgress + actionSummary.completed + actionSummary.dismissed : actions.length
  const progress = reviewTotal ? Math.round(done / reviewTotal * 100) : 0
  const pendingTotal = live ? actionSummary.open + actionSummary.inProgress : pending.length
  const highPriority = live ? actionSummary.highPriority : pending.filter(action => action.priority === 'High').length
  const preferred = profile.goal === 'Reduce recurring costs' ? 'Subscriptions' : profile.goal === 'Improve account security' ? 'Security' : null
  const next = pending.find(action => action.category === preferred) || pending[0]
  const nextAccount = accounts.find(account => account.id === next?.accountId) || (next?.account ? {id:next.accountId,name:next.account.serviceName,domain:next.account.primaryDomain,color:'#368aa4'} : null)
  const paid = accounts.filter(account => account.cost > 0)
  const spend = paid.reduce((total, account) => total + account.cost, 0)
  const quiet = accounts.filter(account => account.status === 'Dormant')
  const liveRenewals = (subscriptions || []).filter(plan => plan.raw.nextRenewalAt).sort((a,b)=>new Date(a.raw.nextRenewalAt)-new Date(b.raw.nextRenewalAt)).slice(0,3)
  const renewals = [...paid].filter(account => /^Oct \d+$/.test(account.renewal || '')).sort((a, b) => Number(a.renewal.split(' ')[1]) - Number(b.renewal.split(' ')[1])).slice(0, 3)
  const connections = Object.values(providers).filter(Boolean).length
  const accountRows = [...accounts].sort((a, b) => Number(b.risk === 'High') - Number(a.risk === 'High') || Number(b.status === 'Needs review') - Number(a.status === 'Needs review')).slice(0, 5)
  return <div className="ot-overview">
    <ScreenHeader kicker="YOUR DIGITAL LIFE, IN FOCUS" title={`A little more clarity, ${profile.name.split(' ')[0]}.`} description="A place for every account. A reason behind every recommendation." actions={<ActionButton onClick={() => setScanning(true)} disabled={scanning || !connections}>{scanning ? <StatusMark status="running" color="#368aa4" size={17} /> : <Icon name="connect" size={17} />}{scanning ? (live ? 'Scan in progress' : 'Updating sample…') : (live ? 'Open scan controls' : 'Refresh inboxes')}</ActionButton>} />
    <BitsSurface className="ot-top-grid">
      <FootprintExplorer />
      <SpotlightCard className="ot-next-step" spotlightColor="rgba(85, 212, 242, 0.13)">
        <div className="ot-next-heading"><span><Icon name="spark" size={15} /> YOUR NEXT BEST STEP</span><Tag>{next?.time || (live ? 'Current signals' : 'All done')}</Tag></div>
        <div className="ot-next-service">{nextAccount ? <ServiceIcon account={nextAccount} /> : <span className="dx-square-icon"><Icon name="check" size={23} /></span>}<span><strong>{nextAccount?.name || 'Your workspace'}</strong><small>{next?.category || (live ? 'Account evidence' : 'Review complete')}</small></span>{next ? <Tag tone={next.priority === 'High' ? 'red' : 'amber'}>{next.priority} priority</Tag> : null}</div>
        <h2>{next?.title || (live ? 'No open recommendations returned.' : 'You’ve closed every loose end.')}</h2><p>{next?.description || (live ? 'No open recommendations were returned. Review your account evidence whenever you need to.' : 'Every sample recommendation now has a decision. Revisit your accounts whenever you need to.')}</p>
        <div className="ot-review-progress"><div><span>{done} of {reviewTotal} reviews complete</span><b>{progress}%</b></div><div className="ot-review-track"><span style={{ width: `${progress}%` }} /></div></div>
        {next ? <ActionButton variant="primary" onClick={() => setModal({ type: 'action', id: next.id })}>Walk me through it <Icon name="arrow" size={17} /></ActionButton> : <ActionButton to="/demo/actions" variant="primary">See my decisions <Icon name="arrow" size={17} /></ActionButton>}
        <small className="ot-next-note"><Icon name="lock" size={12} />Your decision. No automatic changes.</small>
      </SpotlightCard>
    </BitsSurface>
    <BitsSurface className="ot-metrics" delay={0.08}>
      <Stat to="/demo/accounts" icon="accounts" label="Discovered accounts" value={live ? summary.total : accounts.length} description={live ? "From your authenticated workspace" : `Across ${new Set(accounts.map(account => account.category)).size} categories`} foot={`${connections} connected ${live ? "mail" : "sample"} sources`} />
      <Stat to="/demo/subscriptions" icon="wallet" label={live ? "Subscription signals" : "Monthly commitments"} value={live ? subscriptionTotal : spend} currency={!live} description={live ? "Recurring-service evidence" : `${paid.length} paid subscriptions · USD`} foot={live ? "Open subscriptions for billing details" : `${paid.filter(account => account.status !== 'Active').length} plans worth reviewing`} tone="amber" />
      <Stat to="/demo/actions" icon="check" label="Open reviews" value={pendingTotal} description="A short queue. A clearer footprint." foot={!pendingTotal ? (live ? 'No open reviews' : 'All sample reviews complete') : highPriority ? `${highPriority} high-priority ${highPriority === 1 ? 'item' : 'items'}` : 'No high-priority items'} tone={highPriority ? 'red' : ''} />
      <Stat to="/demo/accounts?status=Dormant" icon="clock" label="Quiet accounts" value={live ? summary.dormant : quiet.length} description={live ? "Based on observed account activity" : "No recent sample activity signals"} foot="Keep, review, or tidy up" />
    </BitsSurface>
    <div className="ot-work-grid">
      <BitsSurface className="ot-inventory dx-panel" delay={0.1}>
        <div className="ot-panel-heading"><div><span className="ot-eyebrow">THE BIGGER PICTURE</span><h2>Your account landscape</h2><p>Clear evidence. Visible confidence. No guesswork.</p></div><Link to="/demo/accounts">All accounts <Icon name="arrow" size={15} /></Link></div>
        <div className="ot-inventory-head" aria-hidden="true"><span>ACCOUNT</span><span>EVIDENCE</span><span>STATUS</span></div>
        <div className="ot-inventory-rows">{accountRows.map(account => <Link to={'/demo/accounts/' + account.id} key={account.id}><div className="dx-account-name"><ServiceIcon account={account} /><div><strong>{account.name}</strong><span>{account.category} · {account.source}</span></div></div><div className="ot-row-evidence"><strong>{account.confidence}</strong><span>{account.signals} {live ? "signals" : "sample signals"}</span></div><Tag tone={account.status === 'Needs review' ? 'amber' : account.status === 'Active' ? 'green' : 'neutral'}>{account.status}</Tag><Icon name="chevron" size={16} /></Link>)}</div>
        <div className="ot-inventory-foot"><Icon name="info" size={14} />Discovered accounts aren’t connected accounts. Follow the evidence.</div>
      </BitsSurface>
      <div className="ot-right-stack">
        <BitsSurface className="ot-renewals dx-panel" delay={0.14}><div className="ot-panel-heading"><div><span className="ot-eyebrow">ON THE HORIZON</span><h2>{live ? "Renewals in recent signals" : "Upcoming renewals"}</h2></div><Tag>{live ? "Estimates" : "OCT ’26"}</Tag></div><div className="ot-renewal-items">{(live ? liveRenewals : renewals).map(account => <Link to={live ? '/demo/subscriptions' : '/demo/accounts/' + account.id} key={account.id}><span className="ot-date"><small>{live ? 'DATE' : 'OCT'}</small><strong>{live ? new Date(account.raw.nextRenewalAt).getDate() : account.renewal.split(' ')[1]}</strong></span><ServiceIcon account={account} small /><span><strong>{account.name}</strong><small>{account.plan}</small></span><b>{money(account.cost, account.currency)}</b></Link>)}</div><Link className="ot-text-link" to="/demo/subscriptions">Manage your commitments <Icon name="arrow" size={15} /></Link></BitsSurface>
        <SpotlightCard className="ot-clarity-card" spotlightColor="rgba(85,212,242,.16)"><span className="ot-eyebrow"><Icon name="shield" size={14} /> YOUR PRIVACY PULSE</span><div><strong>{live && health?.score == null ? '—' : <MetricNumber value={live ? health.score : Math.min(100, 76 + done * 4)} />}<small>/100</small></strong><Tag>{live ? health?.score == null ? "Not enough data" : "Current estimate" : "Illustrative score"}</Tag></div><p>{live ? health?.summary : done ? 'Your sample reviews are making a difference.' : 'A good starting point. Every review brings a little more clarity.'}</p><Link to="/demo/report">See what goes into it <Icon name="arrow" size={15} /></Link></SpotlightCard>
      </div>
    </div>
    <div className="ot-bottom-note"><span><Icon name="lock" size={16} /> Built around your choices, not your inbox.</span><Link to="/demo/connections">Review your connections <Icon name="arrow" size={14} /></Link></div>
  </div>
}
