import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const FACE_MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`
const LEMON_IMAGE_PATHS = [`${import.meta.env.BASE_URL}lemons/lemon.png`, `${import.meta.env.BASE_URL}lemon.png`]

type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type Hand = { side: 'left' | 'right'; palm: Point; fist: boolean; angle: number }
type Lemon = { x: number; y: number; baseY: number; radius: number; phase: number; drift: number; juice: number; squeeze: number; dropTimer: number; state: 'floating' | 'held' | 'falling'; fallSpeed: number }
type Droplet = { x: number; y: number; vx: number; vy: number; size: number; amount: number; collectible: boolean; color: string }

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const LEMON_INFO = { label: '레몬', drinkName: '레몬에이드', drop: '#fff47b', drinkTop: '#fff48a', drinkBottom: '#e6bb18' }
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y)

export function setupHandTracking(root: HTMLElement) {
  const video = root.querySelector<HTMLVideoElement>('#hand-camera')!
  const canvas = root.querySelector<HTMLCanvasElement>('#hand-overlay')!
  const stage = root.querySelector<HTMLElement>('.hand-camera-stage')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#hand-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#hand-status')!
  const context = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!context) return () => {}
  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  // Positions keep interpolating between results, so this stays smooth while
  // avoiding a synchronous model call on every display refresh.
  const handInferenceInterval = 1000 / (lowPowerDevice ? 20 : 24)
  const faceInferenceInterval = 1000 / (lowPowerDevice ? 8 : 12)
  const maximumPixelRatio = lowPowerDevice ? 1.25 : 1.5

  const lemonImage = new Image()
  let lemonImageReady = false
  lemonImage.addEventListener('load', () => { lemonImageReady = true })
  let lemonImagePathIndex = 0
  lemonImage.addEventListener('error', () => {
    lemonImagePathIndex += 1
    if (lemonImagePathIndex < LEMON_IMAGE_PATHS.length) lemonImage.src = LEMON_IMAGE_PATHS[lemonImagePathIndex]
  })
  lemonImage.src = LEMON_IMAGE_PATHS[lemonImagePathIndex]

  let landmarker: HandLandmarker | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
  let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null
  let faceUnavailable = false
  let cameraStream: MediaStream | null = null
  let animationFrame = 0
  let disposed = false
  let starting = false
  let cameraActive = false
  let cameraRequest = 0
  let width = 1
  let height = 1
  let pixelRatio = 1
  let lastHandVideoTime = -1
  let lastFaceVideoTime = -1
  let lastHandDetectionTime = -Infinity
  let lastFaceDetectionTime = -Infinity
  let lastFrame = performance.now()
  let hands: Hand[] = []
  let mouth: Point | null = null
  let drinking = false
  let lemons: Lemon[] = []
  let droplets: Droplet[] = []
  let cup = { x: 0, y: 0, targetX: 0, targetY: 0, width: 180, height: 230, lemonade: 0, hasStraw: false, rotation: 0, targetRotation: 0, pourTimer: 0 }

  const say = (message: string) => { status.textContent = message }

  const resize = () => {
    const bounds = stage.getBoundingClientRect()
    width = Math.max(1, bounds.width)
    height = Math.max(1, bounds.height)
    pixelRatio = Math.min(window.devicePixelRatio || 1, maximumPixelRatio)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    cup.width = clamp(width * 0.19, 125, 210)
    cup.height = cup.width * 1.27
    if (!cup.x) cup.x = cup.targetX = width * 0.5
    if (!cup.y) cup.y = cup.targetY = height * 0.77
    if (!lemons.length) createLemons()
  }

  const createLemons = () => {
    const count = width < 560 ? 5 : 8
    lemons = Array.from({ length: count }, (_, index) => {
      const radius = clamp(Math.min(width, height) * (0.058 + (index % 3) * 0.007), 42, 74)
      const x = width * (0.12 + ((index * 0.21) % 0.76))
      const baseY = height * (0.22 + ((index * 0.173) % 0.45))
      return { x, y: baseY, baseY, radius, phase: index * 1.73, drift: 18 + (index % 4) * 7, juice: 0.72 + (index % 3) * 0.14, squeeze: 0, dropTimer: 0, state: 'floating', fallSpeed: 0 }
    })
  }

  const project = (landmark: Landmark): Point => {
    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawnWidth = videoWidth * scale
    const drawnHeight = videoHeight * scale
    return { x: (width - drawnWidth) / 2 + (1 - landmark.x) * drawnWidth, y: (height - drawnHeight) / 2 + landmark.y * drawnHeight }
  }

  const getHand = (landmarks: Landmark[], side: 'left' | 'right'): Hand => {
    const palmPoints = [0, 5, 9, 13, 17].map((index) => project(landmarks[index]))
    const palm = palmPoints.reduce((sum, point) => ({ x: sum.x + point.x / palmPoints.length, y: sum.y + point.y / palmPoints.length }), { x: 0, y: 0 })
    const palmSize = Math.max(0.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y))
    const tips = [8, 12, 16, 20].reduce((sum, index) => sum + Math.hypot(landmarks[index].x - landmarks[0].x, landmarks[index].y - landmarks[0].y), 0) / 4
    const wrist = project(landmarks[0])
    const middleBase = project(landmarks[9])
    let angle = Math.atan2(middleBase.y - wrist.y, middleBase.x - wrist.x) + Math.PI * 0.5
    if (angle > Math.PI) angle -= Math.PI * 2
    if (angle < -Math.PI) angle += Math.PI * 2
    return { side, palm, fist: tips / palmSize < 1.62, angle }
  }

  const updateTracking = (frameTime: number) => {
    if (!cameraActive || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const videoTime = video.currentTime
    if (videoTime !== lastHandVideoTime && frameTime - lastHandDetectionTime >= handInferenceInterval) {
      lastHandVideoTime = videoTime
      lastHandDetectionTime = frameTime
      const result = landmarker.detectForVideo(video, frameTime)
      hands = result.landmarks.map((landmarks, index) => {
        const category = result.handedness[index]?.[0]?.categoryName?.toLowerCase()
        return getHand(landmarks as Landmark[], category === 'left' ? 'left' : 'right')
      })
    }
    if (!cup.hasStraw) { mouth = null; return }
    if (!faceLandmarker && !faceLandmarkerPromise && !faceUnavailable) {
      void ensureFaceLandmarker().catch(() => {
        faceUnavailable = true
        say('얼굴 인식 모델을 준비하지 못했어요. 인터넷 연결을 확인해 주세요.')
      })
    }
    if (!faceLandmarker || videoTime === lastFaceVideoTime || frameTime - lastFaceDetectionTime < faceInferenceInterval) return
    lastFaceVideoTime = videoTime
    lastFaceDetectionTime = frameTime
    const faceResult = faceLandmarker.detectForVideo(video, frameTime)
    const face = faceResult.faceLandmarks[0] as Landmark[] | undefined
    if (face?.[13] && face[14]) {
      const upperLip = project(face[13])
      const lowerLip = project(face[14])
      const detectedMouth = { x: (upperLip.x + lowerLip.x) * 0.5, y: (upperLip.y + lowerLip.y) * 0.5 }
      mouth = mouth ? { x: mouth.x + (detectedMouth.x - mouth.x) * 0.55, y: mouth.y + (detectedMouth.y - mouth.y) * 0.55 } : detectedMouth
    } else mouth = null
  }

  const drawFallbackLemon = (radius: number) => {
    const gradient = context.createRadialGradient(-radius * 0.28, -radius * 0.35, radius * 0.08, 0, 0, radius)
    gradient.addColorStop(0, '#fff6a8'); gradient.addColorStop(0.58, '#ffe04e'); gradient.addColorStop(1, '#e2a908')
    context.fillStyle = gradient
    context.beginPath(); context.ellipse(0, 0, radius, radius * 0.8, -0.12, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#74a73a'
    context.beginPath(); context.ellipse(-radius * 0.28, -radius * 0.8, radius * 0.28, radius * 0.12, -0.42, 0, Math.PI * 2); context.fill()
  }

  const drawLemon = (lemon: Lemon) => {
    const squeezed = lemon.state === 'held' || lemon.state === 'falling'
    const scaleX = squeezed ? 1 - lemon.squeeze * 0.38 : 1
    const scaleY = squeezed ? 1 - lemon.squeeze * 0.12 : 1
    context.save()
    context.translate(lemon.x, lemon.y)
    context.rotate(Math.sin(lemon.phase) * 0.11)
    context.scale(scaleX, scaleY)
    context.globalAlpha = lemon.state === 'falling' ? 0.8 : 1
    if (lemonImageReady) context.drawImage(lemonImage, -lemon.radius, -lemon.radius, lemon.radius * 2, lemon.radius * 2)
    else drawFallbackLemon(lemon.radius)
    if (lemon.juice < 1) {
      context.globalAlpha = 0.17 + (1 - lemon.juice) * 0.3
      context.fillStyle = '#9b6f07'
      context.beginPath(); context.ellipse(0, 0, lemon.radius * 0.73, lemon.radius * 0.52, 0, 0, Math.PI * 2); context.fill()
    }
    context.restore()
  }

  const makeDroplet = (lemon: Lemon) => {
    droplets.push({ x: lemon.x + (Math.random() - 0.5) * lemon.radius * 0.35, y: lemon.y + lemon.radius * (0.52 - lemon.squeeze * 0.22), vx: (Math.random() - 0.5) * 36, vy: 80 + Math.random() * 55, size: 5 + Math.random() * 4, amount: 0.009, collectible: true, color: LEMON_INFO.drop })
  }

  const updateLemons = (deltaTime: number, leftHand?: Hand) => {
    const held = lemons.find((lemon) => lemon.state === 'held')
    if (!held && leftHand?.fist) {
      const candidate = lemons.filter((lemon) => lemon.state === 'floating' && distance({ x: lemon.x, y: lemon.y }, leftHand.palm) < lemon.radius + 62)
        .sort((first, second) => distance({ x: first.x, y: first.y }, leftHand.palm) - distance({ x: second.x, y: second.y }, leftHand.palm))[0]
      if (candidate) { candidate.state = 'held'; say(`왼손으로 ${LEMON_INFO.label}을 잡았어요. 주먹을 유지해 즙을 짜 보세요.`) }
    }
    lemons.forEach((lemon) => {
      lemon.phase += deltaTime * 1.1
      if (lemon.state === 'floating') {
        lemon.x += Math.sin(lemon.phase * 0.71) * lemon.drift * deltaTime
        lemon.y = lemon.baseY + Math.sin(lemon.phase) * 16
        lemon.x = clamp(lemon.x, lemon.radius, width - lemon.radius)
      } else if (lemon.state === 'held') {
        if (!leftHand?.fist) { lemon.state = 'floating'; lemon.baseY = clamp(lemon.y, height * 0.16, height * 0.68); lemon.squeeze = 0; return }
        lemon.x += (leftHand.palm.x - lemon.x) * Math.min(1, deltaTime * 16)
        lemon.y += (leftHand.palm.y - lemon.y) * Math.min(1, deltaTime * 16)
        lemon.squeeze = 0.68 + Math.sin(lemon.phase * 12) * 0.1
        lemon.juice = Math.max(0, lemon.juice - deltaTime * 0.3)
        lemon.dropTimer -= deltaTime
        if (lemon.dropTimer <= 0 && lemon.juice > 0) { makeDroplet(lemon); lemon.dropTimer = 0.055 }
        if (lemon.juice <= 0) { lemon.state = 'falling'; lemon.squeeze = 0.86; lemon.fallSpeed = 40; say(`${LEMON_INFO.label}을 전부 짰어요! 아래로 떨어집니다.`) }
      } else {
        lemon.fallSpeed += deltaTime * 860
        lemon.y += lemon.fallSpeed * deltaTime
        lemon.squeeze = Math.min(0.9, lemon.squeeze + deltaTime * 0.5)
      }
    })
    lemons = lemons.filter((lemon) => lemon.state !== 'falling' || lemon.y - lemon.radius < height + 100)
  }

  const updateCup = (deltaTime: number, rightHand?: Hand) => {
    if (rightHand) {
      cup.targetX = clamp(rightHand.palm.x, cup.width * 0.58, width - cup.width * 0.58)
      cup.targetY = clamp(rightHand.palm.y, cup.height * 0.55, height - cup.height * 0.55)
      cup.targetRotation = rightHand.angle
    } else { cup.targetX = width * 0.5; cup.targetY = height * 0.77; cup.targetRotation = 0 }
    cup.x += (cup.targetX - cup.x) * Math.min(1, deltaTime * 8)
    cup.y += (cup.targetY - cup.y) * Math.min(1, deltaTime * 8)
    const rotationDelta = Math.atan2(Math.sin(cup.targetRotation - cup.rotation), Math.cos(cup.targetRotation - cup.rotation))
    cup.rotation += rotationDelta * Math.min(1, deltaTime * 9)
  }

  const updateDroplets = (deltaTime: number) => {
    const cupTop = cup.y - cup.height * 0.42
    droplets.forEach((drop) => {
      drop.vy += 720 * deltaTime; drop.x += drop.vx * deltaTime; drop.y += drop.vy * deltaTime
      if (drop.collectible && Math.abs(cup.rotation) < 0.5 && drop.y >= cupTop && drop.y <= cup.y + cup.height * 0.42 && Math.abs(drop.x - cup.x) < cup.width * 0.43) {
        drop.y = height + 200
        cup.lemonade = clamp(cup.lemonade + drop.amount, 0, 1)
      }
    })
    droplets = droplets.filter((drop) => drop.y < height + 40)
    if (!cup.hasStraw && cup.lemonade >= 0.96) {
      cup.lemonade = 1
      cup.hasStraw = true
      say(`${LEMON_INFO.drinkName}가 가득 찼어요! 컵의 빨대를 입 가까이 가져가 보세요.`)
    }
  }

  const rotateCupPoint = (x: number, y: number): Point => ({
    x: cup.x + x * Math.cos(cup.rotation) - y * Math.sin(cup.rotation),
    y: cup.y + x * Math.sin(cup.rotation) + y * Math.cos(cup.rotation),
  })

  const updatePouring = (deltaTime: number, rightHand?: Hand) => {
    const tilt = Math.abs(cup.rotation)
    if (!rightHand || tilt < 0.9 || cup.lemonade <= 0) { cup.pourTimer = 0; return }
    cup.pourTimer -= deltaTime
    const amount = Math.min(cup.lemonade, deltaTime * (0.12 + (tilt - 0.9) * 0.12))
    cup.lemonade = Math.max(0, cup.lemonade - amount)
    if (cup.pourTimer <= 0) {
      const side = cup.rotation > 0 ? 1 : -1
      const rim = rotateCupPoint(side * cup.width * 0.47, -cup.height * 0.4)
      droplets.push({
        x: rim.x + (Math.random() - 0.5) * 8,
        y: rim.y,
        vx: side * (35 + Math.random() * 55),
        vy: 25 + Math.random() * 45,
        size: 5 + Math.random() * 5,
        amount: 0,
        collectible: false,
        color: LEMON_INFO.drop,
      })
      cup.pourTimer = 0.045
    }
    if (cup.lemonade <= 0.01) {
      cup.lemonade = 0
      cup.hasStraw = false
      drinking = false
      say('컵을 뒤집어 레몬에이드를 모두 쏟았어요.')
    }
  }

  const getStrawPoints = () => {
    const start = rotateCupPoint(cup.width * 0.2, cup.height * 0.18)
    const rim = rotateCupPoint(cup.width * 0.285, -cup.height * 0.42)
    const restingEnd = rotateCupPoint(cup.width * 0.3, -cup.height * 0.68)
    return { start, rim, end: drinking && mouth ? mouth : restingEnd, restingEnd }
  }

  const updateDrinking = (deltaTime: number, rightHand?: Hand) => {
    const wasDrinking = drinking
    const { restingEnd } = getStrawPoints()
    drinking = Boolean(cup.hasStraw && rightHand && mouth && Math.abs(cup.rotation) < 0.65 && distance(restingEnd, mouth) < cup.width * 0.85)
    if (drinking) cup.lemonade = Math.max(0, cup.lemonade - deltaTime * 0.16)
    if (drinking && !wasDrinking) say('빨대를 통해 레몬에이드를 마시고 있어요.')
    if (cup.hasStraw && cup.lemonade <= 0.01) {
      cup.lemonade = 0
      cup.hasStraw = false
      drinking = false
      say('레몬에이드를 다 마셨어요. 레몬을 더 짜서 다시 채워 보세요.')
    } else if (wasDrinking && !drinking) say('빨대를 입 가까이 가져가면 레몬에이드를 마실 수 있어요.')
  }

  const drawCup = (time: number) => {
    const halfTop = cup.width * 0.5
    const halfBottom = cup.width * 0.38
    const top = -cup.height * 0.42
    const bottom = cup.height * 0.42
    const fillTop = bottom - cup.lemonade * (bottom - top)
    context.save()
    context.translate(cup.x, cup.y)
    context.rotate(cup.rotation)
    context.save()
    context.beginPath(); context.moveTo(-halfTop, top); context.lineTo(halfTop, top); context.lineTo(halfBottom, bottom); context.lineTo(-halfBottom, bottom); context.closePath(); context.clip()
    if (cup.lemonade > 0) {
      const lemonade = context.createLinearGradient(0, fillTop, 0, bottom)
      lemonade.addColorStop(0, LEMON_INFO.drinkTop); lemonade.addColorStop(1, LEMON_INFO.drinkBottom)
      context.fillStyle = lemonade; context.fillRect(-halfTop, fillTop, cup.width, bottom - fillTop + 2)
      context.fillStyle = 'rgba(255,255,255,0.34)'; context.fillRect(-halfTop, fillTop, cup.width, 3)
    }
    // The submerged section belongs between the drink and the ice.  This keeps
    // the lemonade behind the straw while the ice still sits naturally in front.
    if (cup.hasStraw) {
      const strawStartX = cup.width * 0.2
      const strawStartY = cup.height * 0.18
      const strawRimX = cup.width * 0.285
      const strawRimY = top - 3
      context.save()
      context.lineCap = 'round'; context.strokeStyle = 'rgba(90, 73, 57, 0.24)'; context.lineWidth = 12
      context.beginPath(); context.moveTo(strawStartX, strawStartY); context.lineTo(strawRimX, strawRimY); context.stroke()
      context.strokeStyle = '#fffdf5'; context.lineWidth = 8
      context.beginPath(); context.moveTo(strawStartX, strawStartY); context.lineTo(strawRimX, strawRimY); context.stroke()
      context.strokeStyle = '#df413c'; context.lineWidth = 3
      for (let progress = 0.18; progress < 0.96; progress += 0.24) {
        const centerX = strawStartX + (strawRimX - strawStartX) * progress
        const centerY = strawStartY + (strawRimY - strawStartY) * progress
        context.beginPath(); context.moveTo(centerX - 4, centerY - 3); context.lineTo(centerX + 4, centerY + 3); context.stroke()
      }
      context.restore()
    }
    const iceSize = cup.width * 0.21
    const iceBaseY = bottom - iceSize * 0.78
    ;[-0.22, 0, 0.22, -0.22, 0, 0.22].forEach((offset, index) => {
      const iceX = cup.width * offset
      const iceY = iceBaseY - Math.floor(index / 3) * iceSize * 0.84 + Math.sin(time * 0.002 + index * 2.2) * 2
      context.save(); context.translate(iceX, iceY); context.rotate(0.24 + index * 0.5)
      context.shadowColor = 'rgba(58, 125, 146, 0.24)'; context.shadowBlur = 9; context.shadowOffsetY = 5
      const iceFront = context.createLinearGradient(-iceSize * 0.5, -iceSize * 0.42, iceSize * 0.5, iceSize * 0.42)
      iceFront.addColorStop(0, 'rgba(255, 255, 255, 0.94)'); iceFront.addColorStop(0.45, 'rgba(211, 242, 250, 0.66)'); iceFront.addColorStop(1, 'rgba(132, 198, 218, 0.54)')
      context.fillStyle = iceFront; context.strokeStyle = 'rgba(255, 255, 255, 0.92)'; context.lineWidth = 1.4
      context.beginPath(); context.roundRect(-iceSize * 0.5, -iceSize * 0.42, iceSize, iceSize * 0.84, iceSize * 0.15); context.fill(); context.stroke()
      context.shadowColor = 'transparent'
      context.fillStyle = 'rgba(255, 255, 255, 0.55)'
      context.beginPath(); context.moveTo(-iceSize * 0.42, -iceSize * 0.36); context.lineTo(-iceSize * 0.21, -iceSize * 0.56); context.lineTo(iceSize * 0.38, -iceSize * 0.52); context.lineTo(iceSize * 0.47, -iceSize * 0.36); context.closePath(); context.fill()
      context.fillStyle = 'rgba(105, 184, 209, 0.2)'
      context.beginPath(); context.moveTo(iceSize * 0.35, -iceSize * 0.29); context.lineTo(iceSize * 0.5, -iceSize * 0.4); context.lineTo(iceSize * 0.5, iceSize * 0.3); context.lineTo(iceSize * 0.35, iceSize * 0.42); context.closePath(); context.fill()
      context.strokeStyle = 'rgba(255, 255, 255, 0.76)'; context.lineWidth = 1
      context.beginPath(); context.moveTo(-iceSize * 0.31, -iceSize * 0.23); context.lineTo(-iceSize * 0.12, -iceSize * 0.38); context.lineTo(iceSize * 0.18, -iceSize * 0.34); context.stroke()
      context.restore()
    })
    if (cup.hasStraw) {
      const mintY = Math.max(top + 15, fillTop + 8)
      context.save(); context.translate(-cup.width * 0.13, mintY); context.rotate(-0.28)
      const mintGradient = context.createLinearGradient(-22, -10, 24, 12)
      mintGradient.addColorStop(0, '#2f8e58'); mintGradient.addColorStop(0.52, '#66c878'); mintGradient.addColorStop(1, '#20734a')
      context.fillStyle = mintGradient; context.shadowColor = 'rgba(25, 103, 58, 0.28)'; context.shadowBlur = 7
      context.beginPath(); context.moveTo(0, 0); context.bezierCurveTo(-13, -22, -33, -15, -27, 3); context.bezierCurveTo(-19, 19, -5, 12, 0, 0); context.fill()
      context.beginPath(); context.moveTo(1, 1); context.bezierCurveTo(12, -20, 33, -14, 29, 5); context.bezierCurveTo(22, 20, 7, 12, 1, 1); context.fill()
      context.strokeStyle = 'rgba(224, 255, 213, 0.55)'; context.lineWidth = 1.2
      context.beginPath(); context.moveTo(-24, 0); context.lineTo(0, 0); context.lineTo(26, 1); context.stroke()
      context.restore()
    }
    context.restore()
    context.strokeStyle = 'rgba(234, 255, 255, 0.85)'; context.lineWidth = 3; context.shadowColor = 'rgba(152, 245, 237, 0.5)'; context.shadowBlur = 16
    context.beginPath(); context.moveTo(-halfTop, top); context.lineTo(halfTop, top); context.lineTo(halfBottom, bottom); context.lineTo(-halfBottom, bottom); context.closePath(); context.stroke()
    context.globalAlpha = 0.35; context.beginPath(); context.ellipse(0, top, halfTop, 11, 0, 0, Math.PI * 2); context.stroke()
    context.restore()
  }

  const drawStraw = (time: number) => {
    if (!cup.hasStraw) return
    const { rim, end } = getStrawPoints()
    const dx = end.x - rim.x
    const dy = end.y - rim.y
    const length = Math.max(1, Math.hypot(dx, dy))
    const unitX = dx / length
    const unitY = dy / length
    const perpendicularX = -unitY
    const perpendicularY = unitX
    context.save()
    context.lineCap = 'round'
    context.strokeStyle = 'rgba(93, 84, 67, 0.28)'
    context.lineWidth = 12
    context.beginPath(); context.moveTo(rim.x, rim.y); context.lineTo(end.x, end.y); context.stroke()
    context.strokeStyle = '#fffdf5'
    context.lineWidth = 8
    context.shadowColor = drinking ? '#fff179' : 'rgba(255, 255, 255, 0.4)'
    context.shadowBlur = drinking ? 18 : 0
    context.beginPath(); context.moveTo(rim.x, rim.y); context.lineTo(end.x, end.y); context.stroke()
    context.shadowColor = 'transparent'
    context.strokeStyle = '#df413c'
    context.lineWidth = 3
    for (let offset = 12; offset < length - 5; offset += 21) {
      const centerX = rim.x + unitX * offset
      const centerY = rim.y + unitY * offset
      context.beginPath()
      context.moveTo(centerX - perpendicularX * 4 - unitX * 2.5, centerY - perpendicularY * 4 - unitY * 2.5)
      context.lineTo(centerX + perpendicularX * 4 + unitX * 2.5, centerY + perpendicularY * 4 + unitY * 2.5)
      context.stroke()
    }
    if (drinking) {
      context.fillStyle = '#fff485'
      for (let index = 0; index < 6; index += 1) {
        const progress = (time * 0.0016 + index / 6) % 1
        const x = rim.x + (end.x - rim.x) * progress
        const y = rim.y + (end.y - rim.y) * progress
        context.beginPath(); context.arc(x, y, 3.3, 0, Math.PI * 2); context.fill()
      }
    }
    context.restore()
  }

  const drawDroplets = () => {
    context.save(); context.shadowBlur = 12
    droplets.forEach((drop) => { context.fillStyle = drop.color; context.shadowColor = drop.color; context.beginPath(); context.ellipse(drop.x, drop.y, drop.size * 0.62, drop.size, 0, 0, Math.PI * 2); context.fill() })
    context.restore()
  }

  const getVision = () => {
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    return visionPromise
  }

  const ensureFaceLandmarker = () => {
    if (faceLandmarker) return Promise.resolve(faceLandmarker)
    if (faceLandmarkerPromise) return faceLandmarkerPromise
    faceLandmarkerPromise = getVision().then((vision) => FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_PATH },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    })).then((createdFace) => {
      if (disposed) { createdFace.close(); throw new Error('Lemonade has been disposed.') }
      faceLandmarker = createdFace
      return createdFace
    })
    return faceLandmarkerPromise
  }

  const ensureLandmarker = async () => {
    if (landmarker) return landmarker
    say('손 인식 모델을 준비하고 있어요…')
    const vision = await getVision()
    if (disposed) throw new Error('Lemonade has been disposed.')
    const created = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_PATH }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.62, minHandPresenceConfidence: 0.58, minTrackingConfidence: 0.58 })
    if (disposed) { created.close(); throw new Error('Lemonade has been disposed.') }
    landmarker = created
    return landmarker
  }

  const draw = (time: number) => {
    if (disposed) return
    if (document.hidden) { animationFrame = requestAnimationFrame(draw); return }
    const deltaTime = Math.min(0.033, (time - lastFrame) / 1000)
    lastFrame = time
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, width, height)
    updateTracking(time)
    const leftHand = hands.find((hand) => hand.side === 'left')
    const rightHand = hands.find((hand) => hand.side === 'right')
    updateCup(deltaTime, rightHand); updateLemons(deltaTime, leftHand); updateDroplets(deltaTime); updatePouring(deltaTime, rightHand); updateDrinking(deltaTime, rightHand)
    lemons.forEach(drawLemon); drawDroplets(); drawCup(time); drawStraw(time)
    root.classList.toggle('has-hand', hands.length > 0); root.classList.toggle('is-pinching', Boolean(leftHand?.fist))
    animationFrame = requestAnimationFrame(draw)
  }

  const stopCamera = () => {
    cameraRequest += 1; cameraActive = false; hands = []; mouth = null; drinking = false
    cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; video.srcObject = null
    toggleButton.textContent = '카메라 시작'; toggleButton.classList.remove('is-active'); say('카메라가 꺼졌어요.')
  }

  const startCamera = async () => {
    if (starting || disposed) return
    if (!navigator.mediaDevices?.getUserMedia) { say('이 브라우저에서는 카메라를 사용할 수 없어요.'); return }
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true; say('카메라 권한을 요청하고 있어요…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (disposed || request !== cameraRequest) { stream.getTracks().forEach((track) => track.stop()); return }
      cameraStream = stream; video.srcObject = stream; await video.play()
      if (disposed || request !== cameraRequest) return
      await ensureLandmarker()
      if (disposed || request !== cameraRequest) return
      cameraActive = true
      lastHandVideoTime = -1; lastFaceVideoTime = -1; lastHandDetectionTime = -Infinity; lastFaceDetectionTime = -Infinity
      toggleButton.textContent = '카메라 끄기'; toggleButton.classList.add('is-active')
      say(`왼손 주먹으로 ${LEMON_INFO.label}을 짜고, 오른손 손바닥으로 컵을 옮겨 즙을 담아 보세요.`)
    } catch {
      cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; video.srcObject = null
      say('카메라 권한 또는 손 인식 모델을 준비하지 못했어요. 권한과 인터넷 연결을 확인해 주세요.')
    } finally { starting = false; toggleButton.disabled = false }
  }

  const toggleCamera = () => { if (cameraActive || cameraStream) stopCamera(); else void startCamera() }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(stage)
  toggleButton.addEventListener('click', toggleCamera)
  resize()
  animationFrame = requestAnimationFrame(draw)

  return () => {
    disposed = true; cancelAnimationFrame(animationFrame); resizeObserver.disconnect(); toggleButton.removeEventListener('click', toggleCamera)
    cameraStream?.getTracks().forEach((track) => track.stop()); video.srcObject = null; landmarker?.close(); faceLandmarker?.close()
  }
}
