import { useState } from 'react'
import { Badge, BrandMark, Button, Card, Feedback, PageHeader } from './components.jsx'

export default function UiKitPage() {
  const [selected, setSelected] = useState('All accounts')
  return <main className="ui-kit-page"><div className="ui-kit-shell">
    <div className="ui-kit-brand"><BrandMark />OwnTrace<Button to="/">Back to product</Button></div>
    <PageHeader eyebrow="Design system / 01" title="A clear view of your digital life." description="The shared OwnTrace UI kit. Warm surfaces, readable evidence, and deliberate actions." />
    <div className="ui-kit-grid">
      <Card><h2>Color & surface</h2><p className="ui-description">A quiet canvas with color reserved for meaning.</p><div className="ui-swatches">{['canvas', 'surface', 'ink', 'accent', 'cyan', 'danger'].map(color => <div key={color}><span style={{ background: `var(--ui-${color})` }} /><small>{color}</small></div>)}</div></Card>
      <Card><p className="ui-eyebrow">Type hierarchy</p><h2>Evidence you can understand.</h2><p className="ui-description">Use plain language for decisions. Keep supporting details readable and close to their source.</p><small>Last signal · 24 Sep 2026 · Illustrative example</small></Card>
      <Card><h2>Actions</h2><div className="ui-kit-row"><Button variant="primary" onClick={() => setSelected('Primary action selected')}>Review accounts ↗</Button><Button onClick={() => setSelected('Secondary action selected')}>View evidence</Button><Button variant="quiet" onClick={() => setSelected('Quiet action selected')}>Learn more</Button><Button variant="danger" disabled>Delete account</Button></div><p role="status" className="ui-description">{selected}</p></Card>
      <Card><h2>Forms</h2><label className="ui-field">Search accounts<input type="search" placeholder="Service or domain" /></label><label className="ui-field">Confidence<select><option>All confidence</option><option>Confirmed</option><option>Likely</option></select></label><label className="ui-checkbox"><input type="checkbox" /> Include dormant accounts</label></Card>
      <Card><h2>Status</h2><div className="ui-kit-row"><Badge>Unknown</Badge><Badge tone="good">Confirmed</Badge><Badge tone="medium">Needs review</Badge><Badge tone="high">High priority</Badge></div><Feedback title="No account evidence yet">Connect a mail source to start building your inventory.</Feedback></Card>
      <Card><h2>Feedback</h2><Feedback tone="loading">Loading your account evidence…</Feedback><Feedback tone="error" title="Connection unavailable">Your progress is saved. Try again when the connection is restored.</Feedback></Card>
    </div>
  </div></main>
}
