import { useContext, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DemoContext } from '../../demo/context.js'
import WorkspaceShell from '../../demo/WorkspaceShell.jsx'
import { ActionButton, EmptyResult, Icon, Modal } from '../../demo/components.jsx'
import '../../demo/demo.css'
import '@fontsource-variable/manrope'
import '../../demo/directions.css'
import '../../demo/polish.css'
import '../../demo/prism-bits.css'
import '../../demo/navigation.css'
import './prism-live.css'
import './prism-pane-responsive.css'
import api from '../../services/api.js'
import useAuth from '../auth/useAuth.js'
import { EmbeddedWorkspaceContext, LegacyShellContext, useWorkspaceNavigate } from './workspace-navigation.jsx'
import { accountView, actionView, date, label, subscriptionView } from './prism-data.js'

const pageSize = (params, sizes) => sizes.includes(Number(params.get('perPage'))) ? Number(params.get('perPage')) : sizes[0]
function PrismWorkspace({ children, section, entityId }) {
  const embedded = useContext(EmbeddedWorkspaceContext), { user, logout } = useAuth()
  const routeParams=useParams(), id=entityId || routeParams.id, [params,setParams]=useSearchParams()
  const navigate = useWorkspaceNavigate()
  const [stored, setResult] = useState(null), [error, setError] = useState(''), [version, setVersion] = useState(0)
  const [fetching, setFetching] = useState(false)
  const result = stored?.section === section && stored?.id === id ? stored : null
  const [modal, setDialog] = useState(null), [notice, setNotice] = useState('')
  const [signingOut,setSigningOut] = useState(false)
  const query = params.toString()
  useEffect(() => {
    const controller = new AbortController(), options = { signal: controller.signal }
    setResult(previous => previous?.section === section && previous?.id === id ? previous : null); setFetching(true); setError(''); setDialog(null); setNotice('')
    const current = new URLSearchParams(query)
    const requestedPage = Number(current.get('page'))
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(10000, requestedPage) : 1
    async function load() {
      const requests = { summary: ['/accounts/summary'], actionSummary: ['/account-actions/summary'], google: ['/google/connection'], microsoft: ['/microsoft/connection'] }
      if (section === 'accounts') requests.accounts = ['/accounts', { page, limit: pageSize(current, [6,12,24]), search: current.get('q') || undefined, dormant: ({ Active:'ACTIVE', Dormant:'DORMANT', 'Possibly dormant':'POSSIBLY_DORMANT', Unknown:'UNKNOWN' })[current.get('status')], sort: current.get('sort') === 'Recent' ? 'lastSeen' : 'serviceName', direction: current.get('sort') === 'Recent' ? 'desc' : 'asc' }]
      else if (section === 'account') requests.detail = [`/accounts/${id}`]
      else requests.accounts = ['/accounts', { limit: 7, page: 1 }]
      if (section === 'subscriptions' || section === 'dashboard') requests.subscriptions = ['/subscriptions', { page: section === 'subscriptions' ? page : 1, limit: section === 'subscriptions' ? pageSize(current, [12,24,48]) : 5 }]
      if (['dashboard','actions','health','account'].includes(section)) requests.actions = ['/account-actions', { page: section === 'actions' ? page : 1, limit: section === 'actions' ? pageSize(current,[2,4,8]) : 5, status: current.get('status') || ({ Done:'COMPLETED', 'In progress':'IN_PROGRESS', Dismissed:'DISMISSED' })[current.get('view')] || 'OPEN', accountId: section === 'account' ? id : current.get('accountId') || undefined }]
      if (['dashboard','health'].includes(section)) requests.health = ['/privacy-health']
      if (section === 'security') {
        const bounded = key => { const value=Number(current.get(key));return Number.isInteger(value)&&value>0 ? Math.min(10000,value) : 1 }
        requests.security = ['/breaches', { breachPage:bounded('breachPage'), signalPage:bounded('signalPage'), breachLimit:12, signalLimit:12 }]
      }
      const entries = await Promise.all(Object.entries(requests).map(async ([name, [url, search]]) => {
        // Provider status is auxiliary: an unavailable provider must not hide owned records.
        try { return [name, (await api.get(url, { ...options, params: search })).data] }
        catch (failure) { if (['google','microsoft'].includes(name) && failure.code !== 'ERR_CANCELED') return [name, { unavailable: true }]; throw failure }
      }))
      if (controller.signal.aborted) return
      const data = Object.fromEntries(entries)
      if (section === 'security') {
        for (const [key, list] of [['breachPage',data.security.breachPagination],['signalPage',data.security.pagination]]) {
          if (list.total && list.page > list.pages) {setParams(previous=>{const next=new URLSearchParams(previous);next.set(key,String(list.pages));return next},{replace:true});return}
        }
      }
      const pagination = section === 'accounts' ? data.accounts?.pagination : section === 'subscriptions' ? data.subscriptions?.pagination : section === 'actions' ? data.actions?.pagination : null
      if (pagination?.total && page > pagination.pages && section !== 'dashboard') {
        setParams(previous => { const next=new URLSearchParams(previous);next.set('page', String(pagination.pages));return next }, { replace:true }); return
      }
      setResult({ ...data, section, id })
    }
    load().catch(failure => { if (!controller.signal.aborted) setError(failure.response?.status === 404 ? 'This record is no longer in your workspace.' : failure.response?.data?.message || 'Your workspace could not load. Try again.') }).finally(()=>{if(!controller.signal.aborted)setFetching(false)})
    return () => controller.abort()
  }, [section, id, query, version, setParams])
  const connectionRecords = { Gmail: result?.google?.unavailable ? {status:'UNAVAILABLE'} : result?.google?.google?.connection, Outlook: result?.microsoft?.unavailable ? {status:'UNAVAILABLE'} : result?.microsoft?.microsoft?.connection }
  const providers = Object.fromEntries(Object.entries(connectionRecords).map(([name, connection]) => [name, ['CONNECTED','SYNCING'].includes(connection?.status)]))
  const scans = Object.values(connectionRecords)
  const recentScan = scans.map(connection => connection?.lastSyncAt).filter(Boolean).sort().at(-1)
  const accounts = result?.detail ? [accountView(result.detail.account, result.detail)] : (result?.accounts?.accounts || []).map(account => accountView(account))
  const actions = (result?.actions?.actions || []).map(actionView)
  const setModal = request => {
    if (!request) setDialog(null)
    else if (request.type === 'action') setDialog(request)
    else if (request.type === 'notifications') navigate('/notifications')
    else if (request.type === 'account-review') navigate(`/account-actions?accountId=${request.id}`)
    else navigate('/connect')
  }
  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try { await logout();navigate('/login',{replace:true}) }
    catch {setNotice('Sign out could not complete. Try again.')}
    finally {setSigningOut(false)}
  }
  const value = { live:true, loading:!result && !error, accounts, actions, subscriptions:(result?.subscriptions?.subscriptions || []).map(subscription => {const plan=subscriptionView(subscription);plan.accountId=accounts.find(account=>account.domain===plan.domain)?.id;return plan}),
    summary:result?.summary?.summary, actionSummary:result?.actionSummary?.summary, subscriptionTotal:result?.subscriptions?.pagination?.total, health:result?.health?.health, security:result?.security,
    accountPagination:result?.accounts?.pagination, subscriptionPagination:result?.subscriptions?.pagination, actionPagination:result?.actions?.pagination,
    profile:{name:user.name || user.email?.split('@')[0] || 'Your workspace', goal:user.workspaceGoal || 'Get organized'}, providers, connectionRecords, connectionStatusUnavailable:scans.some(connection=>connection?.status==='UNAVAILABLE'), scanning:scans.some(connection => connection?.status === 'SYNCING'), lastScan:recentScan ? date(recentScan) : 'Not yet scanned',
    setScanning:() => navigate('/connect'), modal, setModal, setToast:setNotice, signOut, signingOut }
  const content = error ? <section role="alert" className="dx-panel"><h1>Workspace unavailable</h1><p>{error}</p><ActionButton onClick={() => setVersion(value => value+1)}>Retry</ActionButton></section>
    : !result ? <div className="dx-panel" role="status"><span className="dx-loading" /> Loading your workspace…</div> : <div aria-busy={fetching}>{fetching ? <span className="prism-refresh-status" role="status">Updating workspace…</span> : null}{children}</div>
  // Suppress only legacy shells; keep actual navigation context unchanged.
  return <DemoContext value={value}><LegacyShellContext value={true}><div className="dx-design-scope prism-authenticated" data-design="prism">{embedded ? <div className="dx-app prism-embedded-content">{content}</div> : <WorkspaceShell>{content}</WorkspaceShell>}
    {notice ? <p className="dx-toast" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></p> : null}
    {modal?.type === 'action' ? <ActionReview action={actions.find(action => action.id === modal.id)} close={() => setDialog(null)} saved={() => { setDialog(null);setVersion(value=>value+1) }} /> : null}
  </div></LegacyShellContext></DemoContext>
}
function ActionReview({ action, close, saved }) {
  const [status, setStatus] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('')
  async function save() {
    setBusy(true);setError('')
    try { await api.patch(`/account-actions/${action.id}`, {status}); saved() }
    catch (failure) { setError(failure.response?.data?.message || 'Your decision could not be saved.') }
    finally { setBusy(false) }
  }
  return <Modal title={action?.title || 'Recommendation unavailable'} onClose={close} wide>{!action ? <EmptyResult title="Recommendation no longer visible" description="Reload your action list to check its current status." /> : <div className="dx-review-stage"><p className="dx-modal-description">{action.description}</p><div className="dx-review-evidence"><span><Icon name="mail" /> WHY THIS APPEARED</span><p>{action.reason}</p></div><p className="dx-fine-print">Record your progress in OwnTrace. Account changes must be completed through the service itself.</p><fieldset className="dx-review-decisions"><legend>Confirm the status you want to record</legend>{['OPEN','IN_PROGRESS','COMPLETED','DISMISSED'].map(value=><label key={value} className={status===value?'selected':''}><input type="radio" name="action-status" checked={status===value} onChange={()=>setStatus(value)} /><span>{label(value)}</span></label>)}</fieldset>{error?<p role="alert">{error}</p>:null}<div className="dx-modal-footer"><ActionButton onClick={close} disabled={busy}>Cancel</ActionButton><ActionButton variant="primary" disabled={!status || busy} onClick={save}>{busy?'Saving…':'Confirm and save'}</ActionButton></div></div>}</Modal>
}
export default PrismWorkspace
