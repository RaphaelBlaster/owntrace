import { Card } from '../../ui/components.jsx'
import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api.js'
import PrivacyPageLayout, { EmptyState, ErrorState, LoadingState, Pagination, StatusPill } from './PrivacyPageLayout.jsx'
import { formatDate, formatEnum } from './privacy-format.js'

const initialForm = { notes: '', requestType: 'ACCESS', serviceName: '' }

function nextStatuses(status) {
  return {
    CANCELLED: ['DRAFT'],
    COMPLETED: [],
    DRAFT: ['READY', 'CANCELLED'],
    READY: ['DRAFT', 'SENT', 'CANCELLED'],
    SENT: ['COMPLETED', 'CANCELLED'],
  }[status] || []
}

function PrivacyRequestsPage() {
  const [form, setForm] = useState(initialForm)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const loadRequests = useCallback((signal) => api.get('/privacy-requests', {
    params: { limit: 12, page },
    signal,
  }).then((response) => setResult(response.data)), [page])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    loadRequests(controller.signal).catch((requestError) => {
      if (requestError.code !== 'ERR_CANCELED') setError(requestError.response?.data?.message || 'OwnTrace could not load privacy requests.')
    })
    return () => controller.abort()
  }, [loadRequests, refreshKey])

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setError('')
    setNotice('')
    try {
      await api.post('/privacy-requests', form)
      setForm(initialForm)
      setPage(1)
      setRefreshKey((value) => value + 1)
      setNotice('Draft saved. OwnTrace has not sent anything to the service.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'OwnTrace could not save this privacy request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function updateStatus(requestId, status) {
    setBusyId(requestId)
    setError('')
    setNotice('')
    try {
      await api.patch(`/privacy-requests/${requestId}`, { status })
      setRefreshKey((value) => value + 1)
      setNotice(status === 'SENT'
        ? 'Marked sent. This records your manual action; OwnTrace did not contact the service.'
        : `Request marked ${formatEnum(status).toLowerCase()}.`)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'OwnTrace could not update this request.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <PrivacyPageLayout
      description="Create and track a minimal record of requests you send through a service’s official privacy channel. OwnTrace does not automatically contact third parties in this MVP."
      eyebrow="Privacy requests"
      title="Privacy requests"
    >
      <Card className="privacy-card " aria-labelledby="new-request-title">
        <div className="privacy-section-heading"><div><p>Manual tracker</p><h2 id="new-request-title">Create a request draft</h2></div></div>
        <form className="privacy-form" onSubmit={handleSubmit}>
          <label><span>Service name</span><input autoComplete="organization" maxLength="120" name="serviceName" onChange={updateForm} required value={form.serviceName} /></label>
          <label><span>Request type</span><select name="requestType" onChange={updateForm} value={form.requestType}><option value="ACCESS">Access my data</option><option value="DELETE">Delete my data</option><option value="CORRECT">Correct my data</option><option value="OPT_OUT">Opt out</option></select></label>
          <label className="is-full"><span>Notes (optional)</span><textarea maxLength="500" name="notes" onChange={updateForm} value={form.notes} /></label>
          <div className="privacy-form-actions"><button disabled={isSubmitting} type="submit">{isSubmitting ? 'Saving…' : 'Save draft'}</button><p>Only service name, type, status, and your optional notes are stored.</p></div>
        </form>
      </Card>

      <div aria-live="polite">{notice ? <p className="privacy-note">{notice}</p> : null}</div>
      {error ? <ErrorState>{error}</ErrorState> : null}
      {!result && !error ? <LoadingState>Loading privacy requests…</LoadingState> : null}
      {result?.requests.length ? (
        <Card className="privacy-card " aria-labelledby="request-list-title">
          <div className="privacy-section-heading"><div><p>Tracked locally</p><h2 id="request-list-title">Your request records</h2></div><StatusPill>{result.pagination.total} total</StatusPill></div>
          <ul className="privacy-list">
            {result.requests.map((privacyRequest) => (
              <li className="privacy-list-item" key={privacyRequest.id}>
                <div><strong>{privacyRequest.serviceName} · {formatEnum(privacyRequest.requestType)}</strong><p>{privacyRequest.notes || 'No notes added.'}</p><small>Created {formatDate(privacyRequest.createdAt)}</small></div>
                <div className="privacy-actions">
                  <StatusPill>{formatEnum(privacyRequest.status)}</StatusPill>
                  {nextStatuses(privacyRequest.status).map((status) => (
                    <button className={`privacy-action${status === 'SENT' || status === 'COMPLETED' ? ' is-primary' : ''}`} disabled={busyId === privacyRequest.id} key={status} onClick={() => updateStatus(privacyRequest.id, status)} type="button">{formatEnum(status)}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <Pagination label="Privacy request pages" onPageChange={setPage} pagination={result.pagination} />
        </Card>
      ) : result ? <EmptyState title="No privacy requests yet">Create a minimal draft when you are ready to contact a service through its official channel.</EmptyState> : null}
    </PrivacyPageLayout>
  )
}

export default PrivacyRequestsPage
