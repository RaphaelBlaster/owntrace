import { useState } from 'react'
import { Link } from './prism-navigation.jsx'
import { useDemo } from './context.js'
import { DemoMark, Icon, ProviderIcon, ServiceIcon } from './components.jsx'
import SpotlightCard from './react-bits/SpotlightCard.jsx'
import { MetricNumber } from './BitsSurface.jsx'
import StatusMark from './react-bits/StatusMark.jsx'

const positions = [[22, 27], [78, 25], [12, 59], [88, 58], [33, 84], [68, 85], [50, 10]]
const featured = ['notion', 'spotify', 'github', 'linkedin', 'figma', 'adobe', 'dropbox']

export default function FootprintExplorer() {
  const { live, summary, connectionRecords, accounts, providers, lastScan, scanning } = useDemo()
  const [selected, setSelected] = useState('notion')
  const account = accounts.find(account => account.id === selected) || accounts[0]
  const nodes = live ? accounts.slice(0, 7).map(account => account.id) : featured
  return <SpotlightCard className="ot-footprint" spotlightColor="rgba(85, 212, 242, 0.15)">
    <div className="ot-footprint-heading"><span><i /> FOOTPRINT EXPLORER</span><span><Icon name="lock" size={13} /> {live ? "Your workspace" : "Sample workspace"}</span></div>
    <div className="ot-footprint-body">
      <div className="ot-footprint-copy"><h2>All your accounts.<br /> <em>One clear picture.</em></h2><p>Follow a connection. Understand the evidence. Choose what stays.</p><div className="ot-source-chips">{Object.entries(providers).map(([provider, connected]) => <Link to="/demo/connections" key={provider}><ProviderIcon provider={provider} small /><span>{provider}</span><i className={connected ? 'connected' : ''} aria-label={connectionRecords?.[provider]?.status === 'UNAVAILABLE' ? 'Status unavailable' : connected ? (live ? 'Connected' : 'Sample connected') : 'Disconnected'} /></Link>)}</div><div className="ot-scan-status" role="status"><StatusMark status={scanning ? 'running' : Object.values(providers).some(Boolean) ? 'done' : 'pending'} color="#55d4f2" doneColor="#b9f66b" label={scanning ? (live ? 'Inbox scan in progress' : 'Updating sample inboxes…') : `${live ? 'Last scan' : 'Last sample scan'} · ${lastScan}`} strike={false} size={14} fontSize={11} /></div></div>
      <div className="ot-account-map" role="group" aria-label={live ? "Explore your accounts" : "Explore sample accounts"}>
        <svg className="ot-map-lines" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="27" /><circle cx="50" cy="50" r="43" />{positions.map(([x, y]) => <path key={`${x}-${y}`} d={`M50 50 L${x} ${y}`} />)}</svg>
        <div className="ot-map-center"><DemoMark /><strong><MetricNumber value={live ? summary.total : accounts.length} /></strong><span>accounts found</span></div>
        {nodes.map((id, index) => { const account = accounts.find(account => account.id === id); if (!account) return null; return <button type="button" key={id} className={`ot-map-node ${selected === id ? 'selected' : ''}`} style={{ left: `${positions[index][0]}%`, top: `${positions[index][1]}%` }} onClick={() => setSelected(id)} aria-label={`Explore ${account.name} evidence`} aria-pressed={selected === id}><ServiceIcon account={account} /><span>{account.name}</span>{account.risk === 'High' ? <i aria-label="High priority review" /> : null}</button> })}
      </div>
    </div>
    <div className="ot-map-selection">{account ? <><div><ServiceIcon account={account} small /><span role="status"><strong>{account.name}</strong><small>{account.confidence} evidence · {account.signals} signals from {account.source}</small></span></div><Link to={'/demo/accounts/' + account.id}>View evidence <Icon name="arrow" size={15} /></Link></> : <div><span><strong>No account signals yet</strong><small>Connect a mail source and complete discovery.</small></span><Link to="/demo/connections">Choose a source <Icon name="arrow" size={15} /></Link></div>}</div>
  </SpotlightCard>
}
