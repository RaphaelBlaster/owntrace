import { useEffect, useRef } from 'react'
import './prototype/pro-glow.js'

// Original supplied renderer and font, hosted by React rather than standalone HTML.
function TraceGlow({ onPosition }) {
  const glowRef = useRef(null)
  useEffect(() => {
    const glow = glowRef.current
    const rendered = () => {
      glow.dataset.ready = 'true'
      const bounds = glow.getTextBounds()
      if (bounds) onPosition(bounds)
    }
    glow.addEventListener('glow-render', rendered)
    const observer = new ResizeObserver(() => { if (glow.getTextBounds()) rendered() })
    observer.observe(glow)
    return () => { glow.removeEventListener('glow-render', rendered); observer.disconnect() }
  }, [onPosition])
  return <h1 className="trace-kit-wordmark" aria-label="TRACE"><pro-glow ref={glowRef} text="TRACE" intensity="1.06" aria-hidden="true" /></h1>
}
export default TraceGlow
