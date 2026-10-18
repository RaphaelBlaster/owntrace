import PrivacyWorkspace from './PrivacyWorkspace.jsx'
import { Badge, Feedback, PageHeader, Pagination } from '../../ui/components.jsx'
import './privacy-pages.css'
function PrivacyPageLayout({ children, description, eyebrow, title }) {
  return <PrivacyWorkspace title={eyebrow}><main className="privacy-page"><div className="privacy-page-shell"><PageHeader eyebrow={eyebrow} title={title} description={description} />{children}</div></main></PrivacyWorkspace>
}
function LoadingState({ children = 'Loading your privacy data…' }) { return <Feedback tone="loading">{children}</Feedback> }
function EmptyState({ children, title }) { return <Feedback title={title}>{children}</Feedback> }
function ErrorState({ children }) { return <Feedback tone="error">{children}</Feedback> }
function StatusPill({ children, tone = 'neutral' }) { return <Badge tone={tone}>{children}</Badge> }
export { EmptyState, ErrorState, LoadingState, Pagination, StatusPill }
export default PrivacyPageLayout
