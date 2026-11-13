import { useEffect, useRef } from 'react'
import './prototype/chatgpt-pill.js'

function TraceComposer({ draft, setDraft, send, busy, stop, inputRef, onOpenWorkspace, onError, onResponseDetail }) {
  const pillRef = useRef(null), latest = useRef(null)
  latest.current = { setDraft, send, stop, onOpenWorkspace, onError, onResponseDetail }
  useEffect(() => {
    const pill = pillRef.current
    let active = true
    const change = (event) => { latest.current.setDraft(event.detail.text); latest.current.onResponseDetail?.(event.detail.detail) }
    const submit = (event) => latest.current.send(false, event.detail)
    const cancel = () => latest.current.stop()
    const error = (event) => latest.current.onError?.(String(event.detail))
    const workspace = (event) => { event.preventDefault(); event.stopImmediatePropagation(); latest.current.onOpenWorkspace?.() }
    pill.addEventListener('composer-change', change)
    pill.addEventListener('composer-submit', submit)
    pill.addEventListener('composer-stop', cancel)
    pill.addEventListener('composer-error', error)
    pill.ready.then(() => {
      if (!active) return
      pill.editor.setAttribute('aria-label', 'Ask about your OwnTrace workspace')
      pill.editor.maxLength = 8000
      inputRef.current = pill.editor
      const plus = pill.body.querySelector('[data-snapshot-node="11"]')
      if (plus) { plus.setAttribute('aria-label', 'Open live OwnTrace workspace'); plus.title = 'Open live OwnTrace workspace'; plus.addEventListener('click', workspace, true) }
      pill.fileInput.disabled = true
    }).catch(() => { if (active) latest.current.onError?.('The supplied TRACE composer could not load. Refresh to retry.') })
    return () => {
      active = false
      pill.removeEventListener('composer-change', change); pill.removeEventListener('composer-submit', submit)
      pill.removeEventListener('composer-stop', cancel); pill.removeEventListener('composer-error', error)
      pill.body?.querySelector('[data-snapshot-node="11"]')?.removeEventListener('click', workspace, true)
      if (inputRef.current === pill.editor) inputRef.current = null
    }
  }, [inputRef])
  useEffect(() => {
    const pill = pillRef.current
    let active = true
    pill.ready.then(() => {
      if (!active) return
      if (pill.value !== draft) pill.setDraft(draft, [], pill.detail?.value || 'high')
      pill.setBusy(busy)
    }).catch(() => {})
    return () => { active = false }
  }, [draft, busy])
  return <chatgpt-pill ref={pillRef} className="trace-original-pill" glass thin aria-label="Message TRACE" />
}
export default TraceComposer
