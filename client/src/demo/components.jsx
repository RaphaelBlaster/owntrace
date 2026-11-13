import { useEffect, useRef } from 'react'
import { Link } from './prism-navigation.jsx'
import { BrandIcon } from './brand-icons.jsx'

const icons = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  accounts: 'M4 5h16v14H4z M8 9h8 M8 13h5',
  wallet: 'M3 6h18v13H3z M15 10h6v5h-6z M4 6V4h14v2',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M9 12l2 2 4-4',
  check: 'M8 4H4v16h16v-8 M9 10l3 3 8-8',
  connect: 'M8 3v5 M16 3v5 M5 8h14v3a7 7 0 0 1-14 0z M12 18v3',
  chart: 'M4 3v17h17 M8 15v-4 M13 15V7 M18 15v-7',
  settings: 'M9.7 4.3l.6-2.3h3.4l.6 2.3 2 .9 2.1-.8 2.4 2.4-.8 2.1.9 2 2.3.6v3.4l-2.3.6-.9 2 .8 2.1-2.4 2.4-2.1-.8-2 .9-.6 2.3h-3.4l-.6-2.3-2-.9-2.1.8-2.4-2.4.8-2.1-.9-2L2 13.7v-3.4l2.3-.6.9-2-.8-2.1 2.4-2.4 2.1.8z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  up: 'M6 18L18 6 M6 6h12v12',
  search: 'M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14 M15 15l6 6',
  bell: 'M5 17h14l-2-4V9a5 5 0 0 0-10 0v4z M10 21h4',
  plus: 'M12 4v16 M4 12h16',
  close: 'M6 6l12 12 M6 18L18 6',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M12 7v5l4 2',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  chevron: 'M9 5l7 7-7 7',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  panel: 'M4 4h16v16H4z M9 4v16',
  spark: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M12 10v7 M12 7v.1',
}

export function Icon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name] || icons.grid} /></svg>
}

export function DemoMark() {
  return <span className="dx-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="#55d4f2" strokeWidth="1.6" /><circle cx="16" cy="16" r="3.2" fill="#b9f66b" /><circle cx="18" cy="4" r="2.7" fill="#55d4f2" /><circle cx="27" cy="21" r="2.7" fill="#55d4f2" /><circle cx="8" cy="26" r="2.7" fill="#b9f66b" /></svg></span>
}

export function ActionButton({ children, to, variant = 'secondary', className = '', ...props }) {
  const classes = `dx-button dx-button-${variant} ${className}`
  return to ? <Link className={classes} to={to} {...props}>{children}</Link> : <button type="button" className={classes} {...props}>{children}</button>
}

export function Tag({ children, tone = 'neutral' }) {
  return <span className={`dx-tag dx-tag-${tone}`}>{children}</span>
}

export function ServiceIcon({ account, small = false }) {
  return <span className={`dx-service-icon${small ? ' is-small' : ''}`} style={{ '--service-color': account.color }} aria-hidden="true"><BrandIcon name={account.name} /></span>
}

export function ProviderIcon({ provider, small = false }) {
  return <span className={`dx-provider-icon${small ? ' is-small' : ''}`} aria-hidden="true"><BrandIcon name={provider} /></span>
}

export function ScreenHeader({ kicker, title, description, actions }) {
  return <div className="dx-screen-header"><div>{kicker ? <p className="dx-kicker">{kicker}</p> : null}<h1>{title}</h1>{description ? <p className="dx-description">{description}</p> : null}</div>{actions ? <div className="dx-header-actions">{actions}</div> : null}</div>
}

export function SectionTitle({ title, description, to, link = 'View all' }) {
  return <div className="dx-section-title"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{to ? <Link to={to}>{link}<Icon name="arrow" size={15} /></Link> : null}</div>
}

export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog className={`dx-modal${wide ? ' is-wide' : ''}`} ref={ref} onCancel={onClose} aria-labelledby="dx-modal-title" onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
    <div className="dx-modal-heading"><h2 id="dx-modal-title">{title}</h2><button type="button" aria-label="Close dialog" className="dx-icon-button" onClick={onClose}><Icon name="close" /></button></div>{children}
  </dialog>
}

export function EmptyResult({ title, description, onReset }) {
  return <div className="dx-empty"><Icon name="search" size={28} /><h3>{title}</h3><p>{description}</p>{onReset ? <ActionButton onClick={onReset}>Clear filters</ActionButton> : null}</div>
}
