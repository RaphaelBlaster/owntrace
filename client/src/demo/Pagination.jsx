import { Icon } from './components.jsx'

export default function Pagination({ pagination, label, target }) {
  const { total, page, pages, size, sizes, start, update } = pagination
  if (!total) return null
  function change(key, value) {
    update(key, value)
    requestAnimationFrame(() => {
      const list = document.getElementById(target)
      list?.scrollIntoView({ block: 'start', behavior: 'instant' })
      list?.focus({ preventScroll: true })
    })
  }
  // Keep the control compact even when a real workspace contains many pages.
  const visible = [...new Set([1, ...[page - 1, page, page + 1].filter(n => n > 1 && n < pages), pages])]
  return <nav className="ot-pagination" aria-label={`${label} pagination`}>
    <div className="ot-pagination-summary" role="status"><strong>{start + 1}–{Math.min(start + size, total)}</strong> of {total} {total === 1 ? label.replace(/s$/, '') : label}</div>
    <label className="ot-page-size">Per page<select aria-label={`${label} per page`} value={size} onChange={event => change('perPage', Number(event.target.value))}>{sizes.map(value => <option key={value}>{value}</option>)}</select></label>
    <div className="ot-page-buttons"><button type="button" className="ot-page-prev" aria-label={`Previous ${label} page`} disabled={page === 1} onClick={() => change('page', page - 1)}><Icon name="chevron" size={15} /></button>{visible.map((value, index) => <span key={value}>{index > 0 && value - visible[index - 1] > 1 ? <i aria-hidden="true">…</i> : null}<button type="button" aria-label={`${label} page ${value}`} aria-current={value === page ? 'page' : undefined} onClick={() => change('page', value)}>{value}</button></span>)}<button type="button" aria-label={`Next ${label} page`} disabled={page === pages} onClick={() => change('page', page + 1)}><Icon name="chevron" size={15} /></button></div>
  </nav>
}
