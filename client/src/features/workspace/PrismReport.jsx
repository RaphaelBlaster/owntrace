import { useDemo } from '../../demo/context.js'
import { Link } from '../../demo/prism-navigation.jsx'
import { ActionButton, Icon, ScreenHeader, SectionTitle, Tag } from '../../demo/components.jsx'
import { label } from './prism-data.js'

function PrismReport() {
  const { health, summary, actionSummary } = useDemo()
  function exportReport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ generatedAt:new Date().toISOString(),health,accountSummary:summary,actionSummary }, null, 2)], { type:'application/json' }))
    const anchor=document.createElement('a');anchor.href=url;anchor.download='owntrace-privacy-report.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <><ScreenHeader kicker="THE BIGGER PICTURE" title="Your footprint, explained." description="An understandable summary of what’s known, what’s inferred, and what’s next." actions={<ActionButton onClick={exportReport}><Icon name="download" size={16} />Export report</ActionButton>} />
    <div className="dx-report-grid"><section className="dx-panel dx-report-score"><p className="dx-kicker">YOUR PRIVACY PULSE</p><div className="dx-score-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="49" className="dx-ring-track" /><circle cx="60" cy="60" r="49" className="dx-ring-progress" strokeDasharray={`${(health.score ?? 0)*3.079} 307.9`} /></svg><div><strong>{health.score ?? '—'}</strong><span>{health.score == null ? 'NOT ENOUGH DATA' : 'OUT OF 100'}</span></div></div><h2>{health.score == null ? 'Your evidence will appear here.' : 'A clearer view of your workspace.'}</h2><p>{health.summary}</p><Link to="/demo/actions">Review your next steps <Icon name="arrow" size={15} /></Link></section>
      <section className="dx-panel"><SectionTitle title="What goes into your score" description="Bounded penalties from the current OwnTrace calculation." /><div className="dx-category-bars">{health.factors.map(factor=><div key={factor.id}><span>{label(factor.id.replace(/([A-Z])/g,' $1'))}</span><div><i style={{width:`${factor.penalty}%`}} /></div><b>−{factor.penalty}</b></div>)}</div><Tag>{label(health.confidence)}</Tag></section></div>
    <section className="dx-panel"><SectionTitle title="Three layers of clarity" description="Keep evidence, interpretation, and your decisions separate." /><div className="dx-clarity-grid"><div><span className="dx-square-icon"><Icon name="mail" size={20} /></span><h3>Observed accounts</h3><p>{summary.total} accounts were discovered from available evidence. {summary.highConfidence} have high confidence.</p><Tag tone="green">Mail metadata</Tag></div><div><span className="dx-square-icon"><Icon name="accounts" size={20} /></span><h3>Activity inferences</h3><p>{summary.dormant} dormant and {summary.possiblyDormant} possibly dormant accounts. Missing mail does not prove an account is unused.</p><Tag tone="amber">Evidence has limits</Tag></div><div><span className="dx-square-icon"><Icon name="check" size={20} /></span><h3>Your decisions</h3><p>{actionSummary.completed} completed reviews; {actionSummary.open + actionSummary.inProgress} remain open or in progress.</p><Tag>Your control</Tag></div></div></section>
    <div className="dx-info-box"><Icon name="info" size={18} /><p>Privacy Health is an estimate from current signals, not an external security audit. The factors above explain the current calculation.</p></div></>
}
export default PrismReport
