import { useState } from 'react'
import { useDemo } from './context.js'
import { ActionButton, Icon, Modal, ServiceIcon, Tag } from './components.jsx'
import StatusMark from './react-bits/StatusMark.jsx'

export default function GuidedReview({ action, onClose }) {
  const { accounts, setActions, checks, setChecks, setToast } = useDemo()
  const account = accounts.find(account => account.id === action.accountId)
  const [stage, setStage] = useState(action.state === 'Done' ? 2 : 0)
  const [decision, setDecision] = useState(action.decision || '')
  const completed = checks[action.id] || []
  const outcomes = action.category === 'Security' ? ['Protection reviewed'] : action.category === 'Subscriptions' ? ['Keep this plan', 'Revisit this plan'] : ['Keep this account', 'Archive after exporting']
  const done = action.state === 'Done'
  function finish() {
    setActions(current => current.map(item => item.id === action.id ? { ...item, state: 'Done', decision } : item))
    setStage(2)
    setToast('Decision saved in this demo. No external service was changed.')
  }
  return <Modal title={action.title} onClose={onClose} wide>
    <ol className="dx-review-progress" aria-label="Review progress">{['Understand', 'Decide', 'Recorded'].map((label, index) => <li key={label} className={stage >= index ? 'active' : ''} aria-current={stage === index ? 'step' : undefined}><span><StatusMark status={stage > index || (stage === 2 && index === 2) ? 'done' : 'pending'} color={stage >= index ? '#368aa4' : '#9aaab4'} doneColor="#368aa4" size={17} /></span>{label}</li>)}</ol>
    {stage === 0 ? <div className="dx-review-stage"><div className="dx-review-context"><div className="dx-account-name"><ServiceIcon account={account} /><div><strong>{account.name}</strong><span>{account.domain}</span></div></div><Tag tone={action.priority === 'High' ? 'red' : 'amber'}>{action.priority} priority</Tag></div><p className="dx-modal-description">{action.description}</p><div className="dx-review-evidence"><span><Icon name="mail" size={16} /> WHY THIS APPEARED</span><p>{action.reason}</p><small>{account.signals} sample signals · {account.source} · {account.confidence} evidence</small></div><div className="dx-info-box"><Icon name="info" size={17} /><p>This is a practice review using sample evidence. Your decision is saved only in this browser tab.</p></div><div className="dx-modal-footer"><ActionButton onClick={onClose}>Not now</ActionButton><ActionButton variant="primary" onClick={() => setStage(1)}>Review my options <Icon name="arrow" size={16} /></ActionButton></div></div> : null}
    {stage === 1 ? <div className="dx-review-stage"><h3 className="dx-modal-subtitle">A small checklist before your decision</h3><p className="dx-fine-print">Check each step to practice the flow. No external account changes are performed.</p><div className="dx-review-steps">{action.steps.map((step, index) => <label key={step} className={completed.includes(index) ? 'is-checked' : ''}><input type="checkbox" checked={completed.includes(index)} onChange={event => setChecks(current => ({ ...current, [action.id]: event.target.checked ? [...new Set([...completed, index])] : completed.filter(value => value !== index) }))} /><span><small>STEP {index + 1}</small><strong>{step}</strong></span></label>)}</div><fieldset className="dx-review-decisions"><legend>What would you like to record?</legend>{outcomes.map(outcome => <label className={decision === outcome ? 'selected' : ''} key={outcome}><input type="radio" name="review-decision" value={outcome} checked={decision === outcome} onChange={() => setDecision(outcome)} /><span>{outcome}</span></label>)}</fieldset><div className="dx-modal-footer"><ActionButton onClick={() => setStage(0)}>Back</ActionButton><span>{completed.length}/{action.steps.length} steps checked</span><ActionButton variant="primary" disabled={completed.length !== action.steps.length || !decision} onClick={finish}>Record decision <Icon name="check" size={16} /></ActionButton></div></div> : null}
    {stage === 2 ? <div className="dx-review-success" role="status"><span className="dx-success-symbol"><Icon name="check" size={30} /></span><p className="dx-kicker">REVIEW RECORDED</p><h3>One less loose end.</h3><p>{done ? action.decision || 'Your review is complete.' : decision}</p><div className="dx-info-box"><Icon name="lock" size={17} /><p>This records your decision in OwnTrace’s sample workspace. It does not cancel a plan, close an account, or verify external security.</p></div><div className="dx-modal-footer"><ActionButton onClick={onClose}>Back to workspace</ActionButton><ActionButton variant="primary" to="/demo/actions" onClick={onClose}>See my progress <Icon name="arrow" size={16} /></ActionButton></div></div> : null}
  </Modal>
}
