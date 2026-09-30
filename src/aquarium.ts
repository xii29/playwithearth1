import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { createLuminousFishPainter } from './aquarium-fish'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const FACE_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`
const HAND_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const GAZE_ENTER = 0.34
const GAZE_EXIT = 0.2
const MOUTH_OPEN_ENTER = 0.3
const MOUTH_OPEN_EXIT = 0.16
const FACE_GRACE_MS = 520

type Gaze = 'neutral' | 'left' | 'right'
type Fish = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  hue: number
  accent: number
  phase: number
  depth: number
  kind: number
  scared: number
  nano: boolean
  school: number
  escaped: boolean
  escapeX: number
  escapeY: number
}
type Bubble = { x: number; y: number; radius: number; speed: number; drift: number; alpha: number }
type HandPoint = { x: number; y: number; lastSeen: number; phase: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const random = (min: number, max: number) => min + Math.random() * (max - min)

export function setupAquarium(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('#aquarium-canvas')!
  const context = canvas.getContext('2d', { alpha: false })
  const video = root.querySelector<HTMLVideoElement>('#aquarium-camera')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#aquarium-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#aquarium-status')!
  const gazeState = root.querySelector<HTMLElement>('#aquarium-gaze-state')!
  const leftMeter = root.querySelector<HTMLElement>('#aquarium-left-meter')!
  const rightMeter = root.querySelector<HTMLElement>('#aquarium-right-meter')!
  const leftValue = root.querySelector<HTMLOutputElement>('#aquarium-left-value')!
  const rightValue = root.querySelector<HTMLOutputElement>('#aquarium-right-value')!
  if (!context) return () => {}

  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  const faceInferenceInterval = 1000 / (lowPowerDevice ? 12 : 16)
  const handInferenceInterval = 1000 / (lowPowerDevice ? 14 : 18)
  const renderInterval = 1000 / (lowPowerDevice ? 30 : 60)

  let width = 1
  let height = 1
  let pixelRatio = 1
  const waterGradients: Array<CanvasGradient | undefined> = []
  let dreamGradient: CanvasGradient | undefined
  let floorGradient: CanvasGradient | undefined
  let animationFrame = 0
  let previousFrame = performance.now()
  let lastRenderedAt = -Infinity
  let stream: MediaStream | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let handLandmarker: HandLandmarker | null = null
  let starting = false
  let cameraActive = false
  let disposed = false
  let cameraRequest = 0
  let lastFaceVideoTime = -1
  let lastHandVideoTime = -1
  let lastFaceInferenceAt = -Infinity
  let lastHandInferenceAt = -Infinity
  let lastFaceAt = -Infinity
  let rawLeft = 0
  let rawRight = 0
  let rawJaw = 0
  let smoothLeft = 0
  let smoothRight = 0
  let smoothJaw = 0
  let gaze: Gaze = 'neutral'
  let mouthOpen = false
  let gathering = 0
  let handActive = false
  let visionPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null
  const fish: Fish[] = []
  const fishDrawOrder: Fish[] = []
  const bubbles: Bubble[] = []
  let hands: HandPoint[] = []
  const activeFingertips: HandPoint[] = []

  const say = (message: string) => { status.textContent = message }

  const makeFish = (index: number, nano = false, nanoCount = 0): Fish => {
    const school = nano ? Math.floor(index / 7) : -1
    const schoolCount = Math.max(1, Math.ceil(nanoCount / 7))
    const direction = nano ? (school % 2 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1
    const palette = [16, 39, 171, 193, 211, 323]
    return {
      x: nano ? width * ((school + .5) / schoolCount) + random(-width * .055, width * .055) : random(0, width),
      y: nano ? height * (.28 + (school % 3) * .18) + random(-32, 32) : random(height * 0.2, height * 0.82),
      vx: direction * (nano ? random(36, 64) : random(16, 40)),
      vy: random(nano ? -8 : -5, nano ? 8 : 5),
      size: nano ? random(5.5, 10.5) : random(17, 35),
      hue: nano ? [184, 207, 328, 48][school % 4] + random(-5, 5) : palette[index % palette.length] + random(-8, 8),
      accent: nano ? random(56, 72) : random(35, 68),
      phase: nano ? school * 1.37 + random(-.28, .28) : random(0, Math.PI * 2),
      depth: nano ? random(0.58, 1) : random(0.48, 1),
      kind: nano ? 4 + index % 2 : index % 4,
      scared: 0,
      nano,
      school,
      escaped: false,
      escapeX: 0,
      escapeY: 0,
    }
  }

  const resetPopulation = () => {
    const largeCount = width < 640 ? 25 : width < 1100 ? 34 : 42
    const nanoCount = width < 640 ? 18 : width < 1100 ? 25 : 32
    const populationChanged = fish.length !== largeCount + nanoCount
      || fish.filter((item) => item.nano).length !== nanoCount
    if (populationChanged) {
      fish.length = 0
      for (let index = 0; index < largeCount; index += 1) fish.push(makeFish(index))
      for (let index = 0; index < nanoCount; index += 1) fish.push(makeFish(index, true, nanoCount))
      fishDrawOrder.length = 0
      fishDrawOrder.push(...fish)
      fishDrawOrder.sort((first, second) => first.depth - second.depth)
    }
    const bubbleCount = width < 640 ? 32 : 58
    while (bubbles.length < bubbleCount) bubbles.push({
      x: random(0, width), y: random(0, height), radius: random(0.8, 3.7), speed: random(7, 24), drift: random(-5, 5), alpha: random(0.12, 0.48),
    })
    bubbles.length = bubbleCount
  }

  const resize = () => {
    const box = root.getBoundingClientRect()
    width = Math.max(1, Math.round(box.width))
    height = Math.max(1, Math.round(box.height))
    pixelRatio = Math.min(window.devicePixelRatio || 1, lowPowerDevice ? 1.35 : 1.8)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    waterGradients.length = 0
    dreamGradient = floorGradient = undefined
    resetPopulation()
  }

  const drawWater = (time: number) => {
    const hasCamera = cameraActive && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0
    if (hasCamera) {
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const drawWidth = video.videoWidth * scale
      const drawHeight = video.videoHeight * scale
      context.save()
      context.translate(width, 0)
      context.scale(-1, 1)
      context.filter = 'saturate(.65) contrast(.9) brightness(.45) blur(.5px)'
      context.drawImage(video, (width - drawWidth) * 0.5, (height - drawHeight) * 0.5, drawWidth, drawHeight)
      context.restore()
    }

    const mode = hasCamera ? 1 : 0
    let gradient = waterGradients[mode]
    if (!gradient) {
      gradient = context.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, hasCamera ? 'rgba(3, 24, 36, .65)' : '#031824')
      gradient.addColorStop(0.3, hasCamera ? 'rgba(3, 18, 29, .7)' : '#03121d')
      gradient.addColorStop(0.72, hasCamera ? 'rgba(2, 11, 20, .78)' : '#020b14')
      gradient.addColorStop(1, hasCamera ? 'rgba(1, 6, 12, .86)' : '#01060c')
      waterGradients[mode] = gradient
    }
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    if (hasCamera) {
      let dream = dreamGradient
      if (!dream) {
        dream = context.createRadialGradient(width * 0.5, height * 0.38, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.72)
        dream.addColorStop(0, 'rgba(90, 241, 221, .025)')
        dream.addColorStop(0.62, 'rgba(4, 72, 96, .02)')
        dream.addColorStop(1, 'rgba(0, 17, 35, .44)')
        dreamGradient = dream
      }
      context.fillStyle = dream
      context.fillRect(0, 0, width, height)
    }

    context.save()
    context.globalCompositeOperation = 'screen'
    for (let index = 0; index < 8; index += 1) {
      const x = width * (index / 7) + Math.sin(time * 0.00018 + index * 2.1) * width * 0.08
      const ray = context.createLinearGradient(x, 0, x + width * 0.1, height * 0.72)
      ray.addColorStop(0, 'rgba(163, 246, 238, .045)')
      ray.addColorStop(1, 'rgba(76, 187, 202, 0)')
      context.fillStyle = ray
      context.beginPath()
      context.moveTo(x - width * 0.028, 0)
      context.lineTo(x + width * 0.034, 0)
      context.lineTo(x + width * 0.15, height * 0.82)
      context.lineTo(x + width * 0.02, height * 0.82)
      context.closePath()
      context.fill()
    }
    context.restore()

    let floor = floorGradient
    if (!floor) {
      floor = context.createLinearGradient(0, height * 0.83, 0, height)
      floor.addColorStop(0, 'rgba(2, 10, 16, 0)')
      floor.addColorStop(0.32, 'rgba(2, 8, 14, .78)')
      floor.addColorStop(1, '#01050a')
      floorGradient = floor
    }
    context.fillStyle = floor
    context.fillRect(0, height * 0.8, width, height * 0.2)

  }

  const drawBubbles = (delta: number, time: number) => {
    context.save()
    context.strokeStyle = '#b9f5f4'
    bubbles.forEach((bubble, index) => {
      bubble.y -= bubble.speed * delta
      bubble.x += (bubble.drift + Math.sin(time * 0.001 + index) * 2.2) * delta
      if (bubble.y < -8) { bubble.y = height + random(0, 50); bubble.x = random(0, width) }
      context.globalAlpha = bubble.alpha
      context.lineWidth = Math.max(0.7, bubble.radius * 0.28)
      context.beginPath()
      context.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2)
      context.stroke()
    })
    context.restore()
  }

  const updateFish = (item: Fish, index: number, delta: number, time: number, fingertips: HandPoint[]) => {
    const neutralSpeed = (item.nano ? 35 + item.depth * 34 : 20 + item.depth * 28) * (item.vx < 0 ? -1 : 1)
    let targetVx = neutralSpeed
    let targetVy = Math.sin(time * (item.nano ? .00105 : .00065) + item.phase) * (item.nano ? 13 : 9)

    if (mouthOpen) {
      const dx = item.escapeX - item.x
      const dy = item.escapeY - item.y
      const distance = Math.hypot(dx, dy)
      const speed = Math.min(item.nano ? 410 : 330, distance * 3.4)
      targetVx = distance > 1 ? dx / distance * speed : 0
      targetVy = distance > 1 ? dy / distance * speed : 0
      item.scared = 1
    } else if (item.escaped) {
      const returnX = width * (.12 + ((index * 47) % 76) / 100)
      const returnY = height * (.18 + ((index * 53) % 64) / 100)
      const dx = returnX - item.x
      const dy = returnY - item.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const speed = Math.min(item.nano ? 235 : 185, 44 + distance * 1.18)
      targetVx = dx / distance * speed
      targetVy = dy / distance * speed
      if (item.x > item.size * 2 && item.x < width - item.size * 2
        && item.y > height * .14 && item.y < height * .86) item.escaped = false
    } else if (gathering > 0.015 && gaze !== 'neutral') {
      const centerX = gaze === 'left' ? width * 0.2 : width * 0.8
      const centerY = height * 0.51
      const angle = index * 2.39996 + time * 0.00016 * (index % 2 ? 1 : -1)
      const radius = Math.min(width, height) * (0.075 + (index % 9) * 0.009)
      const targetX = centerX + Math.cos(angle) * radius
      const targetY = centerY + Math.sin(angle) * radius * 0.72
      const distanceX = targetX - item.x
      const distanceY = targetY - item.y
      targetVx = distanceX * (0.82 + item.depth * 0.36)
      targetVy = distanceY * (0.82 + item.depth * 0.36)
      const maximum = 155 + item.depth * 70
      const speed = Math.hypot(targetVx, targetVy)
      if (speed > maximum) { targetVx *= maximum / speed; targetVy *= maximum / speed }
      targetVx = neutralSpeed * (1 - gathering) + targetVx * gathering
      targetVy = Math.sin(time * (item.nano ? .00105 : .00065) + item.phase) * (item.nano ? 13 : 9) * (1 - gathering) + targetVy * gathering
    }

    item.scared = Math.max(0, item.scared - delta)
    const scareRadius = Math.min(width, height) * .07 + item.size
    if (!mouthOpen && !item.escaped) {
      fingertips.forEach((fingertip) => {
        const dx = item.x - fingertip.x
        const dy = item.y - fingertip.y
        const distance = Math.max(1, Math.hypot(dx, dy))
        if (distance >= scareRadius) return
        const force = (1 - distance / scareRadius) * (920 + item.depth * 620) * (item.nano ? 1.22 : 1)
        item.vx += (dx / distance) * force * delta
        item.vy += (dy / distance) * force * delta
        item.vx += Math.cos(item.phase + time * .01) * force * delta * .2
        item.vy += Math.sin(item.phase + time * .01) * force * delta * .2
        item.scared = .72
      })
    }

    const steerStrength = mouthOpen ? 5.4 : item.escaped ? 3.1 : item.scared > 0 ? .42 : gathering > 0.2 ? 3.7 : 1.5
    const steer = 1 - Math.exp(-delta * steerStrength)
    item.vx += (targetVx - item.vx) * steer
    item.vy += (targetVy - item.vy) * steer
    const maximumVelocity = mouthOpen ? (item.nano ? 430 : 350) : item.scared > 0 ? (item.nano ? 390 : 330) : (item.nano ? 255 : 225)
    const currentVelocity = Math.hypot(item.vx, item.vy)
    if (currentVelocity > maximumVelocity) {
      item.vx *= maximumVelocity / currentVelocity
      item.vy *= maximumVelocity / currentVelocity
    }
    item.x += item.vx * delta
    item.y += item.vy * delta

    if (!mouthOpen && !item.escaped && (gaze === 'neutral' || gathering < 0.2)) {
      const margin = item.size * 2.7
      if (item.x < -margin && item.vx < 0) item.x = width + margin
      if (item.x > width + margin && item.vx > 0) item.x = -margin
    }
    if (!mouthOpen && !item.escaped) {
      if (item.y < height * 0.14) item.vy += 24 * delta
      if (item.y > height * 0.83) item.vy -= 24 * delta
    }
  }

  const paintFish = createLuminousFishPainter()
  const drawFish = (item: Fish, time: number) => paintFish(context, item, time)

  const setGaze = (next: Gaze) => {
    if (gaze === next) return
    gaze = next
    root.dataset.gaze = gaze
    if (!mouthOpen) gazeState.textContent = gaze.toUpperCase()
    if (!mouthOpen) {
      if (gaze === 'left') say('왼쪽 시선을 따라 물고기들이 모이고 있어요.')
      else if (gaze === 'right') say('오른쪽 시선을 따라 물고기들이 모이고 있어요.')
      else if (cameraActive) say('중립 시선이에요. 물고기들이 자유롭게 헤엄칩니다.')
    }
  }

  const setMouthOpen = (next: boolean) => {
    if (mouthOpen === next) return
    mouthOpen = next
    root.classList.toggle('is-mouth-open', mouthOpen)
    if (mouthOpen) {
      gazeState.textContent = 'ESCAPE!'
      fish.forEach((item) => {
        const centerX = width * .5
        const centerY = height * .5
        let angle = Math.atan2(item.y - centerY, item.x - centerX)
        if (Math.hypot(item.x - centerX, item.y - centerY) < 55) angle = item.phase
        angle += Math.sin(item.phase * 2.3) * .13
        const directionX = Math.cos(angle)
        const directionY = Math.sin(angle)
        const margin = item.size * 3.2 + 34
        const distanceX = directionX > 0
          ? (width * .5 + margin) / directionX
          : directionX < 0 ? (-width * .5 - margin) / directionX : Infinity
        const distanceY = directionY > 0
          ? (height * .5 + margin) / directionY
          : directionY < 0 ? (-height * .5 - margin) / directionY : Infinity
        const distanceToEdge = Math.min(distanceX, distanceY)
        item.escapeX = centerX + directionX * distanceToEdge
        item.escapeY = centerY + directionY * distanceToEdge
        item.escaped = true
      })
      say('입을 벌리자 물고기들이 수족관 밖으로 도망가요!')
    } else {
      gazeState.textContent = gaze.toUpperCase()
      say('입을 닫았어요. 물고기들이 화면 안으로 돌아옵니다.')
    }
  }

  const projectLandmark = (landmark: { x: number; y: number }) => {
    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawWidth = videoWidth * scale
    const drawHeight = videoHeight * scale
    return {
      x: (width - drawWidth) * .5 + (1 - landmark.x) * drawWidth,
      y: (height - drawHeight) * .5 + landmark.y * drawHeight,
    }
  }

  const updateTracking = (time: number) => {
    if (!cameraActive || !faceLandmarker || !handLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const videoTime = video.currentTime
    const faceDue = videoTime !== lastFaceVideoTime && time - lastFaceInferenceAt >= faceInferenceInterval
    const handDue = videoTime !== lastHandVideoTime && time - lastHandInferenceAt >= handInferenceInterval
    if (!faceDue && !handDue) return
    try {
      if (faceDue && (!handDue || lastFaceInferenceAt <= lastHandInferenceAt)) {
        lastFaceVideoTime = videoTime
        lastFaceInferenceAt = time
        const faceResult = faceLandmarker.detectForVideo(video, time)
        const categories = faceResult.faceBlendshapes[0]?.categories
        if (categories?.length) {
          lastFaceAt = time
          const score = (name: string) => categories.find((category) => category.categoryName === name)?.score ?? 0
          rawLeft = score('eyeLookOutLeft')
          rawRight = score('eyeLookOutRight')
          rawJaw = score('jawOpen')
        }
      } else {
        lastHandVideoTime = videoTime
        lastHandInferenceAt = time
        const handResult = handLandmarker.detectForVideo(video, time)
        const fingertipIndices = [4, 8, 12, 16, 20]
        hands.length = 0
        handResult.landmarks.forEach((landmarks, handIndex) => {
          fingertipIndices.forEach((landmarkIndex, fingertipIndex) => {
            hands.push({
              ...projectLandmark(landmarks[landmarkIndex]),
              lastSeen: time,
              phase: handIndex * Math.PI + fingertipIndex * .72,
            })
          })
        })
      }
    } catch {
      // A dropped inference frame does not interrupt the aquarium animation.
    }
  }

  const updateGaze = (delta: number, time: number) => {
    if (time - lastFaceAt > FACE_GRACE_MS) { rawLeft = 0; rawRight = 0; rawJaw = 0 }
    const smoothing = 1 - Math.exp(-delta * 9)
    smoothLeft += (rawLeft - smoothLeft) * smoothing
    smoothRight += (rawRight - smoothRight) * smoothing
    smoothJaw += (rawJaw - smoothJaw) * (1 - Math.exp(-delta * 11))
    if (!mouthOpen && smoothJaw > MOUTH_OPEN_ENTER) setMouthOpen(true)
    else if (mouthOpen && smoothJaw < MOUTH_OPEN_EXIT) setMouthOpen(false)
    const dominant = smoothLeft > smoothRight ? 'left' : 'right'
    const high = Math.max(smoothLeft, smoothRight)
    const low = Math.min(smoothLeft, smoothRight)
    if (gaze === 'neutral') {
      if (high > GAZE_ENTER && high - low > 0.08) setGaze(dominant)
    } else {
      const active = gaze === 'left' ? smoothLeft : smoothRight
      if (active < GAZE_EXIT || high - low < 0.045) setGaze('neutral')
      else if (dominant !== gaze && high > GAZE_ENTER && high - low > 0.1) setGaze(dominant)
    }
    const targetGathering = gaze === 'neutral' ? 0 : 1
    gathering += (targetGathering - gathering) * (1 - Math.exp(-delta * (targetGathering ? 2.5 : 1.45)))
    leftMeter.style.width = `${clamp(smoothLeft * 100, 0, 100).toFixed(1)}%`
    rightMeter.style.width = `${clamp(smoothRight * 100, 0, 100).toFixed(1)}%`
    leftValue.value = smoothLeft.toFixed(2)
    rightValue.value = smoothRight.toFixed(2)
    const nextHandActive = hands.some((hand) => time - hand.lastSeen < 180)
    if (nextHandActive !== handActive) {
      handActive = nextHandActive
      root.classList.toggle('has-tracked-hand', handActive)
      if (handActive && !mouthOpen) say('손가락 끝이 가까워지면 열대어들이 사방으로 흩어져요.')
      else if (!mouthOpen && gaze === 'neutral' && cameraActive) say('손가락이 멀어지자 물고기들이 다시 천천히 유영합니다.')
    }
  }

  const drawTargetGlow = (time: number) => {
    if (gathering < 0.01 || gaze === 'neutral') return
    const x = gaze === 'left' ? width * 0.2 : width * 0.8
    const y = height * 0.51
    const radius = Math.min(width, height) * (0.18 + Math.sin(time * 0.002) * 0.008)
    const glow = context.createRadialGradient(x, y, 0, x, y, radius)
    glow.addColorStop(0, `rgba(177, 255, 233, ${0.1 * gathering})`)
    glow.addColorStop(1, 'rgba(68, 219, 206, 0)')
    context.fillStyle = glow
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  const drawHandRipples = (time: number, fingertips: HandPoint[]) => {
    context.save()
    context.globalCompositeOperation = 'screen'
    fingertips.forEach((hand) => {
      const pulse = (time * .00065 + hand.phase) % 1
      const radius = Math.min(width, height) * (.018 + pulse * .035)
      const glow = context.createRadialGradient(hand.x, hand.y, 0, hand.x, hand.y, radius)
      glow.addColorStop(0, 'rgba(176, 255, 237, .13)')
      glow.addColorStop(.45, 'rgba(111, 234, 224, .06)')
      glow.addColorStop(1, 'rgba(82, 211, 216, 0)')
      context.fillStyle = glow
      context.beginPath(); context.arc(hand.x, hand.y, radius, 0, Math.PI * 2); context.fill()
      context.strokeStyle = `rgba(188, 255, 241, ${.3 * (1 - pulse)})`
      context.lineWidth = 1.1
      context.beginPath(); context.arc(hand.x, hand.y, radius * .72, 0, Math.PI * 2); context.stroke()
      context.fillStyle = 'rgba(214, 255, 244, .62)'
      context.beginPath(); context.arc(hand.x, hand.y, 2.2, 0, Math.PI * 2); context.fill()
    })
    context.restore()
  }

  const draw = (time: number) => {
    if (disposed) return
    if (document.hidden) {
      previousFrame = time
      animationFrame = requestAnimationFrame(draw)
      return
    }
    if (time - lastRenderedAt < renderInterval - 1) {
      animationFrame = requestAnimationFrame(draw)
      return
    }
    lastRenderedAt = time
    const delta = Math.min(0.034, Math.max(0.001, (time - previousFrame) / 1000))
    previousFrame = time
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    updateTracking(time)
    updateGaze(delta, time)
    activeFingertips.length = 0
    hands.forEach((hand) => { if (time - hand.lastSeen < 180) activeFingertips.push(hand) })
    drawWater(time)
    drawTargetGlow(time)
    drawHandRipples(time, activeFingertips)
    fish.forEach((item, index) => updateFish(item, index, delta, time, activeFingertips))
    fishDrawOrder.forEach((item) => drawFish(item, time))
    drawBubbles(delta, time)
    animationFrame = requestAnimationFrame(draw)
  }

  const getVision = () => {
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    return visionPromise
  }

  const createLandmarkers = async (delegate: 'GPU' | 'CPU') => {
    const vision = await getVision()
    if (disposed) throw new Error('Aquarium has been disposed.')
    const faceOptions = {
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    }
    try {
      const face = await FaceLandmarker.createFromOptions(vision, { ...faceOptions, baseOptions: { modelAssetPath: FACE_MODEL, delegate } })
      try {
        const hand = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: .56,
          minHandPresenceConfidence: .52,
          minTrackingConfidence: .52,
        })
        if (disposed) { hand.close(); throw new Error('Aquarium has been disposed.') }
        faceLandmarker?.close()
        handLandmarker?.close()
        faceLandmarker = face
        handLandmarker = hand
      } catch (error) {
        face.close()
        throw error
      }
    } catch (error) {
      throw error
    }
  }

  const ensureLandmarkers = async () => {
    if (faceLandmarker && handLandmarker) return
    try { await createLandmarkers('GPU') }
    catch { await createLandmarkers('CPU') }
  }

  const stopCamera = () => {
    cameraRequest += 1
    cameraActive = false
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    root.classList.remove('is-camera-active')
    root.classList.remove('has-tracked-hand')
    toggleButton.classList.remove('is-active')
    toggleButton.textContent = '카메라 시작'
    rawLeft = 0
    rawRight = 0
    rawJaw = 0
    smoothJaw = 0
    hands = []
    handActive = false
    mouthOpen = false
    root.classList.remove('is-mouth-open')
    gazeState.textContent = gaze.toUpperCase()
    setGaze('neutral')
    say('카메라가 꺼졌어요. 물고기들은 자유롭게 헤엄칩니다.')
  }

  const startCamera = async () => {
    if (starting || disposed) return
    if (!navigator.mediaDevices?.getUserMedia) { say('이 브라우저에서는 카메라를 사용할 수 없어요.'); return }
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true
    say('전체 화면 카메라와 얼굴·손 인식 모델을 준비하고 있어요…')
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 } }, audio: false,
      })
      if (disposed || request !== cameraRequest) { nextStream.getTracks().forEach((track) => track.stop()); return }
      stream = nextStream
      video.srcObject = nextStream
      await Promise.all([video.play(), ensureLandmarkers()])
      if (disposed || request !== cameraRequest) return
      cameraActive = true
      lastFaceVideoTime = -1
      lastHandVideoTime = -1
      lastFaceInferenceAt = -Infinity
      lastHandInferenceAt = -Infinity
      lastFaceAt = -Infinity
      root.classList.add('is-camera-active')
      toggleButton.classList.add('is-active')
      toggleButton.textContent = '카메라 끄기'
      say('시선으로 모으고, 화면 속 손을 물고기 가까이 가져가 흩어 보세요.')
    } catch {
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      video.srcObject = null
      say('카메라 또는 얼굴·손 인식 모델을 준비하지 못했어요. 권한을 확인해 주세요.')
    } finally {
      starting = false
      toggleButton.disabled = false
    }
  }

  const toggleCamera = () => {
    if (cameraActive || stream) stopCamera()
    else void startCamera()
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(root)
  toggleButton.addEventListener('click', toggleCamera)
  root.dataset.gaze = 'neutral'
  resize()
  animationFrame = requestAnimationFrame(draw)

  return () => {
    disposed = true
    cameraRequest += 1
    cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    toggleButton.removeEventListener('click', toggleCamera)
    stream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
    faceLandmarker?.close()
    handLandmarker?.close()
  }
}
