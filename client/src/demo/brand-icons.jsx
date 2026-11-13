import { brandMarks } from './brand-marks.js'
const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
const aliases = { googlemail: 'gmail', microsoftoutlook: 'outlook' }
export function BrandIcon({ name, size = 28, className = '', monochrome = false }) {
  const key = normalize(name)
  const mark = brandMarks[aliases[key] || key]
  const props = { className: `dx-brand-svg ${className}`, width: size, height: size, viewBox: '0 0 24 24', focusable: 'false', 'aria-hidden': true }
  if (mark) return <svg {...props} fill={monochrome ? 'currentColor' : mark.color}><path d={mark.path} /></svg>
  return <svg {...props}><rect width="24" height="24" rx="7" fill="currentColor" /><text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="750" fontFamily="Arial, sans-serif">{String(name || '?').trim().charAt(0).toUpperCase()}</text></svg>
}
