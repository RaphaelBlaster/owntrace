import { useEffect, useRef } from 'react'

// A procedural identity: layered ridges with a slow, breathing displacement.
export default function TraceField() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame,
      visible = true,
      width = 0,
      height = 0
    const pointer = { x: 0, y: 0 }
    const draw = (time = 0) => {
      ctx.clearRect(0, 0, width, height)
      const scale = Math.min(width / 660, height / 700)
      ctx.save()
      ctx.translate(width * 0.51 + pointer.x, height * 0.49 + pointer.y)
      ctx.rotate(-0.25)
      ctx.scale(scale, scale)
      const t = motion.matches ? 0 : time * 0.00025
      for (let ring = 0; ring < 64; ring++) {
        const radius = 23 + ring * 4.05
        ctx.beginPath()
        for (let j = 0; j <= 260; j++) {
          const a = (j / 260) * Math.PI * 2
          const wave = Math.sin(a * 3 + ring * 0.085 + t) * (8 + ring * 0.14)
          const r = radius + wave
          const x = Math.cos(a) * r * 0.8 + Math.sin(a * 2 + t) * 13
          const y = Math.sin(a) * r * 1.14
          if (j === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        const brightness = 0.28 + (0.48 * (1 + Math.cos(ring * 0.11 - t))) / 2
        ctx.strokeStyle = `rgba(199,246,117,${brightness})`
        ctx.lineWidth = ring % 7 === 0 ? 1.5 : 0.85
        ctx.stroke()
      }
      ctx.restore()
      if (visible && !motion.matches) frame = requestAnimationFrame(draw)
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cancelAnimationFrame(frame)
      draw()
    }
    const move = (event) => {
      if (motion.matches) return
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 14
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 14
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancelAnimationFrame(frame)
      if (visible) draw()
    })
    intersection.observe(canvas)
    motion.addEventListener('change', resize)
    canvas.addEventListener('pointermove', move)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      intersection.disconnect()
      motion.removeEventListener('change', resize)
      canvas.removeEventListener('pointermove', move)
    }
  }, [])
  return <canvas ref={canvasRef} className="trace-field" aria-hidden="true" />
}
