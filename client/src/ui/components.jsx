import { Link } from 'react-router-dom'

export function BrandMark() {
  return <span className="ui-brand-mark" aria-hidden="true"><i /><i /><i /></span>
}

export function Button({ children, className = '', to, variant = 'secondary', type = 'button', ...props }) {
  const classes = `ui-button ui-button--${variant} ${className}`.trim()
  return to ? <Link className={classes} to={to} {...props}>{children}</Link> : <button className={classes} type={type} {...props}>{children}</button>
}

export function Card({ children, className = '', as: Tag = 'section', ...props }) {
  return <Tag className={`ui-card ${className}`.trim()} {...props}>{children}</Tag>
}

export function PageHeader({ eyebrow, title, description, actions, id, titleRef, titleTabIndex }) {
  return <header className="ui-page-header">
    <div><p className="ui-eyebrow">{eyebrow}</p><h1 id={id} ref={titleRef} tabIndex={titleTabIndex}>{title}</h1>{description ? <p className="ui-description">{description}</p> : null}</div>
    {actions ? <div className="ui-header-actions">{actions}</div> : null}
  </header>
}

export function Badge({ children, tone = 'neutral', className = '' }) {
  return <span className={`ui-badge ui-badge--${tone} ${className}`.trim()}>{children}</span>
}

export function Feedback({ children, title, tone = 'empty' }) {
  return <div className={`ui-feedback ui-feedback--${tone}`} role={tone === 'error' ? 'alert' : tone === 'loading' ? 'status' : undefined}>
    <span className="ui-feedback-mark" aria-hidden="true">{tone === 'loading' ? <span className="ui-spinner" /> : tone === 'error' ? '!' : '↗'}</span>
    <div>{title ? <strong>{title}</strong> : null}<p>{children}</p></div>
  </div>
}

export function Pagination({ label, onPageChange, pagination }) {
  const pages = pagination?.pages ?? pagination?.totalPages ?? 1
  if (!pagination || pages <= 1) return null
  return <nav aria-label={label} className="ui-pagination"><Button disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</Button><span>Page {pagination.page} of {pages}</span><Button disabled={pagination.page >= pages} onClick={() => onPageChange(pagination.page + 1)}>Next</Button></nav>
}
