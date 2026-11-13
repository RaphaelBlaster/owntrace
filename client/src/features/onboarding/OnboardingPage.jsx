import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import useAuth from '../auth/useAuth.js'
import './onboarding.css'

const steps = [
  {
    eyebrow: 'Welcome to OwnTrace',
    title: 'Know what happens before you connect anything.',
    description:
      'OwnTrace helps you organize accounts discovered from sources you choose to connect. It does not claim to find every account or automatically control every service.',
    points: [
      ['Your choice', 'Nothing is connected during this introduction.'],
      ['Clear evidence', 'Discoveries should explain which account signals support them.'],
      ['Honest limits', 'Inferences stay labeled as likely, possible, or unknown.'],
    ],
    action: 'Review the privacy approach',
  },
  {
    eyebrow: 'Privacy approach',
    title: 'Derive useful signals, keep less source data.',
    description:
      'For connected mail discovery, OwnTrace will request only the access needed for the implemented scan and prefer derived account evidence over stored inbox content.',
    points: [
      ['What may be read', 'Message metadata and limited account-related signals needed for classification.'],
      ['What is retained', 'Service, sender domain, dates, evidence type, and explainable confidence inputs.'],
      ['What is avoided', 'Full message bodies, raw OAuth tokens in the browser, and unnecessary provider data.'],
    ],
    action: 'Understand mail connections',
  },
  {
    eyebrow: 'Mail connections',
    title: 'Use inbox signals to surface possible accounts.',
    description:
      'Verification, password-reset, welcome, and security messages can provide account evidence. Marketing email alone will not be treated as proof that you own an account.',
    points: [
      ['Before consent', 'Each provider will show the requested permissions before access is granted.'],
      ['During a scan', 'OwnTrace will process in controlled batches and show connection or scan status.'],
      ['Your control', 'You will be able to disconnect a provider and remove its stored integration data.'],
    ],
    action: 'Continue to mail connections',
  },
]

function getInitialStep(status) {
  if (status === 'GMAIL_PENDING') return 2
  if (status === 'PRIVACY_REVIEWED') return 1
  return 0
}

function OnboardingPage() {
  const { restoreSession, user } = useAuth()
  const navigate = useNavigate()
  const titleRef = useRef(null)
  const [stepIndex, setStepIndex] = useState(() => getInitialStep(user.onboardingStatus))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const isReviewingCompletedSetup = ['SCAN_PENDING', 'COMPLETED'].includes(user.onboardingStatus)
  const step = steps[stepIndex]
  const progress = useMemo(() => `${stepIndex + 1} of ${steps.length}`, [stepIndex])

  function showStep(nextStep) {
    setStepIndex(nextStep)
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  async function continueOnboarding() {
    setIsSaving(true)
    setError('')

    try {
      if (stepIndex === 0) {
        if (user.onboardingStatus === 'NOT_STARTED') {
          await api.patch('/onboarding', { status: 'PRIVACY_REVIEWED' })
          await restoreSession({ showLoading: false })
        }
        showStep(1)
      } else if (stepIndex === 1) {
        showStep(2)
      } else {
        if (!isReviewingCompletedSetup && user.onboardingStatus !== 'GMAIL_PENDING') {
          await api.patch('/onboarding', { status: 'GMAIL_PENDING' })
          await restoreSession({ showLoading: false })
        }
        navigate('/connect', { replace: true })
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          'OwnTrace could not save your progress. Check your connection and try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <header className="onboarding-header">
          <span className="onboarding-brand">OwnTrace</span>
          <span className="onboarding-progress-label">Step {progress}</span>
        </header>

        <div className="onboarding-progress" aria-hidden="true">
          <span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>

        <section className="onboarding-content" aria-labelledby="onboarding-title">
          <div className="onboarding-copy">
            <p className="onboarding-eyebrow">{step.eyebrow}</p>
            <h1 ref={titleRef} id="onboarding-title" tabIndex="-1">{step.title}</h1>
            <p>{step.description}</p>
          </div>

          <ol className="onboarding-principles">
            {step.points.map(([title, description], index) => (
              <li key={title}>
                <span aria-hidden="true">0{index + 1}</span>
                <div><h2>{title}</h2><p>{description}</p></div>
              </li>
            ))}
          </ol>

          {error ? <p className="onboarding-error" role="alert">{error}</p> : null}

          <div className="onboarding-actions">
            {stepIndex > 0 ? (
              <button type="button" className="onboarding-back" onClick={() => showStep(stepIndex - 1)} disabled={isSaving}>
                Back
              </button>
            ) : <span />}
            <button type="button" className="onboarding-continue" onClick={continueOnboarding} disabled={isSaving}>
              {isSaving
                ? 'Saving…'
                : isReviewingCompletedSetup && stepIndex === steps.length - 1
                  ? 'Return to mail connections'
                  : step.action}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

export default OnboardingPage
