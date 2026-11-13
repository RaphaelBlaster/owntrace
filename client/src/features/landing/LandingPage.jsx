import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './landing.css'

const IdentityCore3D = lazy(() => import('./components/IdentityCore3D.jsx'))

const capabilities = [
  ['Accounts', 'Build a reviewable inventory from signals found in sources you choose to connect.', '01'],
  ['Subscriptions', 'Surface recurring services that may deserve a closer look—without pretending every charge is known.', '02'],
  ['Connected apps', 'Review supported third-party connections and understand what access may still be active.', '03'],
  ['Breach context', 'Relate known exposure records to discovered accounts so the next security step is clearer.', '04'],
  ['Permissions', 'See available permission details in plain language, with provider limitations kept visible.', '05'],
  ['Privacy actions', 'Turn findings into an ordered review queue while keeping every final decision with you.', '06'],
]

const workflow = [
  ['Connect', 'Choose a supported source and review the exact permission requested.'],
  ['Discover', 'OwnTrace derives account signals while avoiding message-body storage.'],
  ['Understand', 'Each finding shows the evidence and uncertainty behind it.'],
  ['Prioritize', 'Security, subscription, and cleanup reviews are organized by context.'],
  ['Decide', 'You confirm what is true and choose whether to act.'],
]

const privacyPrinciples = [
  ['Least privilege', 'Ask only for the narrowest supported provider access.'],
  ['Derived signals', 'Prefer useful metadata over collecting complete source content.'],
  ['Explainable findings', 'Keep the reason for every discovery beside the discovery itself.'],
  ['Revocable access', 'Make connected sources visible and disconnectable.'],
]

function Mark() {
  return <span className="ot-mark" aria-hidden="true"><i /><i /><i /></span>
}

function Arrow() {
  return <span className="ot-arrow" aria-hidden="true">↗</span>
}

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="ot-home">
      <a className="ot-skip" href="#main-content">Skip to main content</a>
      <header className="ot-header">
        <nav className="ot-nav ot-container" aria-label="Primary navigation">
          <a className="ot-brand" href="#top" aria-label="OwnTrace home"><Mark /><span>OwnTrace</span></a>
          <div className="ot-nav-links">
            <a href="#capabilities">Product</a><a href="#how-it-works">How it works</a>
            <a href="#privacy">Privacy</a>
          </div>
          <div className="ot-nav-actions">
            <Link to="/login">Sign in</Link>
            <Link className="ot-button ot-button-light ot-button-small" to="/register">Create account</Link>
          </div>
          <button aria-controls="ot-mobile-menu" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} className="ot-menu-button" onClick={() => setMenuOpen((value) => !value)} ref={menuButtonRef} type="button"><span /><span /></button>
          <div className="ot-mobile-menu" id="ot-mobile-menu" hidden={!menuOpen}>
            <a href="#capabilities" onClick={closeMenu}>Product</a><a href="#how-it-works" onClick={closeMenu}>How it works</a>
            <a href="#privacy" onClick={closeMenu}>Privacy</a>
            <Link to="/login" onClick={closeMenu}>Sign in</Link><Link className="ot-button ot-button-light" to="/register" onClick={closeMenu}>Create account</Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <section className="ot-hero" id="top" aria-labelledby="hero-title">
          <div className="ot-container ot-hero-layout">
            <div className="ot-hero-copy">
              <p className="ot-kicker"><span /> Personal digital identity control</p>
              <h1 id="hero-title">Your digital life has a trail. Make it yours.</h1>
              <p className="ot-hero-lead">OwnTrace helps you build an explainable inventory of online accounts, subscriptions, connected apps, breaches, and privacy risks from sources you choose to connect.</p>
              <div className="ot-hero-actions">
                <Link className="ot-button ot-button-dark" to="/register">Start with your account <Arrow /></Link>
                <a className="ot-text-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
              </div>
              <p className="ot-trust-line"><span aria-hidden="true">✓</span> Nothing is connected until you choose it.</p>
            </div>
            <div className="ot-hero-instrument" role="group" aria-label="Your digital identity map">
              <div className="ot-instrument-stage">
                <Suspense fallback={<div className="identity-core-shell is-loading" aria-hidden="true" />}><IdentityCore3D /></Suspense>
                <span className="ot-scene-label ot-scene-label-a">FOUR REVIEW AREAS <b>CONNECTED BY EVIDENCE</b></span>
              </div>
            </div>
          </div>
        </section>

        <section className="ot-principle-strip" aria-label="Product principles"><div className="ot-container">
          <p><strong>Metadata first</strong><span>Use the minimum useful signal.</span></p>
          <p><strong>Evidence visible</strong><span>See why an account appeared.</span></p>
          <p><strong>You decide</strong><span>No automatic action without you.</span></p>
        </div></section>

        <section className="ot-section ot-problem" aria-labelledby="problem-title"><div className="ot-container ot-problem-grid">
          <div className="ot-section-heading"><p className="ot-kicker">The missing inventory</p><h2 id="problem-title">Years of sign-ups become an invisible second life.</h2></div>
          <div className="ot-problem-copy"><p>An old inbox, a trial subscription, a forgotten login, an app you authorized once—each leaves a separate fragment. No single provider shows the whole picture.</p><p>OwnTrace is being built to organize supported fragments without claiming it can discover everything or act on every service.</p></div>
          <div className="ot-fragment-ledger" aria-label="Examples of scattered digital footprint signals">
            <div><span>01</span><strong>Old accounts</strong><small>Where did I sign up?</small></div><div><span>02</span><strong>Subscriptions</strong><small>What might I still pay for?</small></div>
            <div><span>03</span><strong>App access</strong><small>Who may still have access?</small></div><div><span>04</span><strong>Breaches</strong><small>What exposure is known?</small></div>
          </div>
        </div></section>

        <section className="ot-section ot-capabilities" id="capabilities" aria-labelledby="capabilities-title"><div className="ot-container">
          <div className="ot-section-heading ot-heading-row"><div><p className="ot-kicker">One reviewable view</p><h2 id="capabilities-title">See the parts that normally stay disconnected.</h2></div><p>Capabilities depend on the sources you connect and the data each provider makes available.</p></div>
          <div className="ot-capability-list">{capabilities.map(([title, description, number]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{description}</p><Arrow /></article>)}</div>
        </div></section>

        <section className="ot-section ot-workflow" id="how-it-works" aria-labelledby="workflow-title"><div className="ot-container">
          <div className="ot-section-heading ot-workflow-heading"><p className="ot-kicker ot-kicker-light">A deliberate workflow</p><h2 id="workflow-title">From a signal to a decision—without skipping the explanation.</h2></div>
          <ol className="ot-workflow-list">{workflow.map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
        </div></section>

        <section className="ot-section ot-evidence" aria-labelledby="evidence-title"><div className="ot-container ot-evidence-layout">
          <div className="ot-section-heading"><p className="ot-kicker">Evidence before advice</p><h2 id="evidence-title">A finding should show its work.</h2><p>Instead of presenting a guess as fact, OwnTrace keeps source signals, recency, and uncertainty close to the account you are reviewing.</p><p className="ot-evidence-note"><span>i</span> Confidence supports review. It is never absolute certainty.</p></div>
          <article className="ot-account-record" aria-labelledby="sample-account-title">
            <header><div className="ot-service-mark" aria-hidden="true">C</div><div><span>Illustrative account record</span><h3 id="sample-account-title">Canva</h3></div><strong>Review suggested</strong></header>
            <dl><div><dt>First evidence</dt><dd>2021</dd></div><div><dt>Last evidence</dt><dd>2024</dd></div><div><dt>Signals</dt><dd>17</dd></div><div><dt>Assessment</dt><dd>Possibly dormant</dd></div></dl>
            <section aria-label="Why this account was surfaced"><h4>Why this appeared</h4><p><span aria-hidden="true">✓</span><strong>Supported sender metadata matched canva.com</strong><small>No message body stored</small></p><p><span aria-hidden="true">?</span><strong>The last supporting signal is older than 12 months</strong><small>Confirm the account before taking action</small></p></section>
            <footer><span>Sample data</span><span>User review required</span></footer>
          </article>
        </div></section>

        <section className="ot-section ot-privacy" id="privacy" aria-labelledby="privacy-title"><div className="ot-container ot-privacy-layout">
          <div className="ot-section-heading"><p className="ot-kicker ot-kicker-light">A privacy tool with boundaries</p><h2 id="privacy-title">Useful context should not require another archive of your life.</h2><p>OwnTrace is designed around data minimization, explicit permissions, and user-controlled connections. Provider access should remain narrow, visible, and reversible.</p></div>
          <ol className="ot-privacy-list">{privacyPrinciples.map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
        </div></section>

        <section className="ot-section ot-final" id="development-status" aria-labelledby="final-title"><div className="ot-container ot-final-panel">
          <div><p className="ot-kicker">Early development · user-controlled setup</p><h2 id="final-title">Start building a clearer picture of where your digital identity lives.</h2></div>
          <div><p>Create your OwnTrace account first. No mail provider is connected during registration.</p><div className="ot-final-actions"><Link className="ot-button ot-button-dark" to="/register">Create your account <Arrow /></Link></div></div>
        </div></section>
      </main>

      <footer className="ot-footer"><div className="ot-container ot-footer-main">
        <div><a className="ot-brand ot-brand-dark" href="#top"><Mark /><span>OwnTrace</span></a><p>Own your digital footprint.</p></div>
        <nav aria-label="Footer navigation"><div><strong>Explore</strong><a href="#capabilities">Product</a><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a></div><div><strong>Status</strong><a href="#development-status">Development status</a></div><div><strong>Legal</strong><Link to="/privacy-policy">Privacy policy</Link><Link to="/terms">Terms</Link></div></nav>
      </div><div className="ot-container ot-footer-bottom"><span>© {new Date().getFullYear()} OwnTrace</span><span>Early development</span></div></footer>
    </div>
  )
}

export default LandingPage
