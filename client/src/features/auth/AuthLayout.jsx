import { Link } from 'react-router-dom'
import { DemoMark, Icon } from '../../demo/components.jsx'
import '@fontsource-variable/manrope'
import './prism-auth.css'

function AuthLayout({ children, description, eyebrow, title }) {
  return (
    <div className="dx-design-scope prism-auth-flow" data-design="prism"><div className="dx-setup">
      <a className="dx-sr-only" href="#auth-form">Skip to form</a>
      <header className="dx-setup-header">
        <Link className="dx-brand" to="/" aria-label="OwnTrace home">
          <DemoMark /><strong>OwnTrace</strong>
        </Link>
        <Link className="auth-back-link" to="/">Back to product</Link>
      </header>

      <div className="dx-setup-layout">
        <aside className="dx-setup-story" aria-labelledby="auth-title">
          <p className="dx-hero-label">A LITTLE CLARITY GOES A LONG WAY</p>
          <h1 id="auth-title">Your digital life.<br /><em>Back in your hands.</em></h1>
          <p>{description}</p>
          <div className="dx-setup-trust"><Icon name="lock" size={17}/><p>Your private workspace.<br/><strong>Connections stay your choice.</strong></p></div>
        </aside>

        <main id="auth-form" className="dx-setup-main" aria-label={`${eyebrow} form`}>
          <p className="dx-kicker">{eyebrow}</p><p className="dx-description">{title}</p>
          {children}
        </main>
      </div>
    </div></div>
  )
}

export default AuthLayout
