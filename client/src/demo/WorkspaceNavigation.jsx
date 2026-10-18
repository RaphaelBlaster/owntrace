import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocation } from 'react-router-dom'
import { Link, useNavigate } from './prism-navigation.jsx'
import { prismPath, usePrismPathname } from './prism-navigation.jsx'
import { useDemo } from './context.js'
import { navigation } from './data.js'
import { DemoMark, Icon, Modal, Tag } from './components.jsx'
import Dock from './react-bits/Dock.jsx'
import FlowingMenu from './react-bits/FlowingMenu.jsx'
import TechText from './react-bits/TechText.jsx'
import StatusMark from './react-bits/StatusMark.jsx'
const workspaceNavigation = live => live ? navigation.map(group => group.title === 'WORKSPACE' ? { ...group, items: [...group.items, ['Orders', 'orders', 'accounts']] } : group) : navigation

export function PrismWordmark() {
  const reduced = useReducedMotion()
  return <Link className="ot-wordmark" to="/demo" aria-label="OwnTrace overview"><DemoMark /><span className="ot-wordmark-text">{reduced ? <strong>OwnTrace</strong> : <TechText text="OwnTrace" fontFamily="Manrope Variable" fontSize={26} fontWeight={800} color="#1b3444" accentColor="#39a8c5" reveal="letter" labels={false} draggable={false} sweep={false} selection={false} specks={0} />}</span></Link>
}

function NavigationPanel({ onNavigate, close, mobile = false }) {
  const { live, summary, actionSummary, accounts, actions, profile, providers, scanning } = useDemo()
  const pathname = usePrismPathname(useLocation().pathname)
  const pending = live ? (actionSummary?.open || 0) + (actionSummary?.inProgress || 0) : actions.filter(action => action.state === 'To do').length
  const paid = accounts.filter(account => account.cost > 0).length
  const previews = { '': 'Your digital life, in focus', accounts: `${live ? summary?.total ?? '…' : accounts.length} accounts discovered`, subscriptions: live ? 'Recurring-service evidence' : `${paid} paid plans`, security: 'Evidence before action', actions: `${pending} open reviews`, connections: `${Object.values(providers).filter(Boolean).length} ${live ? 'mail' : 'sample'} sources`, report: 'Your privacy, explained' }
  return <div className={`ot-navigation-content${mobile ? ' is-mobile' : ''}`}>
    {!mobile ? <div className="ot-panel-brand"><PrismWordmark /><button type="button" className="dx-icon-button" aria-label="Collapse navigation" onClick={close}><Icon name="panel" size={18} /></button></div> : null}
    <div className="ot-personal-space"><span className="dx-avatar">{profile.name.charAt(0).toUpperCase()}</span><div><strong>{profile.name.split(' ')[0]}’s workspace</strong><small>Personal workspace</small></div>{!live ? <Tag>DEMO</Tag> : null}</div>
    {live ? <Link className="ot-trace-entry" to="/trace" onClick={onNavigate} aria-label="Open TRACE assistant"><strong>T</strong><span>TRACE assistant</span></Link> : null}
    {workspaceNavigation(live).map(group => <section className="ot-navigation-group" key={group.title}><h2>{group.title === 'WORKSPACE' ? 'Explore' : 'Take control'}</h2><div className="ot-flow-menu"><FlowingMenu label={group.title === 'WORKSPACE' ? 'Explore workspace' : 'Take control'} items={group.items.map(([text, path, icon]) => ({ text, link: live ? prismPath(`/demo${path ? '/' + path : ''}`) : `/demo${path ? '/' + path : ''}`, icon: <Icon name={icon} size={18} />, badge: path === 'actions' ? pending : null, preview: previews[path], active: path ? pathname.startsWith(`/demo/${path}`) : pathname === '/demo' }))} onNavigate={onNavigate} speed={13} textColor="#496375" bgColor="transparent" marqueeBgColor="#173242" marqueeTextColor="#b6effa" borderColor="transparent" /></div></section>)}
    <div className="ot-navigation-bottom"><div className="ot-source-status"><StatusMark status={scanning ? 'running' : Object.values(providers).some(Boolean) ? 'done' : 'pending'} label={live ? (scanning ? 'Scan in progress' : 'Live workspace') : (scanning ? 'Updating sample sources' : 'Sample workspace ready')} color="#368aa4" doneColor="#368aa4" size={17} fontSize={11} strike={false} /><p>Your data. Your decisions.</p></div><Link to="/demo/settings" onClick={onNavigate}><Icon name="settings" />Settings & preferences<Icon name="chevron" size={13} /></Link><Link to="/demo/start" onClick={onNavigate}><Icon name="spark" />Review privacy setup<Icon name="arrow" size={13} /></Link></div>
  </div>
}

export default function WorkspaceNavigation({ expanded, setExpanded, mobileOpen, closeMobile, openMobile, openSearch }) {
  const { live, actionSummary, actions, profile, signOut, signingOut } = useDemo()
  const pathname = usePrismPathname(useLocation().pathname)
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const pending = live ? (actionSummary?.open || 0) + (actionSummary?.inProgress || 0) : actions.filter(action => action.state === 'To do').length
  const destinations = workspaceNavigation(live).flatMap(group => group.items)
  const items = destinations.map(([label, path, icon]) => ({ label, active: path ? pathname.startsWith(`/demo/${path}`) : pathname === '/demo', className: path === 'actions' ? 'ot-review-dock-item' : '', icon: <span className="ot-dock-glyph"><Icon name={icon} size={21} />{path === 'actions' && pending ? <b aria-hidden="true">{pending}</b> : null}</span>, onClick: () => navigate(`/demo${path ? '/' + path : ''}`) }))
  const mobileItems = [items[0], items[1], items[4], items[5], { label: 'More', icon: <Icon name="menu" size={20} />, onClick: openMobile }]
  return <>
    <aside className="ot-nav-rail" aria-label="Workspace shortcuts">
      <Link to="/demo" className="ot-rail-brand" aria-label="OwnTrace overview"><DemoMark /></Link>
      {live ? <Link to="/trace" className="ot-trace-entry ot-rail-trace" aria-label="Open TRACE assistant"><strong>T</strong><span>TRACE</span></Link> : null}
      <button type="button" className={`ot-rail-toggle${expanded ? ' is-open' : ''}`} aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-controls="ot-navigation-panel" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Icon name="panel" size={20} /><span className="ot-rail-tooltip">{expanded ? 'Collapse' : 'Expand navigation'}</span></button>
      <Dock items={items} orientation="vertical" className="ot-desktop-dock" label="Workspace destinations" baseItemSize={43} magnification={51} distance={85} />
      <div className="ot-rail-bottom">{live ? <button type="button" aria-label="Sign out" disabled={signingOut} onClick={signOut}><Icon name="arrow" size={20} /><span className="ot-rail-tooltip">Sign out</span></button> : null}<button type="button" aria-label="Search accounts and pages" onClick={openSearch}><Icon name="search" size={20} /><span className="ot-rail-tooltip">Search · Ctrl K</span></button><button type="button" aria-label="Settings and preferences" aria-current={pathname.startsWith('/demo/settings') ? 'page' : undefined} onClick={() => navigate('/demo/settings')}><Icon name="settings" size={20} /><span className="ot-rail-tooltip">Settings</span></button><Link to="/demo/settings" className="dx-avatar" aria-label="Your profile">{profile.name.charAt(0).toUpperCase()}</Link></div>
    </aside>
    <AnimatePresence initial={false}>{expanded ? <motion.aside id="ot-navigation-panel" className="ot-navigation-panel" aria-label="Expanded workspace navigation" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: reduced ? 0 : 0.18 }}><NavigationPanel close={() => setExpanded(false)} onNavigate={() => { if (window.innerWidth <= 1100) setExpanded(false) }} /></motion.aside> : null}</AnimatePresence>
    <div className="ot-mobile-dock"><Dock items={mobileItems} label="Workspace destinations" baseItemSize={44} magnification={44} panelHeight={67} dockHeight={67} /></div>
    {mobileOpen ? <Modal title="Your workspace" onClose={closeMobile}><NavigationPanel mobile onNavigate={closeMobile} /></Modal> : null}
  </>
}
