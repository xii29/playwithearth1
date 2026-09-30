import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const FACE_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`
const HAND_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const FACE_GRACE = 420
const HAND_GRACE = 220
const READY_STABLE_MS = 650
const ROUND_MS = 60_000
const SWAP_MS = 850
const FINISH_MESSAGE_MS = 2400
const SHOWCASE_MS = 10_000

type Player = 1 | 2
type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type FaceState = { landmarks: Landmark[]; previous: Landmark[]; lastSeen: number; previousSeen: number; stableSince: number }
type HandState = { pinching: boolean; point: Point; lastSeen: number; releaseSince: number; ratio: number }
type Basis = { center: Point; xAxis: Point; yAxis: Point; scale: number }
type AttachedPoint = { anchor: number; u: number; v: number }
type Stroke = { owner: Player; target: Player; color: string; points: AttachedPoint[] }
type PanelMetric = { width: number; height: number; palette: { x: number; y: number; width: number; height: number }[] }

const COLORS = ['#ff5f91', '#ff8b50', '#ffd85b', '#bcf05d', '#30d7c5', '#50a6ff', '#7c6cff', '#c675ff', '#ffffff', '#29223f']
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y)
const other = (player: Player): Player => player === 1 ? 2 : 1

export function setupDoodleFace(root: HTMLElement) {
  const video = root.querySelector<HTMLVideoElement>('#doodle-camera')!
  const startButton = root.querySelector<HTMLButtonElement>('#doodle-start')!
  const helpButton = root.querySelector<HTMLButtonElement>('#doodle-help')!
  const closeHelpButton = root.querySelector<HTMLButtonElement>('#doodle-help-close')!
  const lobby = root.querySelector<HTMLElement>('#doodle-lobby')!
  const lobbyStatus = root.querySelector<HTMLElement>('#doodle-lobby-status')!
  const game = root.querySelector<HTMLElement>('#doodle-game')!
  const help = root.querySelector<HTMLElement>('#doodle-help-panel')!
  const status = root.querySelector<HTMLElement>('#doodle-status')!
  const timer = root.querySelector<HTMLElement>('#doodle-timer')!
  const waiting = [root.querySelector<HTMLElement>('#doodle-waiting-one')!, root.querySelector<HTMLElement>('#doodle-waiting-two')!]
  const labels = [root.querySelector<HTMLElement>('#doodle-label-one')!, root.querySelector<HTMLElement>('#doodle-label-two')!]
  const toast = root.querySelector<HTMLElement>('#doodle-toast')!
  const panels = root.querySelector<HTMLElement>('#doodle-panels')!
  const transitionLayer = root.querySelector<HTMLElement>('#doodle-transition-layer')!
  const output = [root.querySelector<HTMLCanvasElement>('#doodle-player-one')!, root.querySelector<HTMLCanvasElement>('#doodle-player-two')!]
  const transition = [root.querySelector<HTMLCanvasElement>('#doodle-transition-one')!, root.querySelector<HTMLCanvasElement>('#doodle-transition-two')!]
  const contexts = output.map((canvas) => canvas.getContext('2d', { alpha: false, desynchronized: true }))
  const transitionContexts = transition.map((canvas) => canvas.getContext('2d', { alpha: false, desynchronized: true }))
  if (contexts.some((context) => !context) || transitionContexts.some((context) => !context)) return () => {}
  const drawContexts = contexts as CanvasRenderingContext2D[]
  const swapContexts = transitionContexts as CanvasRenderingContext2D[]

  const lowPower = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  const dprLimit = lowPower ? 1.15 : 1.55
  const faceInterval = 1000 / (lowPower ? 10 : 15)
  const handInterval = 1000 / (lowPower ? 14 : 22)
  const renderInterval = 1000 / (lowPower ? 30 : 60)
  const faces = new Map<Player, FaceState>()
  const hands = new Map<Player, HandState>()
  const colors = new Map<Player, string>([[1, COLORS[0]], [2, COLORS[4]]])
  const strokes: Stroke[] = []
  const activeStrokes = new Map<Player, Stroke>()
  const panelMetrics: PanelMetric[] = [{ width: 1, height: 1, palette: [] }, { width: 1, height: 1, palette: [] }]

  let faceLandmarker: FaceLandmarker | null = null
  let handLandmarker: HandLandmarker | null = null
  let stream: MediaStream | null = null
  let disposed = false
  let starting = false
  let active = false
  let usingCpu = false
  let cpuFallbackInFlight = false
  let animationFrame = 0
  let lastFaceAt = -Infinity
  let lastHandAt = -Infinity
  let lastRenderAt = -Infinity
  let countdownStartedAt = -Infinity
  let roundStartedAt = -Infinity
  let showcaseStartedAt = -Infinity
  let lastStatus = ''
  let pixelRatio = 1

  const say = (message: string) => {
    if (lastStatus === message) return
    lastStatus = message
    status.textContent = message
  }

  const localPoint = (landmark: Landmark): { player: Player; point: Point } => {
    const mirroredX = 1 - landmark.x
    const player: Player = mirroredX < 0.5 ? 1 : 2
    return { player, point: { x: player === 1 ? mirroredX * 2 : (mirroredX - 0.5) * 2, y: landmark.y } }
  }

  const panelForPlayer = (player: Player) => player === 2 ? 0 : 1
  const sourceForPanel = (index: number): Player => Number.isFinite(roundStartedAt) || Number.isFinite(showcaseStartedAt) ? (index === 0 ? 2 : 1) : (index === 0 ? 1 : 2)

  const resize = () => {
    pixelRatio = Math.min(window.devicePixelRatio || 1, dprLimit)
    output.forEach((canvas, index) => {
      const box = canvas.parentElement!.getBoundingClientRect()
      const width = Math.max(1, Math.round(box.width))
      const height = Math.max(1, Math.round(box.height))
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      transition[index].width = canvas.width
      transition[index].height = canvas.height
      const swatch = Math.min(19, Math.max(13, Math.round(width / 20)))
      const gap = Math.max(3, Math.round(swatch * 0.28))
      const allWidth = swatch * COLORS.length + gap * (COLORS.length - 1)
      const start = Math.max(10, (width - allWidth) * 0.5)
      panelMetrics[index] = {
        width,
        height,
        palette: COLORS.map((_, colorIndex) => ({ x: start + colorIndex * (swatch + gap), y: 45, width: swatch, height: swatch })),
      }
    })
  }

  const predictedFace = (player: Player, now: number) => {
    const face = faces.get(player)
    if (!face || now - face.lastSeen > FACE_GRACE) return null
    const elapsed = Math.min(90, Math.max(0, now - face.lastSeen))
    const period = Math.max(1, face.lastSeen - face.previousSeen)
    const factor = Math.min(0.36, elapsed / period)
    return face.landmarks.map((landmark, index) => {
      const previous = face.previous[index] ?? landmark
      return { x: landmark.x + (landmark.x - previous.x) * factor, y: landmark.y + (landmark.y - previous.y) * factor, z: landmark.z + (landmark.z - previous.z) * factor }
    })
  }

  const basisFor = (player: Player, now: number): Basis | null => {
    const landmarks = predictedFace(player, now)
    if (!landmarks) return null
    const left = localPoint(landmarks[234] ?? landmarks[0]).point
    const right = localPoint(landmarks[454] ?? landmarks[0]).point
    const forehead = localPoint(landmarks[10] ?? landmarks[0]).point
    const chin = localPoint(landmarks[152] ?? landmarks[0]).point
    const center = localPoint(landmarks[1] ?? landmarks[0]).point
    const rawX = { x: right.x - left.x, y: right.y - left.y }
    const scale = Math.max(0.055, Math.hypot(rawX.x, rawX.y))
    const xAxis = { x: rawX.x / scale, y: rawX.y / scale }
    const rawY = { x: chin.x - forehead.x, y: chin.y - forehead.y }
    const yScale = Math.max(0.055, Math.hypot(rawY.x, rawY.y))
    const sign = xAxis.x * rawY.y - xAxis.y * rawY.x < 0 ? -1 : 1
    return { center, xAxis, yAxis: { x: -xAxis.y * sign, y: xAxis.x * sign }, scale: (scale + yScale) * 0.5 }
  }

  const drawCameraHalf = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, sourcePlayer: Player) => {
    const width = canvas.width / pixelRatio
    const height = canvas.height / pixelRatio
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.fillStyle = '#19152c'
    context.fillRect(0, 0, width, height)
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return
    const halfWidth = video.videoWidth * 0.5
    const scale = Math.max(width / halfWidth, height / video.videoHeight)
    const drawWidth = halfWidth * scale
    const drawHeight = video.videoHeight * scale
    context.save()
    context.translate(width, 0)
    context.scale(-1, 1)
    context.drawImage(video, sourcePlayer === 1 ? 0 : halfWidth, 0, halfWidth, video.videoHeight, (width - drawWidth) * 0.5, (height - drawHeight) * 0.5, drawWidth, drawHeight)
    context.restore()
  }

  const attachPoint = (target: Player, point: Point, now: number): AttachedPoint | null => {
    const landmarks = predictedFace(target, now)
    const basis = basisFor(target, now)
    if (!landmarks || !basis) return null
    let anchor = 0
    let nearest = Infinity
    landmarks.forEach((landmark, index) => {
      const candidate = localPoint(landmark).point
      const candidateDistance = distance(point, candidate)
      if (candidateDistance < nearest) { nearest = candidateDistance; anchor = index }
    })
    const anchorPoint = localPoint(landmarks[anchor]).point
    const delta = { x: point.x - anchorPoint.x, y: point.y - anchorPoint.y }
    return { anchor, u: (delta.x * basis.xAxis.x + delta.y * basis.xAxis.y) / basis.scale, v: (delta.x * basis.yAxis.x + delta.y * basis.yAxis.y) / basis.scale }
  }

  const restorePoint = (target: Player, point: AttachedPoint, now: number): Point | null => {
    const landmarks = predictedFace(target, now)
    const basis = basisFor(target, now)
    if (!landmarks || !basis || !landmarks[point.anchor]) return null
    const anchor = localPoint(landmarks[point.anchor]).point
    return { x: anchor.x + (basis.xAxis.x * point.u + basis.yAxis.x * point.v) * basis.scale, y: anchor.y + (basis.xAxis.y * point.u + basis.yAxis.y * point.v) * basis.scale }
  }

  const isInsideFace = (target: Player, point: Point, now: number) => {
    const landmarks = predictedFace(target, now)
    const basis = basisFor(target, now)
    if (!landmarks || !basis) return false
    const delta = { x: point.x - basis.center.x, y: point.y - basis.center.y }
    const localX = (delta.x * basis.xAxis.x + delta.y * basis.xAxis.y) / basis.scale
    const localY = (delta.x * basis.yAxis.x + delta.y * basis.yAxis.y) / basis.scale
    return (localX / 0.61) ** 2 + ((localY - 0.04) / 0.8) ** 2 <= 1
  }

  const drawStroke = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, stroke: Stroke, source: Player, now: number) => {
    if (stroke.target !== source || stroke.points.length === 0) return
    const points = stroke.points.map((point) => restorePoint(stroke.target, point, now)).filter((point): point is Point => Boolean(point))
    if (!points.length) return
    const width = canvas.width / pixelRatio
    const height = canvas.height / pixelRatio
    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = stroke.color
    context.lineWidth = Math.max(3, Math.min(width, height) * 0.018)
    context.globalAlpha = 0.94
    context.beginPath()
    points.forEach((point, index) => {
      const x = point.x * width
      const y = point.y * height
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    if (points.length === 1) context.lineTo(points[0].x * width + 0.1, points[0].y * height + 0.1)
    context.stroke()
    context.restore()
  }

  const drawPencil = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, owner: Player, hand: HandState) => {
    const target = other(owner)
    const panelIndex = panelForPlayer(target)
    if (sourceForPanel(panelIndex) !== target || performance.now() - hand.lastSeen > HAND_GRACE) return
    const width = canvas.width / pixelRatio
    const height = canvas.height / pixelRatio
    const tip = { x: hand.point.x * width, y: hand.point.y * height }
    const length = Math.min(width, height) * 0.16
    const angle = owner === 1 ? -0.7 : 0.7
    context.save()
    context.translate(tip.x, tip.y)
    context.rotate(angle)
    context.shadowColor = 'rgba(20, 12, 45, .35)'
    context.shadowBlur = 8
    context.fillStyle = '#29223f'
    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(length * 0.16, -length * 0.1)
    context.lineTo(length * 0.16, length * 0.1)
    context.closePath()
    context.fill()
    context.shadowBlur = 0
    context.fillStyle = '#f5ce77'
    context.fillRect(length * 0.13, -length * 0.075, length * 0.68, length * 0.15)
    context.fillStyle = colors.get(owner) ?? COLORS[0]
    context.fillRect(length * 0.2, -length * 0.05, length * 0.56, length * 0.1)
    context.fillStyle = '#f3b36d'
    context.fillRect(length * 0.77, -length * 0.083, length * 0.12, length * 0.166)
    context.restore()
  }

  const updateLabels = () => {
    const swapped = Number.isFinite(roundStartedAt) || Number.isFinite(showcaseStartedAt)
    labels[0].textContent = swapped ? 'PLAYER 2' : 'PLAYER 1'
    labels[1].textContent = swapped ? 'PLAYER 1' : 'PLAYER 2'
  }

  const drawFrame = (now: number) => {
    output.forEach((canvas, index) => {
      const context = drawContexts[index]
      const source = sourceForPanel(index)
      drawCameraHalf(context, canvas, source)
      strokes.forEach((stroke) => drawStroke(context, canvas, stroke, source, now))
    })
    hands.forEach((hand, owner) => {
      const index = panelForPlayer(other(owner))
      drawPencil(drawContexts[index], output[index], owner, hand)
    })
    updateLabels()
  }

  const updateWaiting = (now: number) => {
    ;([1, 2] as Player[]).forEach((player, index) => waiting[index].classList.toggle('is-hidden', now - (faces.get(player)?.lastSeen ?? -Infinity) <= FACE_GRACE))
  }

  const createLandmarkers = async (delegate: 'GPU' | 'CPU') => {
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    if (disposed) throw new Error('DoodleFace has been disposed.')
    const base = { baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'VIDEO' as const }
    const face = await FaceLandmarker.createFromOptions(vision, { ...base, numFaces: 2, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false })
    try {
      const hand = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2 })
      if (disposed) { hand.close(); throw new Error('DoodleFace has been disposed.') }
      faceLandmarker?.close()
      handLandmarker?.close()
      faceLandmarker = face
      handLandmarker = hand
    } catch (error) {
      face.close()
      throw error
    }
  }

  const retryWithCpu = async () => {
    if (cpuFallbackInFlight || usingCpu || disposed) return
    cpuFallbackInFlight = true
    say('손 인식기를 다시 준비하고 있어요.')
    try {
      await createLandmarkers('CPU')
      usingCpu = true
      say('두 사람이 화면에 나란히 서 주세요.')
    } catch {
      say('모델을 불러오지 못했어요. 다시 시작해 주세요.')
      resetToLobby(true)
    } finally { cpuFallbackInFlight = false }
  }

  const updateFaceInference = (now: number) => {
    if (!faceLandmarker || now - lastFaceAt < faceInterval || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false
    lastFaceAt = now
    try {
      const result = faceLandmarker.detectForVideo(video, now)
      const occupied = new Set<Player>()
      result.faceLandmarks.forEach((raw) => {
        const landmarks = (raw as Landmark[]).map((landmark) => ({ ...landmark }))
        const player = localPoint(landmarks[1] ?? landmarks[0]).player
        if (occupied.has(player)) return
        occupied.add(player)
        const old = faces.get(player)
        const prior = old?.landmarks ?? landmarks
        const smooth = old && old.landmarks.length === landmarks.length
          ? landmarks.map((landmark, index) => ({ x: prior[index].x + (landmark.x - prior[index].x) * 0.66, y: prior[index].y + (landmark.y - prior[index].y) * 0.66, z: prior[index].z + (landmark.z - prior[index].z) * 0.66 }))
          : landmarks
        faces.set(player, { landmarks: smooth, previous: old?.landmarks ?? smooth, lastSeen: now, previousSeen: old?.lastSeen ?? now - faceInterval, stableSince: old && now - old.lastSeen <= FACE_GRACE ? old.stableSince : now })
      })
      return true
    } catch { void retryWithCpu(); return false }
  }

  const paletteColorAt = (owner: Player, point: Point) => {
    const panel = panelForPlayer(owner)
    return panelMetrics[panel].palette.findIndex((box) => point.x * panelMetrics[panel].width >= box.x && point.x * panelMetrics[panel].width <= box.x + box.width && point.y * panelMetrics[panel].height >= box.y && point.y * panelMetrics[panel].height <= box.y + box.height)
  }

  const selectColor = (owner: Player, color: string) => {
    colors.set(owner, color)
    root.querySelectorAll<HTMLButtonElement>(`[data-doodle-player="${owner}"]`).forEach((button) => button.classList.toggle('is-selected', button.dataset.doodleColor === color))
  }

  const appendPoint = (owner: Player, point: Point, now: number) => {
    const stroke = activeStrokes.get(owner)
    if (!stroke) return
    const attached = attachPoint(stroke.target, point, now)
    if (!attached) return
    const previous = stroke.points.at(-1)
    if (previous) {
      const previousPoint = restorePoint(stroke.target, previous, now)
      if (previousPoint && distance(previousPoint, point) < 0.007) return
    }
    stroke.points.push(attached)
  }

  const updateHand = (owner: Player, landmarks: Landmark[], now: number) => {
    const midpoint = localPoint({ x: (landmarks[4].x + landmarks[8].x) * 0.5, y: (landmarks[4].y + landmarks[8].y) * 0.5, z: 0 }).point
    const palm = Math.max(0.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y))
    const ratio = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y) / palm
    const previous = hands.get(owner)
    let pinching = previous?.pinching ?? false
    let releaseSince = previous?.releaseSince ?? -Infinity
    if (!pinching && ratio <= 0.62) { pinching = true; releaseSince = -Infinity }
    if (pinching && ratio >= 0.84) {
      if (!Number.isFinite(releaseSince)) releaseSince = now
      if (now - releaseSince >= 110) pinching = false
    } else if (ratio < 0.84) releaseSince = -Infinity
    const hand = { pinching, point: midpoint, lastSeen: now, releaseSince, ratio }
    hands.set(owner, hand)
    const colorIndex = paletteColorAt(owner, midpoint)
    if (pinching && colorIndex >= 0) {
      selectColor(owner, COLORS[colorIndex])
      activeStrokes.delete(owner)
      return
    }
    if (!Number.isFinite(roundStartedAt)) return
    if (!pinching) { activeStrokes.delete(owner); return }
    const target = other(owner)
    if (!activeStrokes.has(owner)) {
      if (!isInsideFace(target, midpoint, now)) return
      const stroke: Stroke = { owner, target, color: colors.get(owner) ?? COLORS[0], points: [] }
      strokes.push(stroke)
      activeStrokes.set(owner, stroke)
    }
    appendPoint(owner, midpoint, now)
  }

  const updateHandInference = (now: number) => {
    if (!handLandmarker || now - lastHandAt < handInterval || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false
    lastHandAt = now
    try {
      const result = handLandmarker.detectForVideo(video, now)
      const occupied = new Set<Player>()
      result.landmarks.forEach((raw) => {
        const landmarks = raw as Landmark[]
        const owner = localPoint(landmarks[9]).player
        if (occupied.has(owner)) return
        occupied.add(owner)
        updateHand(owner, landmarks, now)
      })
      return true
    } catch { void retryWithCpu(); return false }
  }

  const preserveHands = (now: number) => {
    hands.forEach((hand, owner) => {
      if (now - hand.lastSeen > HAND_GRACE) {
        hands.delete(owner)
        activeStrokes.delete(owner)
      }
    })
  }

  const startSwap = () => {
    output.forEach((canvas, index) => {
      const context = swapContexts[index]
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(canvas, 0, 0)
    })
    transitionLayer.classList.remove('is-active')
    void transitionLayer.offsetWidth
    transitionLayer.classList.add('is-active')
    say('SWAP! 상대 화면으로 이동합니다.')
  }

  const resetToLobby = (keepMessage = false) => {
    active = false
    starting = false
    faces.clear()
    hands.clear()
    activeStrokes.clear()
    strokes.length = 0
    countdownStartedAt = -Infinity
    roundStartedAt = -Infinity
    showcaseStartedAt = -Infinity
    transitionLayer.classList.remove('is-active')
    toast.hidden = true
    game.hidden = true
    lobby.hidden = false
    startButton.disabled = false
    if (!keepMessage) lobbyStatus.textContent = ''
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    faceLandmarker?.close()
    handLandmarker?.close()
    faceLandmarker = null
    handLandmarker = null
    updateLabels()
  }

  const finishRound = (now: number) => {
    if (Number.isFinite(showcaseStartedAt)) return
    showcaseStartedAt = now
    activeStrokes.clear()
    toast.textContent = '완성된 얼굴을 보여주세요'
    toast.hidden = false
    say('서로의 완성된 얼굴을 보여주세요.')
  }

  const maybeAdvance = (now: number) => {
    const first = faces.get(1)
    const second = faces.get(2)
    if (!Number.isFinite(countdownStartedAt) && first && second && now - first.stableSince >= READY_STABLE_MS && now - second.stableSince >= READY_STABLE_MS) {
      countdownStartedAt = now
      say('두 사람 확인! 5초 뒤 화면을 바꿔요.')
    }
    if (Number.isFinite(countdownStartedAt) && !Number.isFinite(roundStartedAt)) {
      const remaining = Math.max(0, 5 - Math.floor((now - countdownStartedAt) / 1000))
      timer.textContent = `READY ${remaining}`
      if (now - countdownStartedAt >= 5000) {
        startSwap()
        roundStartedAt = now + SWAP_MS
      }
    }
    if (Number.isFinite(roundStartedAt) && now >= roundStartedAt) {
      const remaining = Math.max(0, Math.ceil((ROUND_MS - (now - roundStartedAt)) / 1000))
      timer.textContent = `00:${String(remaining).padStart(2, '0')}`
      if (now - roundStartedAt >= ROUND_MS) finishRound(now)
    }
    if (Number.isFinite(showcaseStartedAt)) {
      if (now - showcaseStartedAt >= FINISH_MESSAGE_MS) toast.hidden = true
      if (now - showcaseStartedAt >= SHOWCASE_MS) resetToLobby()
    }
  }

  const loop = (now: number) => {
    if (disposed || !active) return
    const gestureActive = [...hands.values()].some((hand) => hand.pinching && now - hand.lastSeen <= HAND_GRACE)
    const handDue = now - lastHandAt >= handInterval
    const faceDue = now - lastFaceAt >= faceInterval
    if (gestureActive && handDue) updateHandInference(now)
    else if (faceDue) updateFaceInference(now)
    else if (handDue) updateHandInference(now)
    preserveHands(now)
    updateWaiting(now)
    maybeAdvance(now)
    if (now - lastRenderAt >= renderInterval) { drawFrame(now); lastRenderAt = now }
    animationFrame = requestAnimationFrame(loop)
  }

  const startGame = async () => {
    if (starting || active || disposed) return
    if (!window.isSecureContext) { lobbyStatus.textContent = '보안 연결(HTTPS)에서 카메라를 열어 주세요.'; return }
    starting = true
    startButton.disabled = true
    lobbyStatus.textContent = '카메라와 손 인식기를 준비하고 있어요.'
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: lowPower ? 640 : 960 }, height: { ideal: lowPower ? 480 : 720 }, frameRate: { ideal: lowPower ? 24 : 30, max: lowPower ? 24 : 30 } }, audio: false })
      if (disposed) { stream.getTracks().forEach((track) => track.stop()); stream = null; return }
      video.srcObject = stream
      await video.play()
      if (disposed) return
      try { await createLandmarkers('GPU') } catch { usingCpu = true; await createLandmarkers('CPU') }
      if (disposed) return
      lobby.hidden = true
      game.hidden = false
      active = true
      lastFaceAt = -Infinity
      lastHandAt = -Infinity
      lastRenderAt = -Infinity
      say('두 사람이 화면에 나란히 서 주세요.')
      resize()
      animationFrame = requestAnimationFrame(loop)
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      lobbyStatus.textContent = name === 'NotAllowedError' ? '카메라 권한을 허용한 뒤 다시 시도해 주세요.' : '카메라 또는 모델을 준비하지 못했어요. 다시 시도해 주세요.'
      resetToLobby(true)
    } finally { starting = false }
  }

  const onPaletteClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-doodle-player]')
    if (!button?.dataset.doodleColor) return
    selectColor(Number(button.dataset.doodlePlayer) as Player, button.dataset.doodleColor)
  }
  const onHelp = () => { help.hidden = false }
  const closeHelp = () => { help.hidden = true }
  const observer = new ResizeObserver(resize)
  observer.observe(panels)
  startButton.addEventListener('click', startGame)
  helpButton.addEventListener('click', onHelp)
  closeHelpButton.addEventListener('click', closeHelp)
  root.addEventListener('click', onPaletteClick)
  resize()

  return () => {
    disposed = true
    cancelAnimationFrame(animationFrame)
    observer.disconnect()
    startButton.removeEventListener('click', startGame)
    helpButton.removeEventListener('click', onHelp)
    closeHelpButton.removeEventListener('click', closeHelp)
    root.removeEventListener('click', onPaletteClick)
    resetToLobby()
  }
}
