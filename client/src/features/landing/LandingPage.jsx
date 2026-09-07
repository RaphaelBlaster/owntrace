import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Icon from './components/Icon.jsx'
import TraceField from './components/TraceField.jsx'
import './landing.css'

const views = [
  {
    name: 'Discover',
    title: 'Connect the dots.',
    description:
      'A clearer picture of the accounts, subscriptions, and connections that make up your online life.',
    label: 'Account overview',
    rows: [
      ['N', 'Notion', 'Productivity', 'Active'],
      ['S', 'Spotify', 'Entertainment', 'Subscription'],
      ['D', 'Dropbox', 'Cloud storage', 'Review access'],
    ],
    metric: '24',
    metricLabel: 'accounts in one place',
    note: 'Bring the pieces of your digital life into focus.',
  },
  {
    name: 'Understand',
    title: 'Find your blind spots.',
    description:
      'Understand which accounts deserve a closer look, with context that helps you decide what matters.',
    label: 'Attention needed',
    rows: [
      ['D', 'Dropbox', 'Connected application', 'Review access'],
      ['F', 'Forum account', 'Last used 2 years ago', 'Inactive'],
      ['S', 'Spotify', 'Recurring subscription', 'Review plan'],
    ],
    metric: '03',
    metricLabel: 'items to review',
    note: 'Less noise. A clearer sense of what to look at next.',
  },
  {
    name: 'Take action',
    title: 'Make your next move.',
    description:
      'Turn a sprawling footprint into a manageable action list. Keep what serves you. Reconsider what doesn’t.',
    label: 'Your action list',
    rows: [
      ['01', 'Review app permissions', 'Check connected access', 'Review'],
      ['02', 'Revisit an old account', 'Decide whether to keep it', 'Decide'],
      ['03', 'Check a subscription', 'Make sure it still matters', 'Check'],
    ],
    metric: '01',
    metricLabel: 'step at a time',
    note: 'You choose the action. You stay in control.',
  },
]

function Arrow() {
  return <Icon name="arrow" className="ot-arrow" />
}

export default function LandingPage() {
  const [active, setActive] = useState(0)
  const view = views[active]
  return (
    <div className="landing-page" id="top">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content">
        <section
          className="ot-hero landing-container"
          aria-labelledby="hero-title"
        >
          <div className="ot-hero-copy">
            <p className="ot-eyebrow">
              <span className="ot-dot" /> YOUR DIGITAL LIFE. BACK IN YOUR HANDS.
            </p>
            <h1 id="hero-title">
              You are more
              <br />
              than your
              <br />
              <em>digital trace.</em>
            </h1>
            <p className="ot-lead">
              Your accounts are everywhere.
              <br />
              Your control should be in one place.
            </p>
            <div className="ot-actions">
              <Link className="ot-button" to="/register">
                Own your footprint <Arrow />
              </Link>
              <a className="ot-text-link" href="#product">
                Explore OwnTrace <span>↘</span>
              </a>
            </div>
            <p className="ot-availability">
              Early access · Account setup available today
            </p>
          </div>
          <div className="ot-art">
            <div className="ot-art-grid" />
            <TraceField />
            <div className="ot-art-label ot-art-label-top">
              <span className="ot-cross">+</span> IDENTITY / REIMAGINED{' '}
              <span>001</span>
            </div>
            <div className="ot-signal ot-signal-one">
              <span className="ot-dot" />
              <span>
                Accounts.
                <br />
                <strong>Connected to you.</strong>
              </span>
            </div>
            <div className="ot-signal ot-signal-two">
              <Icon name="permissions" />
              <span>
                Your identity.
                <br />
                <strong>Your call.</strong>
              </span>
            </div>
            <div className="ot-art-label ot-art-label-bottom">
              ONE IDENTITY. COUNTLESS CONNECTIONS.
              <span className="ot-cross">+</span>
            </div>
          </div>
          <div className="ot-hero-bottom">
            <span>A SMALLER FOOTPRINT. A BIGGER SENSE OF CONTROL.</span>
            <a href="#product">
              SCROLL TO DISCOVER <span>↓</span>
            </a>
          </div>
        </section>

        <section className="ot-intro landing-container" id="product">
          <p className="ot-eyebrow">01 / THE BIG PICTURE</p>
          <div>
            <h2>
              You left a little of yourself.
              <br />
              <span>Almost everywhere.</span>
            </h2>
            <p>
              An account you forgot. A trial you signed up for. An app that
              still has access. OwnTrace is being built to bring those scattered
              pieces together, so you can see the whole picture.
            </p>
          </div>
        </section>

        <section
          className="ot-product landing-container"
          id="how-it-works"
          aria-label="Explore the product vision"
        >
          <div className="ot-product-top">
            <p className="ot-eyebrow">FROM SCATTERED TO SORTED</p>
            <span className="ot-tag">INTERACTIVE CONCEPT · SAMPLE DATA</span>
          </div>
          <div className="ot-tabs" role="tablist" aria-label="Product workflow">
            {views.map((item, index) => (
              <button
                key={item.name}
                role="tab"
                id={`tab-${index}`}
                aria-controls="product-panel"
                aria-selected={index === active}
                tabIndex={index === active ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  if (
                    ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault()
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : (active + (event.key === 'ArrowRight' ? 1 : 2)) % 3
                    setActive(next)
                    document.getElementById(`tab-${next}`)?.focus()
                  }
                }}
              >
                <span>0{index + 1}</span>
                {item.name}
                <span className="ot-tab-arrow">↗</span>
              </button>
            ))}
          </div>
          <div
            className="ot-product-body"
            id="product-panel"
            role="tabpanel"
            aria-labelledby={`tab-${active}`}
            tabIndex={0}
          >
            <div className="ot-product-copy">
              <h3>{view.title}</h3>
              <p>{view.description}</p>
              <div className="ot-metric">
                <strong>{view.metric}</strong>
                <span>{view.metricLabel}</span>
              </div>
            </div>
            <div className="ot-dashboard">
              <div className="ot-dash-heading">
                <span className="ot-mini-logo">◎</span>
                <strong>{view.label}</strong>
                <span className="ot-muted">Preview</span>
              </div>
              <div className="ot-dash-columns">
                <span>YOUR DIGITAL FOOTPRINT</span>
                <span>STATUS</span>
              </div>
              <div key={active} className="ot-rows">
                {view.rows.map(([symbol, name, category, status], i) => (
                  <div className="ot-account" key={name}>
                    <span className={`ot-account-icon icon-${i}`}>
                      {symbol}
                    </span>
                    <span>
                      <strong>{name}</strong>
                      <small>{category}</small>
                    </span>
                    <span className={`ot-status status-${i}`}>{status}</span>
                  </div>
                ))}
              </div>
              <div className="ot-dash-note">
                <Icon name="shield" />
                {view.note}
              </div>
            </div>
          </div>
          <p className="ot-concept-note">
            A look at where we’re headed. Discovery, integrations, and action
            tools are in development.
          </p>
        </section>

        <section className="ot-privacy landing-container" id="privacy">
          <div className="ot-privacy-art" aria-hidden="true">
            <div className="ot-lock-rings">
              <i />
              <i />
              <i />
              <Icon name="shield" />
            </div>
            <span>BUILT AROUND YOUR CONTROL</span>
          </div>
          <div className="ot-privacy-copy">
            <p className="ot-eyebrow">02 / ON YOUR TERMS</p>
            <h2>
              Privacy should
              <br />
              feel like <em>freedom.</em>
            </h2>
            <p>
              Getting a clearer picture of your digital life starts with knowing
              what you’re sharing.
            </p>
            <div className="ot-principle">
              <span>01</span>
              <div>
                <h3>A deliberate first step.</h3>
                <p>
                  Create your account and set your preferences before connecting
                  any services.
                </p>
              </div>
            </div>
            <div className="ot-principle">
              <span>02</span>
              <div>
                <h3>Clarity before connection.</h3>
                <p>
                  Gmail isn’t connected yet. You can explore onboarding without
                  giving inbox access.
                </p>
              </div>
            </div>
            <div className="ot-principle">
              <span>03</span>
              <div>
                <h3>Your decisions come first.</h3>
                <p>
                  Our direction is simple: give you the context to make informed
                  choices about your footprint.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="ot-final">
          <div className="landing-container">
            <p className="ot-eyebrow">
              <span className="ot-dot" /> START WITH YOU
            </p>
            <h2>
              Less scattered.
              <br />
              <em>More yours.</em>
            </h2>
            <div>
              <p>
                Take the first step toward
                <br />
                owning your digital footprint.
              </p>
              <Link className="ot-button" to="/register">
                Create your account <Arrow />
              </Link>
            </div>
            <span className="ot-final-watermark" aria-hidden="true">
              owntrace
            </span>
          </div>
        </section>
      </main>
      <footer className="ot-footer landing-container">
        <a className="landing-brand" href="#top">
          <span className="ot-mini-logo">◎</span>OwnTrace
        </a>
        <p>Own your digital footprint.</p>
        <a
          href="https://github.com/RaphaelBlaster/owntrace"
          target="_blank"
          rel="noreferrer"
        >
          Follow the build ↗
        </a>
        <span>EARLY DEVELOPMENT</span>
      </footer>
    </div>
  )
}
