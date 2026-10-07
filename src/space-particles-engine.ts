type SpaceParticle = {
  x: number
  y: number
  homeX: number
  homeY: number
  velocityX: number
  velocityY: number
  radius: number
  alpha: number
  color: string
  phase: number
  depth: number
}

const TAU = Math.PI * 2
const STAR_COLORS = ['#ffffff', '#dce7ff', '#91cfff', '#b5a7ff', '#ffb9dc', '#ffd8a3']

function randomBetween(minimum: number, maximum: number) {
  return minimum + Math.random() * (maximum - minimum)
}

export function createSpaceParticles(canvas: HTMLCanvasElement | OffscreenCanvas, onFirstFrame?: () => void, onFrame?: () => boolean) {
  // Prebaked glows avoid per-star filters and keep GPU Canvas acceleration.
  const context = canvas.getContext('2d', { alpha:false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas is unavailable')

  const particles: SpaceParticle[] = []
  // Bake the original circle + shadowBlur drawing verbatim, rather than
  // substituting radial gradients. Reuse it for every animation frame.
  const sprites=new Map<string,HTMLCanvasElement|OffscreenCanvas>()
  const starSprite=(color:string,radius:number,gathering:boolean)=>{
    const r=Math.round(radius*8)/8,key=`${color}:${r}:${gathering}`
    let sprite=sprites.get(key);if(sprite)return sprite
    const blur=r*(gathering?8:5),padding=Math.ceil(blur*4+r*1.16+2),size=padding*2
    sprite=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(size*2,size*2):document.createElement('canvas');sprite.width=sprite.height=size*2
    const c=sprite.getContext('2d') as CanvasRenderingContext2D;c.scale(2,2);c.fillStyle=color;c.shadowColor=color;c.shadowBlur=blur*2;c.beginPath();c.arc(padding,padding,r*(gathering?1.16:1),0,TAU);c.fill();sprites.set(key,sprite);return sprite
  }
  let width = 1
  let height = 1
  let pixelRatio = 1
  let pointerX = 0
  let pointerY = 0
  let isGathering = false
  let disposed = false
  let visible = true
  let animationFrameId = 0
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  let previousTime = performance.now()
  let explosionGlow = 0
  const backgrounds: Array<CanvasGradient | undefined> = []
  let nebulaGradient: CanvasGradient | undefined

  const createGalaxyParticle = (index: number, count: number): SpaceParticle => {
    const centerX = width * 0.5
    const centerY = height * 0.5
    const galaxyParticle = index < count * 0.78
    let homeX: number
    let homeY: number
    let depth: number

    if (galaxyParticle) {
      const radiusRatio = Math.pow(Math.random(), 1.7)
      const galaxyRadius = Math.min(width * 0.44, height * 0.68)
      const radius = radiusRatio * galaxyRadius
      const arm = index % 3
      const angle = radiusRatio * 8.5 + arm * TAU / 3 + randomBetween(-0.72, 0.72)
      const thickness = (1 - radiusRatio * 0.65) * randomBetween(-42, 42)
      homeX = centerX + Math.cos(angle) * radius * 1.55 + Math.cos(angle + Math.PI / 2) * thickness
      homeY = centerY + Math.sin(angle) * radius * 0.48 + Math.sin(angle + Math.PI / 2) * thickness * 0.45
      depth = 1 - radiusRatio * 0.62
    } else {
      homeX = Math.random() * width
      homeY = Math.random() * height
      depth = randomBetween(0.28, 0.72)
    }

    return {
      x: homeX,
      y: homeY,
      homeX,
      homeY,
      velocityX: randomBetween(-2, 2),
      velocityY: randomBetween(-2, 2),
      radius: randomBetween(0.45, 1.45) + depth * 0.9,
      alpha: randomBetween(0.36, 0.82) + depth * 0.16,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      phase: Math.random() * TAU,
      depth,
    }
  }

  const rebuildGalaxy = () => {
    const count = Math.max(720, Math.min(1800, Math.round(width * height / 720)))
    particles.length = 0
    for (let index = 0; index < count; index += 1){const p=createGalaxyParticle(index,count);particles.push(p);starSprite(p.color,p.radius,false);starSprite(p.color,p.radius,true)}
  }

  const resize = (nextWidth: number, nextHeight: number, ratio: number) => {
    if (particles.length && width === nextWidth && height === nextHeight && pixelRatio === Math.min(ratio || 1,2,2560/Math.max(nextWidth,nextHeight))) return
    width = Math.max(1, nextWidth)
    height = Math.max(1, nextHeight)
    pixelRatio = Math.min(ratio || 1, 2,2560/Math.max(width,height))
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    backgrounds.length = 0
    nebulaGradient = undefined
    if (!pointerX && !pointerY) {
      pointerX = width / 2
      pointerY = height / 2
    }
    rebuildGalaxy()
  }

  const gather = (x: number, y: number) => {
    pointerX = x; pointerY = y
    isGathering = true
    explosionGlow = 0
  }

  const movePointer = (x: number, y: number) => {
    if (isGathering) { pointerX = x; pointerY = y }
  }

  const explode = (x: number, y: number) => {
    if (!isGathering) return
    pointerX = x; pointerY = y
    isGathering = false
    explosionGlow = 1
    particles.forEach((particle) => {
      const deltaX = particle.x - pointerX
      const deltaY = particle.y - pointerY
      const distance = Math.hypot(deltaX, deltaY) || 1
      const power = randomBetween(260, 720) * (0.72 + particle.depth * 0.4)
      particle.velocityX = deltaX / distance * power + randomBetween(-65, 65)
      particle.velocityY = deltaY / distance * power + randomBetween(-65, 65)
    })
  }

  const update = (deltaTime: number) => {
    explosionGlow = Math.max(0, explosionGlow - deltaTime * 1.1)
    const damping = Math.pow(isGathering ? 0.88 : 0.976, deltaTime * 60)
    particles.forEach((particle) => {
      if (isGathering) {
        const deltaX = pointerX - particle.x
        const deltaY = pointerY - particle.y
        const distance = Math.hypot(deltaX, deltaY) || 1
        const attraction = Math.min(2200, 30000 / Math.sqrt(distance + 5))
        const swirl = Math.min(250, distance * 0.5)
        particle.velocityX += (deltaX / distance * attraction - deltaY / distance * swirl) * deltaTime
        particle.velocityY += (deltaY / distance * attraction + deltaX / distance * swirl) * deltaTime
        particle.velocityX *= damping
        particle.velocityY *= damping
      } else {
        particle.velocityX += (particle.homeX - particle.x) * 2.15 * deltaTime
        particle.velocityY += (particle.homeY - particle.y) * 2.15 * deltaTime
        particle.velocityX *= damping
        particle.velocityY *= damping
      }
      particle.x += particle.velocityX * deltaTime
      particle.y += particle.velocityY * deltaTime
      particle.phase += deltaTime * (1.1 + particle.depth * 1.7)
    })
  }

  const drawNebula = () => {
    const mode = isGathering ? 1 : 0
    let background = backgrounds[mode]
    if (!background) {
      background = context.createRadialGradient(width * 0.5, height * 0.48, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.78)
      background.addColorStop(0, isGathering ? '#16143b' : '#111833')
      background.addColorStop(0.48, '#080d20')
      background.addColorStop(1, '#02040b')
      backgrounds[mode] = background
    }
    context.fillStyle = background
    context.fillRect(0, 0, width, height)

    context.save()
    context.translate(width * 0.5, height * 0.5)
    context.rotate(-0.18)
    context.scale(1.7, 0.5)
    let nebula = nebulaGradient
    if (!nebula) {
      nebula = context.createRadialGradient(0, 0, 0, 0, 0, Math.min(width, height) * 0.42)
      nebula.addColorStop(0, 'rgba(210, 225, 255, 0.2)')
      nebula.addColorStop(0.18, 'rgba(104, 159, 255, 0.15)')
      nebula.addColorStop(0.52, 'rgba(116, 75, 190, 0.08)')
      nebula.addColorStop(1, 'rgba(30, 20, 80, 0)')
      nebulaGradient = nebula
    }
    context.fillStyle = nebula
    context.beginPath()
    context.arc(0, 0, Math.min(width, height) * 0.42, 0, TAU)
    context.fill()
    context.restore()
  }

  const draw = () => {
    drawNebula()
    context.globalCompositeOperation = 'screen'

    if (isGathering || explosionGlow > 0) {
      const glowRadius = isGathering ? 145 : 100 + (1 - explosionGlow) * 380
      const glow = context.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, glowRadius)
      glow.addColorStop(0, `rgba(220, 232, 255, ${isGathering ? 0.35 : explosionGlow * 0.3})`)
      glow.addColorStop(0.38, `rgba(105, 135, 255, ${isGathering ? 0.16 : explosionGlow * 0.13})`)
      glow.addColorStop(1, 'rgba(60, 80, 210, 0)')
      context.fillStyle = glow
      context.beginPath()
      context.arc(pointerX, pointerY, glowRadius, 0, TAU)
      context.fill()
    }

    particles.forEach((particle) => {
      // Cull offscreen sprites before compositing cached glow textures.
      const blur = particle.radius * (isGathering ? 8 : 5)
      const padding = Math.ceil(blur * 4 + particle.radius * 1.16 + 2)
      const left = Math.floor(particle.x - padding), top = Math.floor(particle.y - padding)
      if (left > width || top > height || left + padding * 2 + 2 < 0 || top + padding * 2 + 2 < 0) return
      const twinkle = 0.72 + Math.sin(particle.phase) * 0.28
      context.globalAlpha = particle.alpha * twinkle
      const sprite=starSprite(particle.color,particle.radius,isGathering),size=sprite.width/2
      context.drawImage(sprite,particle.x-size/2,particle.y-size/2,size,size)
    })
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.shadowBlur = 0
  }

  const render = (time: number) => {
    if (disposed || !visible) { animationFrameId = 0; return }
    const deltaTime = Math.min(0.033, (time - previousTime) / 1000)
    previousTime = time
    update(deltaTime)
    draw()
    if (onFirstFrame) { const ready = onFirstFrame; onFirstFrame = undefined; ready() }
    if (onFrame?.() === false) { animationFrameId = 0; return }
    animationFrameId = requestAnimationFrame(render)
  }

  const setVisible = (next: boolean) => {
    visible = next
    if (!visible) { clearTimeout(frameTimer); cancelAnimationFrame(animationFrameId); animationFrameId = 0 }
    else if (!disposed && !animationFrameId) { previousTime = performance.now(); animationFrameId = requestAnimationFrame(render) }
  }
  const requestFrame = () => { if (!disposed && visible && !animationFrameId) animationFrameId = requestAnimationFrame(render) }
  return { resize, gather, movePointer, explode, setVisible, requestFrame, dispose: () => { disposed = true; clearTimeout(frameTimer); cancelAnimationFrame(animationFrameId) } }
}
