import { icon } from './prototype/icons.js'
function TraceKitIcon({ name }) {
  // Standard Lucide copy geometry (lucide-static 1.56.0, ISC), bundled like the kit icons.
  if (name === 'copy') return <span className="trace-kit-icon" aria-hidden="true"><svg viewBox="0 0 24 24" strokeWidth="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg></span>
  return <span className="trace-kit-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon(name) }} />
}
export default TraceKitIcon
