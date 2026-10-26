import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import useAuth from '../auth/useAuth.js'
import TraceKitIcon from './TraceKitIcon.jsx'
import api from '../../services/api.js'
import TraceComposer from './TraceComposer.jsx'
import TraceGlow from './TraceGlow.jsx'
import TraceText from './TraceText.jsx'
import TracePreview from './TracePreview.jsx'
import { actionDestination } from './trace-navigation.js'
import { tracePreviewPath, workspaceDestination } from '../workspace/workspace-paths.js'
import { sendTraceMessage } from './trace-stream.js'
import './trace.css'


const prompts = ['Show my subscriptions', 'Which accounts need attention?', 'What supports my privacy score?']
function TracePage() {
  const { user } = useAuth()
  const location = useLocation(), navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const conversationId = params.get('chat')
  const [conversation, setConversation] = useState(null)
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState('')
  const [mobileTab, setMobileTab] = useState('chat')
  const [copied, setCopied] = useState('')
  const [streamText, setStreamText] = useState('')
  const [statusText, setStatusText] = useState('Looking through your workspace…')
  const [consentEnabled, setConsentEnabled] = useState(false)
  const [providerLabel, setProviderLabel] = useState('Inception')
  const [consentOpen, setConsentOpen] = useState(false)
  const [consentSaving, setConsentSaving] = useState(false)
  const consentRef = useRef(null), resumeRef = useRef(false)
  const chatRef = useRef(null)
  const responseDetailRef = useRef('high')
  const reducedMotion = useReducedMotion()
  const positionHeroComposer = useCallback((bounds) => {
    if (chatRef.current) chatRef.current.style.setProperty('--trace-pill-y', `${bounds.top + bounds.height / 2 - chatRef.current.getBoundingClientRect().top}px`)
  }, [])
  const requestRef = useRef(null), inputRef = useRef(null), threadRef = useRef(null), historyRef = useRef(null)
  const previewOpen = Boolean(tracePreviewPath(location))
  const chatting = Boolean(conversation?.messages.length || pending)
  useEffect(() => {
    const controller = new AbortController()
    api.get('/trace/status', { signal: controller.signal }).then(({ data }) => { setConfigured(data.configured); setConsentEnabled(data.consentEnabled); setProviderLabel(data.providerLabel) }).catch(() => setConfigured(false))
    api.get('/trace/conversations', { signal: controller.signal }).then(({ data }) => setHistory(data.conversations)).catch((error) => { if (error.code !== 'ERR_CANCELED') setError('Conversation history could not load.') })
    return () => { controller.abort(); requestRef.current?.abort() }
  }, [])
  useEffect(() => {
    if (!conversationId) { if (!requestRef.current) setConversation(null); setLoading(false); return undefined }
    if (conversation?.id === conversationId) { setLoading(false); return undefined }
    const controller = new AbortController()
    setConversation(null)
    setLoading(true); setError('')
    api.get(`/trace/conversations/${conversationId}`, { signal: controller.signal }).then(({ data }) => setConversation(data.conversation)).catch((error) => { if (error.code !== 'ERR_CANCELED') { setConversation(null); setError(error.response?.data?.message || 'Conversation unavailable.') } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [conversationId, conversation?.id])
  useEffect(() => {
    if (consentOpen && !consentRef.current?.open) consentRef.current?.showModal()
    if (!consentOpen && consentRef.current?.open) consentRef.current?.close()
  }, [consentOpen])
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) }, [conversation?.messages.length, pending, busy])
  useEffect(() => {
    if (!historyOpen) return
    historyRef.current?.querySelector('button')?.focus()
    function escape(event) { if (event.key === 'Escape') { setHistoryOpen(false); inputRef.current?.focus() } }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [historyOpen])

  function withChat(to, id = conversation?.id || conversationId) {
    if(to.startsWith('/trace/view/'))to=workspaceDestination(to.slice('/trace/view'.length),true)
    if (!id) return to
    return `${to}${to.includes('?') ? '&' : '?'}chat=${encodeURIComponent(id)}`
  }
  function closePreview() { navigate(withChat('/trace')); setMobileTab('chat') }
  function newChat() {
    if (busy) return
    setConversation(null); setPending(''); setDraft(''); setError(''); setHistoryOpen(false)
    navigate('/trace'); inputRef.current?.focus()
  }
  async function openAction(action, resolve = true, id) {
    try {
      let validated = action
      if (resolve) {
        const clean = action.type === 'focus_entity' ? { type: action.type, entityType: action.entityType, entityId: action.entityId } : action
        const { data } = await api.post('/trace/resolve-action', clean)
        validated = data.actions[0]
      }
      const to = actionDestination(validated)
      if (!to) throw new Error('Unsupported view')
      navigate(withChat(to, id)); setMobileTab(validated.type==='close_preview'?'chat':'preview')
    } catch (error) { setError(error.response?.data?.message || 'This workspace view is unavailable. The record may have changed.') }
  }
  async function send(consentOverride = false, submitted) {
    if (busy || loading || !(submitted?.text || draft).trim()) return
    responseDetailRef.current = submitted?.detail || responseDetailRef.current
    if (configured !== false && !consentEnabled && consentOverride !== true) { resumeRef.current = true; setConsentOpen(true); return }
    const text = (submitted?.text || draft).trim(), controller = new AbortController()
    requestRef.current = controller; setBusy(true); setError(''); setPending(text); setDraft(''); setStreamText(''); setStatusText('Looking through your workspace…')
    let active = conversation, acceptedMessageId
    try {
      if (!active) {
        const { data } = await api.post('/trace/conversations', {}, { signal: controller.signal })
        active = data.conversation; setConversation(active)
        setParams((previous) => { const next = new URLSearchParams(previous); next.set('chat', active.id); return next }, { replace: true })
      }
      const last = active.messages.at(-1)
      const retryMessageId = last?.role === 'user' && ['failed', 'cancelled'].includes(last.status) && last.content === text ? last._id : undefined
      const data = await sendTraceMessage(api.defaults.baseURL, active.id, { content: text, responseDetail: responseDetailRef.current, ...(retryMessageId ? { retryMessageId } : {}) }, controller.signal, (event, data) => {
        if (event === 'delta') setStreamText((previous) => previous + data.text)
        if (event === 'status') { setStatusText(data.text); if (data.messageId) acceptedMessageId = data.messageId; if (data.resetText) setStreamText('') }
      })
      setConversation(data.conversation); setConfigured(true)
      setHistory((items) => [{ id: data.conversation.id, title: data.conversation.title, updatedAt: data.conversation.updatedAt }, ...items.filter((item) => item.id !== data.conversation.id)].slice(0, 50))
      const actions = data.conversation.messages.at(-1)?.actions
      if (actions?.length) await openAction(actions.at(-1), false, active.id)
    } catch (error) {
      if (active) {
        try {
          const { data } = await api.get(`/trace/conversations/${active.id}`)
          setConversation(data.conversation)
          const index = data.conversation.messages.findIndex((message) => message._id === acceptedMessageId)
          if (index >= 0 && data.conversation.messages[index].status === 'completed' && data.conversation.messages[index + 1]?.role === 'assistant') {
            setDraft(''); setError('The stream was interrupted, but your completed answer was saved and has been restored.')
            setHistory((items) => [{ id: data.conversation.id, title: data.conversation.title, updatedAt: data.conversation.updatedAt }, ...items.filter((item) => item.id !== data.conversation.id)].slice(0, 50))
            return
          }
        } catch { /* Keep the question ready to retry if reconciliation is unavailable. */ }
      }
      setDraft(text)
      setError(error.code === 'ERR_CANCELED' || error.name === 'AbortError' ? 'Response stopped. Your question is ready to send again.' : error.response?.data?.message || 'TRACE could not respond. Try again.')
      if (error.response?.data?.code === 'TRACE_NOT_CONFIGURED') setConfigured(false)
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); setPending(''); setStreamText(''); inputRef.current?.focus() } }
  }
  async function setConsent(enabled) {
    setConsentSaving(true)
    try {
      await api.put('/trace/consent', { enabled })
      setConsentEnabled(enabled); setConsentOpen(false)
      if (enabled && resumeRef.current) { resumeRef.current = false; await send(true) }
    } catch (error) { setError(error.response?.data?.message || 'AI processing preference could not be saved.') }
    finally { setConsentSaving(false) }
  }
  async function deleteChat(id) {
    if (!window.confirm('Delete this TRACE conversation and its saved messages? This cannot be undone.')) return
    try {
      await api.delete(`/trace/conversations/${id}`)
      setHistory((items) => items.filter((item) => item.id !== id))
      if (conversation?.id === id) newChat()
    } catch (error) { setError(error.response?.data?.message || 'Conversation could not be deleted.') }
  }
  async function copy(message) {
    try { await navigator.clipboard.writeText(message.content); setCopied(message._id); setTimeout(() => setCopied(''), 1800) } catch { setError('Copy unavailable. Select the message text to copy it.') }
  }
  return <div className={`trace-workspace ${previewOpen ? 'has-preview' : ''} ${chatting ? 'is-conversation' : 'is-hero'} mobile-${mobileTab}`}>
    <main className="trace-chat" ref={chatRef} aria-label="TRACE assistant">
      <header className="trace-topbar"><button className="trace-mini-brand" onClick={newChat} disabled={busy} type="button" aria-label="Return to TRACE hero">TRACE<span> / OwnTrace</span></button><div><button type="button" onClick={() => { resumeRef.current = false; setConsentOpen(true) }}>AI processing</button><button type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} aria-controls="trace-history">History</button><button type="button" disabled={busy} onClick={newChat}>＋ New chat</button>{!previewOpen ? <button type="button" onClick={() => navigate(withChat('/trace/view/dashboard'))}>Workspace ↗</button> : null}</div></header>
      {historyOpen ? <aside className="trace-history" ref={historyRef} id="trace-history" aria-label="Recent TRACE conversations"><header><strong>Your conversations</strong><button type="button" aria-label="Close conversation history" onClick={() => setHistoryOpen(false)}>×</button></header><p>Saved privately to your OwnTrace account.</p>{history.length ? <ul>{history.map((item) => <li key={item.id}><button type="button" disabled={busy} onClick={() => { setHistoryOpen(false); setDraft(''); setConversation(null); navigate(`/trace?chat=${item.id}`) }}>{item.title}<small>{new Date(item.updatedAt).toLocaleDateString()}</small></button><button type="button" disabled={busy} aria-label={`Delete conversation: ${item.title}`} onClick={() => deleteChat(item.id)}>×</button></li>)}</ul> : <p>No saved conversations yet.</p>}</aside> : null}
      {!chatting ? <div className="trace-hero"><TraceGlow onPosition={positionHeroComposer} /><p>Your digital life. In a clearer light.</p><span>Ask about your accounts, subscriptions and privacy.</span></div> : <div className="trace-thread" role="log" aria-label="Conversation with TRACE" aria-live="polite" aria-relevant="additions" ref={threadRef}>{conversation?.messages.map((message) => <article className={`trace-message is-${message.role}`} key={message._id}><strong className="trace-message-author">{message.role === 'assistant' ? 'TRACE' : 'You'}</strong><div className="trace-message-body">{message.role === "assistant" ? <TraceText content={message.content} /> : message.content}</div>{message.status === 'failed' || message.status === 'cancelled' ? <small className="trace-turn-status">Response {message.status}. Send again to retry.</small> : null}{message.sources?.length ? <div className="trace-sources" aria-label="Supporting OwnTrace sources">{message.sources.map((source, index) => <button type="button" key={index} onClick={() => openAction(source.action)}>↗ {source.label}</button>)}</div> : null}{message.actions?.length ? <div className="trace-message-actions">{message.actions.map((action, index) => <button type="button" key={index} onClick={() => openAction(action)}>Open live view ↗</button>)}</div> : null}<button type="button" className="trace-copy" onClick={() => copy(message)} aria-label={copied === message._id ? 'Message copied' : `Copy ${message.role} message`} title={copied === message._id ? 'Copied' : 'Copy message'}><TraceKitIcon name={copied === message._id ? 'check' : 'copy'} /></button></article>)}{pending ? <article className="trace-message is-user"><strong className="trace-message-author">You</strong><div className="trace-message-body">{pending}</div></article> : null}{streamText ? <article className="trace-message is-assistant"><strong className="trace-message-author">TRACE</strong><div className="trace-message-body"><TraceText content={streamText} /></div></article> : null}{busy ? <div className="trace-thinking" role="status"><span aria-hidden="true" /><span>{statusText}</span></div> : null}</div>}
      {loading ? <p className="trace-notice" role="status">Loading your conversation…</p> : null}
      <div className="trace-composer-position"><motion.div layout="position" transition={{ duration: reducedMotion ? 0 : .62, ease: [.22, 1, .36, 1] }} className="trace-composer-area">{error ? <p className="trace-error" role="alert">{error}</p> : null}{configured === false ? <p className="trace-notice">TRACE’s {providerLabel} connection is not configured yet. Your live workspace is available.</p> : null}<TraceComposer draft={draft} setDraft={setDraft} send={send} busy={busy || loading} stop={() => requestRef.current?.abort()} inputRef={inputRef} onOpenWorkspace={() => navigate(withChat('/trace/view/dashboard'))} onError={setError} onResponseDetail={(detail) => { responseDetailRef.current = detail }} />{!chatting ? <div className="trace-prompts">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => { setDraft(prompt); inputRef.current?.focus() }}>{prompt} <span aria-hidden="true">↗</span></button>)}</div> : null}</motion.div></div>
      <footer className="trace-dock"><button type="button" disabled={busy} onClick={newChat} aria-label="New TRACE conversation"><TraceKitIcon name="square-pen" /><small>New chat</small></button><span className="trace-avatar" aria-label={user?.name || 'Your account'}>{user?.name?.slice(0, 1).toUpperCase() || 'T'}</span><button type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-label="Open recent TRACE conversations"><TraceKitIcon name="rotate-ccw" /><small>Recent chats</small></button></footer>
    </main>
    <dialog className="trace-consent-dialog" ref={consentRef} onCancel={() => { resumeRef.current = false; setConsentOpen(false) }} aria-labelledby="trace-consent-title">
      <h2 id="trace-consent-title">Your workspace, with {providerLabel}</h2><p>TRACE uses {providerLabel}. Your question and recent conversation context go to the conversation provider for answers. When needed, TRACE retrieves minimized derived records from your OwnTrace workspace; it does not send raw email bodies, attachments, mailbox credentials or connection tokens.</p><p>AI provider processing and retention depend on the deployment configuration; this does not promise zero retention.</p><p>Your chats and source references are saved privately in OwnTrace. You can disable future AI processing here and delete saved chats from History.</p><div>{consentEnabled ? <button type="button" disabled={consentSaving} onClick={() => setConsent(false)}>Disable AI processing</button> : <button type="button" disabled={consentSaving} onClick={() => setConsent(true)}>{consentSaving ? 'Saving…' : `Enable TRACE with ${providerLabel}`}</button>}<button type="button" disabled={consentSaving} onClick={() => { resumeRef.current = false; setConsentOpen(false) }}>{consentEnabled ? 'Close' : 'Not now'}</button></div>
    </dialog>
    {previewOpen ? <TracePreview close={closePreview} /> : null}
    {previewOpen ? <nav className="trace-mobile-tabs" aria-label="TRACE mobile view"><button type="button" aria-pressed={mobileTab === 'chat'} onClick={() => setMobileTab('chat')}>Conversation</button><button type="button" aria-pressed={mobileTab === 'preview'} onClick={() => setMobileTab('preview')}>Live workspace</button></nav> : null}
    
  </div>
}
export default TracePage
