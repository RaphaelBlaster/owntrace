import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Link, usePrismPathname } from './prism-navigation.jsx'
import { useDemo } from './context.js'
import { Icon } from './components.jsx'
import { Overview, Accounts, AccountDetails, Subscriptions, Security, Actions, Connections, Report, Settings, DialogContent } from './screens.jsx'
import CommandPalette from './CommandPalette.jsx'
import WorkspaceNavigation from './WorkspaceNavigation.jsx'
export default function WorkspaceShell({ children }) {
  const { live, loading, connectionStatusUnavailable, actionSummary, modal, setModal, profile, scanning, setScanning, lastScan, providers, actions } = useDemo()
  const connected = Object.values(providers).filter(Boolean).length
  const pending = live ? (actionSummary?.open || 0) + (actionSummary?.inProgress || 0) : actions.filter(action => action.state === 'To do').length
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => { try { return sessionStorage.getItem('owntrace-navigation-expanded') === 'true' } catch { return false } })
  useEffect(() => { try { sessionStorage.setItem('owntrace-navigation-expanded', String(expanded)) } catch { /* Navigation still works without browser storage. */ } }, [expanded])
  const labels = { accounts: 'Accounts', subscriptions: 'Subscriptions', orders: 'Orders', security: 'Security', actions: 'Action center', connections: 'Connections', report: 'Privacy report', settings: 'Settings' }
  const section = usePrismPathname(location.pathname).split('/')[2]
  useEffect(() => { setSearchOpen(false); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); document.getElementById('dx-main')?.focus({ preventScroll: true }) }, [location.pathname])
  useEffect(() => {
    function shortcut(event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !modal && !menuOpen) { event.preventDefault(); setSearchOpen(open => !open) } }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [modal, menuOpen])
  return <div className={`dx-app ot-dock-layout${expanded ? ' is-expanded' : ''} dx-route-${section || 'overview'}`}>
    <a className="dx-skip" href="#dx-main">Skip to workspace content</a>
    <WorkspaceNavigation expanded={expanded} setExpanded={setExpanded} mobileOpen={menuOpen} closeMobile={() => setMenuOpen(false)} openMobile={() => setMenuOpen(true)} openSearch={() => setSearchOpen(true)} />
    <div className="dx-frame">
      <header className="dx-topbar"><div className="ot-topbar-left"><div className="dx-breadcrumb"><button type="button" className="dx-icon-button dx-mobile-menu" aria-label="Open workspace navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span>Workspace</span><Icon name="chevron" size={13} /><strong>{labels[section] || 'Overview'}</strong></div></div><div className="dx-topbar-right"><button type="button" className="dx-global-search ot-command-trigger" aria-label="Search accounts and pages" aria-keyshortcuts="Control+k Meta+k" onClick={() => setSearchOpen(true)}><Icon name="search" size={16} /><span>Find an account or page…</span><kbd>⌘ / Ctrl K</kbd></button>{live ? <Link to="/trace" className="ot-trace-entry ot-mobile-trace" aria-label="Open TRACE assistant"><strong>T</strong><span>TRACE</span></Link> : null}<button type="button" className="dx-icon-button dx-notification" aria-label="View activity notifications" onClick={() => setModal({ type: 'notifications' })}><Icon name="bell" /><i /></button><Link className="dx-avatar" to="/demo/settings" aria-label="Your profile">{profile.name.charAt(0).toUpperCase()}</Link></div></header>
      <div className="ot-workspace-status" aria-label={live ? "Workspace activity" : "Sample workspace activity"}><div className="ot-status-live" role="status"><i className={scanning ? 'is-scanning' : ''} /><strong>{loading ? 'Loading workspace status…' : scanning ? (live ? 'Inbox scan in progress' : 'Updating sample inboxes…') : connected ? (live ? 'Mail sources connected' : 'Sample workspace up to date') : (live ? connectionStatusUnavailable ? 'Connection status unavailable' : 'No mail sources connected' : 'No sample sources connected')}</strong><span>{scanning ? 'Preparing account clues' : connected ? `Last scan: ${lastScan}` : 'Connect a source to explore discovery'}</span></div><div className="ot-status-actions"><Link to="/demo/connections"><Icon name="connect" size={14} />{connectionStatusUnavailable ? "Source status unavailable" : `${connected} sources`}</Link><Link to="/demo/actions"><span className="ot-status-count">{pending}</span>reviews to do</Link><button type="button" disabled={scanning || !connected} onClick={() => setScanning(true)}><Icon name="clock" size={14} />{scanning ? 'Updating…' : live ? 'Scan controls' : 'Refresh sample'}</button>{!live ? <span className="ot-sample-label" title="All connections and actions are simulated">DEMO</span> : null}</div></div>
      <main className="dx-main" id="dx-main" tabIndex={-1}>{children || <Routes><Route index element={<Overview />} /><Route path="accounts" element={<Accounts />} /><Route path="accounts/:id" element={<AccountDetails />} /><Route path="subscriptions" element={<Subscriptions />} /><Route path="security" element={<Security />} /><Route path="actions" element={<Actions />} /><Route path="connections" element={<Connections />} /><Route path="report" element={<Report />} /><Route path="settings" element={<Settings />} /><Route path="*" element={<Navigate to="/demo" replace />} /></Routes>}<footer className="dx-footer"><span><Icon name="lock" size={13} />Your workspace. Your decisions.</span><span>{live ? "OwnTrace · Private workspace" : "OwnTrace concept · Sample timeline: October 2026"}</span></footer></main>
    </div>
    {!live && modal ? <DialogContent /> : null}
    {searchOpen ? <CommandPalette onClose={() => setSearchOpen(false)} /> : null}
  </div>
}

