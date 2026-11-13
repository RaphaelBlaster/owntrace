import { useEffect, useRef, useState } from 'react'
import { useNavigate } from './prism-navigation.jsx'
import { useDemo } from './context.js'
import { Icon, Modal, ServiceIcon } from './components.jsx'
import api from '../services/api.js'
import { accountView } from '../features/workspace/prism-data.js'

const destinations = [
  { id: 'accounts', name: 'All accounts', detail: 'Explore your digital footprint', icon: 'accounts' },
  { id: 'subscriptions', name: 'Subscriptions', detail: 'Review costs and upcoming renewals', icon: 'wallet' },
  { id: 'actions', name: 'Action center', detail: 'Work through your recommendations', icon: 'check' },
  { id: 'connections', name: 'Connections', detail: 'Manage your sample inbox sources', icon: 'connect' },
  { id: 'security', name: 'Security', detail: 'Understand account risk signals', icon: 'shield' },
  { id: 'report', name: 'Privacy report', detail: 'Understand your illustrative score', icon: 'chart' },
  { id: 'settings', name: 'Settings', detail: 'Personalize or reset your workspace', icon: 'settings' },
]

export default function CommandPalette({ onClose }) {
  const { live, accounts } = useDemo()
  const [remote, setRemote] = useState([])
  const [searchError, setSearchError] = useState('')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef(null)
  const list = useRef(null)
  useEffect(() => { input.current?.focus() }, [])
  const term = query.trim().toLowerCase()
  useEffect(() => {
    if (!live || !term) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => api.get('/accounts', { params: { search:term.slice(0,80), limit:8, page:1 }, signal:controller.signal }).then(({data})=>{setRemote(data.accounts.map(account=>accountView(account)));setSearchError('')}).catch(error=>{if(!controller.signal.aborted)setSearchError(error.response?.data?.message || 'Account search could not load.')}), 160)
    return () => { clearTimeout(timer);controller.abort() }
  }, [live, term])
  const results = term
    ? [...(live ? remote : accounts).filter(account => `${account.name} ${account.domain}`.toLowerCase().includes(term)).map(account => ({ id: `account-${account.id}`, name: account.name, detail: `${account.domain} · View evidence`, account, path: `accounts/${account.id}` })), ...destinations.filter(item => `${item.name} ${item.detail}`.toLowerCase().includes(term)).map(item=>live?{...item,detail:item.detail.replace('sample ','').replace('illustrative ','').replace(' or reset','')}:item)].slice(0, 8)
    : destinations.slice(0, 4)
  const active = Math.min(selected, Math.max(0, results.length - 1))
  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: 'nearest' }) }, [active])
  function open(item) { onClose(); navigate(`/demo/${item.path || item.id}`) }
  function handleKey(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(results.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0)
    }
    if (event.key === 'Enter' && results[active]) { event.preventDefault(); open(results[active]) }
  }
  return <Modal title="Find your next step" onClose={onClose}>
    {searchError ? <p role="alert">{searchError}</p> : null}
    <div className="ot-command-input"><Icon name="search" /><input ref={input} role="combobox" aria-label="Search accounts and pages" aria-expanded="true" aria-autocomplete="list" aria-controls="ot-command-options" aria-activedescendant={results[active] ? `ot-command-${results[active].id}` : undefined} placeholder="Search an account or jump to a page…" value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} onKeyDown={handleKey} /></div>
    <div ref={list} className="ot-command-results" id="ot-command-options" role="listbox" aria-label={term ? 'Search results' : 'Suggested pages'}>{results.map((item, index) => <button type="button" role="option" aria-selected={active === index} id={`ot-command-${item.id}`} tabIndex={-1} className={active === index ? 'selected' : ''} key={item.id} onMouseMove={() => setSelected(index)} onClick={() => open(item)}>{item.account ? <ServiceIcon account={item.account} small /> : <Icon name={item.icon} />}<span><strong>{item.name}</strong><small>{item.detail}</small></span><Icon name="arrow" size={15} /></button>)}{!results.length ? <p className="ot-command-empty" role="status">No matches. Try an account name or “subscriptions”.</p> : null}</div>
    <div className="ot-command-hint"><span><kbd>↑ ↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>
  </Modal>
}
