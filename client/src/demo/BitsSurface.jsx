import { useReducedMotion } from 'motion/react'
import { useContext } from 'react'
import { EmbeddedWorkspaceContext } from '../features/workspace/workspace-navigation.jsx'
import AnimatedContent from './react-bits/AnimatedContent.jsx'
import CountUp from './react-bits/CountUp.jsx'

export function BitsSurface({ children, className = '', delay = 0 }) {
  const reduced = useReducedMotion()
  const embedded = useContext(EmbeddedWorkspaceContext)
  return reduced ? <div className={className}>{children}</div> : <AnimatedContent container={embedded ? '.trace-preview-content' : undefined} className={className} distance={14} duration={0.45} delay={delay} threshold={0.02} ease="power2.out">{children}</AnimatedContent>
}

export function MetricNumber({ value, currency = false }) {
  const reduced = useReducedMotion()
  const number = Number(value.toFixed(currency ? 2 : 0))
  const label = new Intl.NumberFormat('en-US', currency ? { style: 'currency', currency: 'USD' } : {}).format(number)
  return <span aria-label={label}><span aria-hidden="true">{currency ? '$' : ''}{reduced ? new Intl.NumberFormat('en-US', { minimumFractionDigits: currency ? 2 : 0, maximumFractionDigits: currency ? 2 : 0 }).format(number) : <CountUp to={number} duration={0.9} decimals={currency ? 2 : 0} />}</span></span>
}
