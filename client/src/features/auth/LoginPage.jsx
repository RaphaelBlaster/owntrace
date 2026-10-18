import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import AuthLayout from './AuthLayout.jsx'
import { getRequestErrors } from './auth-errors.js'
import { getPostLoginRoute } from './auth-navigation.js'
import useAuth from './useAuth.js'
import './auth.css'

function LoginPage() {
  const { login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [values, setValues] = useState({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: value }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
    setFormError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setFieldErrors({})
    setFormError('')

    try {
      const user = await login(values)
      const destination = getPostLoginRoute(user, location.state?.from)
      navigate(destination, { replace: true })
    } catch (error) {
      const requestErrors = getRequestErrors(error)
      setFieldErrors(requestErrors.fieldErrors)
      setFormError(requestErrors.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Return to your private workspace."
      description="Sign in to continue your OwnTrace setup. Your session stays in a protected browser cookie."
    >
      <div className="auth-card-heading">
        <p>Sign in</p>
        <h2>Continue to OwnTrace</h2>
      </div>

      {searchParams.get('account') === 'deleted' ? (
        <div className="auth-account-deleted" role="status">
          <strong>Your OwnTrace account and local workspace data were deleted.</strong>
          {searchParams.get('providerRevocation') === 'failed' ? (
            <span>
              Google could not confirm revocation. Review OwnTrace access in your{' '}
              <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
                Google Account<span className="auth-new-tab-copy"> (opens in a new tab)</span>
              </a>.
            </span>
          ) : (
            <span>Any connected Google access was revoked when available.</span>
          )}
        </div>
      ) : null}

      {formError ? <p className="auth-form-error" role="alert">{formError}</p> : null}

      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
        <div className="auth-field">
          <label htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            name="email"
            type="email"
            value={values.email}
            onChange={updateField}
            autoComplete="email"
            required
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
          />
          {fieldErrors.email ? <span id="login-email-error" className="auth-field-error">{fieldErrors.email}</span> : null}
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            value={values.password}
            onChange={updateField}
            autoComplete="current-password"
            required
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
          />
          {fieldErrors.password ? <span id="login-password-error" className="auth-field-error">{fieldErrors.password}</span> : null}
        </div>

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in securely'}
        </button>
      </form>

      <p className="auth-switch-copy">
        New to OwnTrace? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  )
}

export default LoginPage
