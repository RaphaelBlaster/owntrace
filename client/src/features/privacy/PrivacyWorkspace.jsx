import { useContext, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import useAuth from '../auth/useAuth.js'
import { canAccessAuthenticatedRoute, getDefaultAuthenticatedRoute } from '../auth/auth-navigation.js'
import './privacy-workspace.css'
import { BrandMark } from '../../ui/components.jsx'
import { EmbeddedWorkspaceContext, LegacyShellContext } from '../workspace/workspace-navigation.jsx'

function NavigationIcon({ to }) {
  const paths = {
    '/dashboard': 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    '/accounts': 'M4 5h16v14H4z M8 9h8 M8 13h5',
    '/privacy-inbox': 'M4 4h16v16H4z M8 9l2 2 5-5 M8 16h8',
    '/subscriptions': 'M3 6h18v12H3z M3 10h18 M7 14h3',
    '/breaches': 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M12 8v5 M12 16v1',
    '/connect': 'M8 3v5 M16 3v5 M5 8h14v3a7 7 0 0 1-14 0z M12 18v3',
    '/settings': 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8',
  }
  return <span className="ui-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[to] || 'M5 5h14v14H5z M9 9h6 M9 13h6'} /></svg></span>
}

const navigationGroups = [
  {
    label: 'Overview',
    links: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Accounts', to: '/accounts' },
      { label: 'Actions', to: '/privacy-inbox' },
    ],
  },
  {
    label: 'Privacy',
    links: [
      { label: 'Subscriptions', to: '/subscriptions' },
      { label: 'Breaches', to: '/breaches' },
    ],
  },
  {
    label: 'Connections',
    links: [
      { label: 'Mail connections', to: '/connect' },
      { label: 'Settings', to: '/settings' },
    ],
  },
]

const moreTools = [
  { label: 'Account cleanup', to: '/account-actions' },
  { label: 'Identity map', to: '/identity' },
  { label: 'Exposures', to: '/exposures' },
  { label: 'Privacy health', to: '/privacy-health' },
  { label: 'Privacy requests', to: '/privacy-requests' },
  { label: 'Notifications', to: '/notifications' },
]

function useMobileLayout() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 48rem)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 48rem)')
    const update = () => setIsMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isMobile
}

function FullPrivacyWorkspace({ children, title }) {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useMobileLayout()
  const [isOpen, setIsOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const menuButtonRef = useRef(null)
  const sidebarRef = useRef(null)

  function closeNavigation({ restoreFocus = true } = {}) {
    setIsOpen(false)
    if (restoreFocus) window.setTimeout(() => menuButtonRef.current?.focus(), 0)
  }

  useEffect(() => {
    setIsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isMobile || !isOpen) return undefined
    const sidebar = sidebarRef.current
    const getFocusable = () => [...(sidebar?.querySelectorAll('a[href], button:not([disabled]), summary') || [])].filter((element) => element.getClientRects().length)
    getFocusable()[0]?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeNavigation()
        return
      }
      const focusable = getFocusable()
      if (event.key !== 'Tab' || !focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMobile, isOpen])

  async function handleLogout() {
    setIsSigningOut(true)
    setLogoutError('')
    try {
      await logout()
      navigate('/', { replace: true })
    } catch {
      setLogoutError('OwnTrace could not sign you out. Try again.')
      setIsSigningOut(false)
    }
  }

  const initial = user?.name?.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className={`privacy-workspace${isOpen ? ' has-open-navigation' : ''}`}>
      {isMobile && isOpen ? (
        <button
          aria-label="Close navigation"
          className="privacy-navigation-backdrop"
          onClick={() => closeNavigation()}
          type="button"
          tabIndex={-1}
        />
      ) : null}
      <aside
        aria-label="OwnTrace product navigation"
        aria-hidden={isMobile && !isOpen ? 'true' : undefined}
        aria-modal={isMobile && isOpen ? 'true' : undefined}
        className={`privacy-sidebar${isOpen ? ' is-open' : ''}`}
        id="owntrace-privacy-sidebar"
        inert={isMobile && !isOpen ? true : undefined}
        ref={sidebarRef}
        role={isMobile ? 'dialog' : undefined}
      >
        <div className="privacy-sidebar-brand-row">
          <NavLink className="privacy-brand" to={getDefaultAuthenticatedRoute(user)}><BrandMark />OwnTrace</NavLink>
          <button aria-label="Close navigation" className="privacy-sidebar-close" onClick={() => closeNavigation()} type="button">×</button>
        </div>
        <nav aria-label="OwnTrace workspace">
          {canAccessAuthenticatedRoute(user, '/trace') ? <NavLink aria-label="Open TRACE assistant" className="privacy-trace-entry" to="/trace"><span aria-hidden="true">T</span><div><strong>TRACE</strong><small>Your workspace, explained</small></div><b aria-hidden="true">↗</b></NavLink> : null}
          {navigationGroups.map((group) => ({ ...group, links: group.links.filter((link) => canAccessAuthenticatedRoute(user, link.to)) })).filter((group) => group.links.length).map((group) => (
            <div className="privacy-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.links.map((link) => (
                <NavLink key={link.to} to={link.to}><NavigationIcon to={link.to} />{link.label}</NavLink>
              ))}
            </div>
          ))}
          {user?.onboardingStatus === 'COMPLETED' ? (
            <details className="privacy-nav-group privacy-more-tools" open={moreTools.some((link) => link.to === location.pathname) || undefined}>
              <summary>More tools</summary>
              {moreTools.map((link) => <NavLink key={link.to} to={link.to}><NavigationIcon to={link.to} />{link.label}</NavLink>)}
            </details>
          ) : <NavLink to="/onboarding">Continue setup</NavLink>}
        </nav>
        <div className="privacy-sidebar-account">
          <span aria-hidden="true">{initial}</span>
          <div><strong>{user?.name || 'OwnTrace user'}</strong><small>{user?.email}</small></div>
        </div>
        <button className="privacy-sign-out" disabled={isSigningOut} onClick={handleLogout} type="button">
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
        {logoutError ? <p className="privacy-sidebar-error" role="alert">{logoutError}</p> : null}
      </aside>

      <div className="privacy-workspace-frame" inert={isMobile && isOpen ? true : undefined}>
        <header className="privacy-mobile-header">
          <button
            aria-controls="owntrace-privacy-sidebar"
            aria-expanded={isOpen}
            aria-label="Open navigation"
            onClick={() => setIsOpen(true)}
            ref={menuButtonRef}
            type="button"
          >
            Menu
          </button>
          <strong>{title}</strong>
          <span aria-hidden="true">{initial}</span>
        </header>
        {children}
      </div>
    </div>
  )
}

function PrivacyWorkspace(props) {
  const embedded = useContext(EmbeddedWorkspaceContext)
  const sharedShell = useContext(LegacyShellContext)
  return embedded || sharedShell ? props.children : <FullPrivacyWorkspace {...props} />
}

export default PrivacyWorkspace
