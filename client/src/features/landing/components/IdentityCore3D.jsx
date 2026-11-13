import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function IdentityCore3D() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let renderer

    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    } catch {
      canvas.closest('.identity-core-shell')?.classList.add('has-webgl-fallback')
      return undefined
    }

    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(0, 0.1, 6.75)

    const identityGroup = new THREE.Group()
    identityGroup.rotation.set(-0.16, -0.3, 0.08)
    scene.add(identityGroup)

    const shieldShape = new THREE.Shape()
    shieldShape.moveTo(0, 1.55)
    shieldShape.lineTo(1.08, 1.12)
    shieldShape.lineTo(0.94, -0.3)
    shieldShape.quadraticCurveTo(0.72, -1.05, 0, -1.48)
    shieldShape.quadraticCurveTo(-0.72, -1.05, -0.94, -0.3)
    shieldShape.lineTo(-1.08, 1.12)
    shieldShape.closePath()
    const coreGeometry = new THREE.ExtrudeGeometry(shieldShape, {
      depth: 0.34,
      bevelEnabled: true,
      bevelSegments: 5,
      bevelSize: 0.075,
      bevelThickness: 0.08,
      curveSegments: 16,
    })
    coreGeometry.center()
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x151b2d,
      emissive: 0x172460,
      emissiveIntensity: 0.25,
      metalness: 0.72,
      roughness: 0.22,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
      flatShading: false,
    })
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.scale.setScalar(0.64)
    identityGroup.add(core)

    const shieldEdgesGeometry = new THREE.EdgesGeometry(coreGeometry, 28)
    const shieldEdgesMaterial = new THREE.LineBasicMaterial({ color: 0x7890ff, transparent: true, opacity: 0.48 })
    const shieldEdges = new THREE.LineSegments(shieldEdgesGeometry, shieldEdgesMaterial)
    shieldEdges.position.z = 0.01
    core.add(shieldEdges)

    const privateGeometry = new THREE.SphereGeometry(0.22, 32, 32)
    const privateMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xb9f66b,
      emissive: 0x6aa72d,
      emissiveIntensity: 0.32,
      metalness: 0.15,
      roughness: 0.28,
      transmission: 0.08,
    })
    const privateCore = new THREE.Mesh(privateGeometry, privateMaterial)
    privateCore.position.set(0, 0.08, 0.34)
    identityGroup.add(privateCore)

    const identityLabelCanvas = document.createElement('canvas')
    identityLabelCanvas.width = 512
    identityLabelCanvas.height = 180
    const identityLabelContext = identityLabelCanvas.getContext('2d')
    identityLabelContext.textAlign = 'center'
    identityLabelContext.lineWidth = 8
    identityLabelContext.strokeStyle = 'rgba(0, 0, 0, 0.82)'
    identityLabelContext.fillStyle = '#b9f66b'
    identityLabelContext.font = '700 46px Arial'
    identityLabelContext.strokeText('YOUR IDENTITY', 256, 76)
    identityLabelContext.fillText('YOUR IDENTITY', 256, 76)
    identityLabelContext.fillStyle = '#ffffff'
    identityLabelContext.font = '400 22px Arial'
    identityLabelContext.strokeText('evidence in context', 256, 120)
    identityLabelContext.fillText('evidence in context', 256, 120)
    const identityLabelTexture = new THREE.CanvasTexture(identityLabelCanvas)
    identityLabelTexture.colorSpace = THREE.SRGBColorSpace
    identityLabelTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
    const identityLabelMaterial = new THREE.SpriteMaterial({ map: identityLabelTexture, transparent: true, depthTest: false })
    const identityLabel = new THREE.Sprite(identityLabelMaterial)
    identityLabel.position.set(0, 0.08, 0.5)
    identityLabel.scale.set(1.22, 0.43, 1)
    identityGroup.add(identityLabel)

    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x6680ff, emissive: 0x263c9e, emissiveIntensity: 0.3, metalness: 0.58, roughness: 0.34 })
    const ringGeometry = new THREE.TorusGeometry(1.72, 0.018, 12, 128)
    const ringOne = new THREE.Mesh(ringGeometry, ringMaterial)
    ringOne.rotation.set(1.1, 0.2, 0.42)
    identityGroup.add(ringOne)

    const ringTwo = new THREE.Mesh(ringGeometry, ringMaterial)
    ringTwo.scale.setScalar(1.12)
    ringTwo.rotation.set(0.2, 1.15, -0.36)
    identityGroup.add(ringTwo)

    const nodeGeometry = new THREE.SphereGeometry(0.085, 16, 16)
    const nodeMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x405cf5, emissive: 0x172b91, emissiveIntensity: 0.5, metalness: 0.35, roughness: 0.28 }),
      new THREE.MeshStandardMaterial({ color: 0xb9f66b, emissive: 0x426d18, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0xf7f9ff, metalness: 0.42, roughness: 0.25 }),
    ]
    const nodePositions = [[1.62, 0.78, 0.5], [-1.62, -0.52, 0.42], [0.58, -1.65, 0.58], [-0.74, 1.62, -0.22]]
    const accountLabels = [
      ['ACCOUNTS', 'Identity inventory', '#405cf5'],
      ['SUBSCRIPTIONS', 'Recurring clues', '#79b83e'],
      ['BREACH REPORTS', 'Exposure record', '#f6a825'],
      ['PRIVACY ACTIONS', 'Review queue', '#38c6ec'],
    ]
    const accountCardGeometry = new THREE.BoxGeometry(1.16, 0.62, 0.08)
    const accountFaceGeometry = new THREE.PlaneGeometry(1.08, 0.54)
    const accountCardMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f7fb, metalness: 0.12, roughness: 0.38 })
    const accountTextures = []
    const accountFaceMaterials = []
    const connectorGeometries = []
    const connectorMaterial = new THREE.LineBasicMaterial({ color: 0xd8e0ff, transparent: true, opacity: 0.38 })
    const flowGeometry = new THREE.SphereGeometry(0.045, 12, 12)
    const flowMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x79dcff, emissiveIntensity: 1.2, roughness: 0.24 })
    const flowTarget = new THREE.Vector3(0, 0.08, 0.12)
    const flowPackets = []
    nodePositions.forEach((position, index) => {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterials[index % nodeMaterials.length])
      node.position.set(...position)
      identityGroup.add(node)

      const [label, detail, accent] = accountLabels[index]
      const labelCanvas = document.createElement('canvas')
      labelCanvas.width = 512
      labelCanvas.height = 256
      const context = labelCanvas.getContext('2d')
      context.fillStyle = '#f7f9fc'
      context.fillRect(0, 0, labelCanvas.width, labelCanvas.height)
      context.fillStyle = accent
      context.beginPath()
      context.arc(52, 62, 15, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#111522'
      context.font = '700 33px Arial'
      context.fillText(label, 88, 73)
      context.fillStyle = '#687285'
      context.font = '400 25px Arial'
      context.fillText(detail, 40, 148)
      context.fillStyle = '#dfe4ec'
      context.fillRect(40, 186, 300, 9)
      context.fillStyle = accent
      context.fillRect(40, 186, 112 + index * 36, 9)

      const texture = new THREE.CanvasTexture(labelCanvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = true
      texture.premultiplyAlpha = false
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
      accountTextures.push(texture)
      const faceMaterial = new THREE.MeshBasicMaterial({ map: texture })
      accountFaceMaterials.push(faceMaterial)

      const accountCard = new THREE.Group()
      const accountBody = new THREE.Mesh(accountCardGeometry, accountCardMaterial)
      const accountFace = new THREE.Mesh(accountFaceGeometry, faceMaterial)
      accountFace.position.z = 0.045
      accountCard.add(accountBody, accountFace)
      accountCard.position.set(...position)
      accountCard.rotation.set(index % 2 ? -0.08 : 0.08, index % 2 ? -0.28 : 0.28, (index - 1.5) * 0.08)
      identityGroup.add(accountCard)

      const connectorGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.08, 0.12),
        new THREE.Vector3(...position),
      ])
      connectorGeometries.push(connectorGeometry)
      identityGroup.add(new THREE.Line(connectorGeometry, connectorMaterial))

      const packet = new THREE.Mesh(flowGeometry, flowMaterial)
      const start = new THREE.Vector3(...position)
      packet.position.copy(start)
      identityGroup.add(packet)
      flowPackets.push({ mesh: packet, phase: index / nodePositions.length, start })
    })

    scene.add(new THREE.HemisphereLight(0xf7f9ff, 0x1b2340, 1.35))
    const key = new THREE.DirectionalLight(0xffffff, 3.4)
    key.position.set(3.5, 4.2, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x6d84ff, 2.1)
    rim.position.set(-4, 0.8, -2.8)
    scene.add(rim)
    const signal = new THREE.PointLight(0xb9f66b, 5, 5)
    signal.position.set(1.1, -0.2, 2.2)
    scene.add(signal)

    let frameId = 0
    let isVisible = true
    let pointerX = 0
    let pointerY = 0
    let currentX = 0
    let currentY = 0
    let dragX = 0
    let dragY = 0
    let dragging = false
    let lastPointerX = 0
    let lastPointerY = 0

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    const render = (time = 0) => {
      const seconds = time * 0.001
      currentX += (pointerX - currentX) * 0.035
      currentY += (pointerY - currentY) * 0.035
      identityGroup.rotation.y = -0.3 + dragX + currentX * 0.12 + (reducedMotion.matches ? 0 : seconds * 0.07)
      identityGroup.rotation.x = -0.16 + dragY + currentY * 0.08
      identityGroup.position.y = reducedMotion.matches ? 0 : Math.sin(seconds * 0.65) * 0.055
      ringOne.rotation.z += reducedMotion.matches ? 0 : 0.0012
      ringTwo.rotation.x += reducedMotion.matches ? 0 : 0.0008
      flowPackets.forEach(({ mesh, phase, start }) => {
        const progress = reducedMotion.matches ? phase : (seconds * 0.2 + phase) % 1
        const eased = progress * progress * (3 - 2 * progress)
        mesh.position.lerpVectors(start, flowTarget, eased)
        mesh.scale.setScalar(0.65 + Math.sin(progress * Math.PI) * 0.7)
      })
      renderer.render(scene, camera)
      if (isVisible && !document.hidden && !reducedMotion.matches) frameId = requestAnimationFrame(render)
    }

    const restart = () => {
      cancelAnimationFrame(frameId)
      resize()
      render()
    }

    const handlePointer = (event) => {
      const bounds = canvas.getBoundingClientRect()
      pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
      pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
      if (dragging) {
        dragX += (event.clientX - lastPointerX) / bounds.width * 1.8
        dragY += (event.clientY - lastPointerY) / bounds.height * 1.2
        dragX = Math.max(-0.62, Math.min(0.62, dragX))
        dragY = Math.max(-0.45, Math.min(0.45, dragY))
        lastPointerX = event.clientX
        lastPointerY = event.clientY
      }
    }

    const handlePointerDown = (event) => {
      dragging = true
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      canvas.setPointerCapture?.(event.pointerId)
      canvas.classList.add('is-dragging')
    }

    const handlePointerUp = (event) => {
      dragging = false
      canvas.releasePointerCapture?.(event.pointerId)
      canvas.classList.remove('is-dragging')
    }

    const handleVisibility = () => {
      if (!document.hidden && isVisible) restart()
      else cancelAnimationFrame(frameId)
    }

    const resizeObserver = new ResizeObserver(restart)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting
      if (isVisible) restart()
      else cancelAnimationFrame(frameId)
    }, { rootMargin: '100px' })

    resizeObserver.observe(canvas)
    intersectionObserver.observe(canvas)
    canvas.addEventListener('pointermove', handlePointer, { passive: true })
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerUp)
    document.addEventListener('visibilitychange', handleVisibility)
    reducedMotion.addEventListener('change', restart)
    restart()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      canvas.removeEventListener('pointermove', handlePointer)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerUp)
      document.removeEventListener('visibilitychange', handleVisibility)
      reducedMotion.removeEventListener('change', restart)
      coreGeometry.dispose()
      shieldEdgesGeometry.dispose()
      privateGeometry.dispose()
      ringGeometry.dispose()
      nodeGeometry.dispose()
      accountCardGeometry.dispose()
      accountFaceGeometry.dispose()
      flowGeometry.dispose()
      coreMaterial.dispose()
      shieldEdgesMaterial.dispose()
      privateMaterial.dispose()
      identityLabelTexture.dispose()
      identityLabelMaterial.dispose()
      ringMaterial.dispose()
      nodeMaterials.forEach((material) => material.dispose())
      accountCardMaterial.dispose()
      accountTextures.forEach((texture) => texture.dispose())
      accountFaceMaterials.forEach((material) => material.dispose())
      connectorGeometries.forEach((geometry) => geometry.dispose())
      connectorMaterial.dispose()
      flowMaterial.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div className="identity-core-shell" aria-hidden="true">
      <canvas className="identity-core-canvas" ref={canvasRef} />
      <span className="identity-core-fallback"><i /></span>
    </div>
  )
}

export default IdentityCore3D
