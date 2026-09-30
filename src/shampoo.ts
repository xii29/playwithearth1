import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import { createModelPair } from './model-lifecycle'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const FACE_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`
// This is MediaPipe's real selfie multi-class confidence-mask model. The
// implementation below derives the person confidence from its actual output;
// no landmark outline is ever substituted for a missing HumanSeg frame.
const SELFIE_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/selfie_multiclass.tflite`

type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type CoverFrame = { videoWidth: number; videoHeight: number; drawnWidth: number; drawnHeight: number; offsetX: number; offsetY: number }
type FaceBasis = { x: Point; y: Point; xLength: number; yLength: number; xUnit: Point; yUnit: Point }
type Gesture = 'open' | 'pinch' | 'fist'
type FaceAttachment = { anchor: number; u: number; v: number }
type Bubble = {
  attachment: FaceAttachment | null
  point: Point
  size: number
  phase: number
  born: number
  kind: 'trail' | 'burst'
  falling: boolean
  fallSpeed: number
}
type AmbientBubble = {
  u: number
  v: number
  size: number
  phase: number
  normal: Point
  tangent: Point
  edge: number
}
type HandState = {
  id: string
  point: Point
  gesture: Gesture
  lastSeen: number
  lastTrailPoint: Point | null
  lastBurstPoint: Point | null
  nextBurstAt: number
  burstActive: boolean
}
type WaterDrop = { x: number; y: number; speed: number; size: number; born: number; drift: number }
type WorkerMessage = {
  type: 'ready' | 'result' | 'error'
  landmarks?: Landmark[][]
  handedness?: string[]
  message?: string
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y)
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

export function setupShampoo(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('.shampoo-camera-stage')!
  const video = root.querySelector<HTMLVideoElement>('#shampoo-camera')!
  const canvas = root.querySelector<HTMLCanvasElement>('#shampoo-bubbles')!
  const status = root.querySelector<HTMLElement>('#shampoo-status')!
  const meter = root.querySelector<HTMLElement>('#shampoo-state')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#shampoo-camera-toggle')!
  const showerLever = root.querySelector<HTMLButtonElement>('#shampoo-shower-lever')!
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!context) return () => {}

  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  const maxPixelRatio = lowPowerDevice ? 1.2 : 1.5
  // Denser than the interaction layer, but still capped by device class so the
  // fuller foam silhouette does not turn into a sustained rendering cost.
  const ambientLimit = lowPowerDevice ? 132 : 224
  const permanentLimit = lowPowerDevice ? 390 : 600
  const spriteCache = new Map<number, HTMLCanvasElement>()
  const hands = new Map<string, HandState>()
  let ambient: AmbientBubble[] = []
  let bubbles: Bubble[] = []
  let waterDrops: WaterDrop[] = []
  let face: Landmark[] | null = null
  let faceSeenAt = -Infinity
  let faceInferenceAt = -Infinity
  let segmentInferenceAt = -Infinity
  let handSubmittedAt = -Infinity
  let handBusy = false
  let width = 1
  let height = 1
  let pixelRatio = 1
  let cameraStream: MediaStream | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let segmenter: ImageSegmenter | null = null
  let handWorker: Worker | null = null
  let workerReady = false
  let animationFrame = 0
  let videoFrameRequest = 0
  let cameraRequest = 0
  let disposed = false
  let starting = false
  let cameraActive = false
  let humanSegValid = false
  let lastStatus = ''
  let lastFrameAt = performance.now()
  let rinseUntil = -Infinity
  let showerUntil = -Infinity
  let lastWaterAt = -Infinity
  let leverStartY = 0
  let leverPulling = false
  let leverTriggered = false
  let segmentationValues: Float32Array | null = null
  const attachedPointScratch: Point = { x: 0, y: 0 }

  const say = (message: string) => {
    if (lastStatus === message) return
    lastStatus = message
    status.textContent = message
  }

  const resize = () => {
    const bounds = stage.getBoundingClientRect()
    width = Math.max(1, bounds.width)
    height = Math.max(1, bounds.height)
    pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
  }

  const cover = (): CoverFrame => {
    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawnWidth = videoWidth * scale
    const drawnHeight = videoHeight * scale
    return { videoWidth, videoHeight, drawnWidth, drawnHeight, offsetX: (width - drawnWidth) * .5, offsetY: (height - drawnHeight) * .5 }
  }

  const projectInFrame = (landmark: Landmark | Point, frame: CoverFrame): Point => {
    return {
      x: frame.offsetX + (1 - landmark.x) * frame.drawnWidth,
      y: frame.offsetY + landmark.y * frame.drawnHeight,
    }
  }

  const project = (landmark: Landmark): Point => projectInFrame(landmark, cover())

  const createSprite = (size: number) => {
    const bucket = Math.round(size / 4) * 4
    const cached = spriteCache.get(bucket)
    if (cached) return cached
    const sprite = document.createElement('canvas')
    const padding = 5
    const diameter = bucket * 2 + padding * 2
    sprite.width = diameter * 2
    sprite.height = diameter * 2
    const spriteContext = sprite.getContext('2d')!
    spriteContext.scale(2, 2)
    const center = diameter * 0.5
    const puff = (x: number, y: number, radius: number) => {
      const gradient = spriteContext.createRadialGradient(x - radius * 0.32, y - radius * 0.38, radius * 0.06, x, y, radius)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.42, 'rgba(255,255,255,.97)')
      gradient.addColorStop(0.76, 'rgba(226,238,239,.74)')
      gradient.addColorStop(1, 'rgba(184,207,211,.12)')
      spriteContext.beginPath()
      spriteContext.arc(x, y, radius, 0, Math.PI * 2)
      spriteContext.fillStyle = gradient
      spriteContext.fill()
      spriteContext.lineWidth = Math.max(.65, radius * .07)
      spriteContext.strokeStyle = 'rgba(255,255,255,.9)'
      spriteContext.stroke()
    }
    // Overlapping white puffs give each cached sprite a soft whipped-foam
    // silhouette while retaining the cheap one-draw-per-bubble renderer.
    puff(center + bucket * .12, center + bucket * .15, bucket * .84)
    puff(center - bucket * .31, center + bucket * .05, bucket * .53)
    puff(center + bucket * .12, center - bucket * .34, bucket * .49)
    spriteContext.beginPath()
    spriteContext.ellipse(center - bucket * 0.29, center - bucket * 0.3, bucket * 0.22, bucket * 0.12, -0.55, 0, Math.PI * 2)
    spriteContext.fillStyle = 'rgba(255,255,255,0.68)'
    spriteContext.fill()
    spriteCache.set(bucket, sprite)
    return sprite
  }

  const faceBasis = (frame = cover()): FaceBasis | null => {
    if (!face) return null
    const left = projectInFrame(face[234], frame)
    const right = projectInFrame(face[454], frame)
    const top = projectInFrame(face[10], frame)
    const bottom = projectInFrame(face[152], frame)
    const x = { x: right.x - left.x, y: right.y - left.y }
    const y = { x: bottom.x - top.x, y: bottom.y - top.y }
    const xLength = Math.max(1, Math.hypot(x.x, x.y))
    const yLength = Math.max(1, Math.hypot(y.x, y.y))
    return { x, y, xLength, yLength, xUnit: { x: x.x / xLength, y: x.y / xLength }, yUnit: { x: y.x / yLength, y: y.y / yLength } }
  }

  const attach = (point: Point): FaceAttachment | null => {
    if (!face || performance.now() - faceSeenAt > 260) return null
    const frame = cover()
    const basis = faceBasis(frame)
    if (!basis) return null
    let anchor = 0
    let closest = Infinity
    face.forEach((landmark, index) => {
      const candidateX = frame.offsetX + (1 - landmark.x) * frame.drawnWidth
      const candidateY = frame.offsetY + landmark.y * frame.drawnHeight
      const candidateDistance = Math.hypot(point.x - candidateX, point.y - candidateY)
      if (candidateDistance < closest) { closest = candidateDistance; anchor = index }
    })
    const origin = projectInFrame(face[anchor], frame)
    const deltaX = point.x - origin.x
    const deltaY = point.y - origin.y
    return {
      anchor,
      u: (deltaX * basis.xUnit.x + deltaY * basis.xUnit.y) / basis.xLength,
      v: (deltaX * basis.yUnit.x + deltaY * basis.yUnit.y) / basis.yLength,
    }
  }

  const attachedPoint = (bubble: Bubble, basis: FaceBasis | null, frame: CoverFrame) => {
    if (!bubble.attachment || !face) return bubble.point
    const landmark = face[bubble.attachment.anchor]
    if (!basis || !landmark) return bubble.point
    const originX = frame.offsetX + (1 - landmark.x) * frame.drawnWidth
    const originY = frame.offsetY + landmark.y * frame.drawnHeight
    attachedPointScratch.x = originX + basis.xUnit.x * bubble.attachment.u * basis.xLength + basis.yUnit.x * bubble.attachment.v * basis.yLength
    attachedPointScratch.y = originY + basis.xUnit.y * bubble.attachment.u * basis.xLength + basis.yUnit.y * bubble.attachment.v * basis.yLength
    return attachedPointScratch
  }

  const addBubble = (point: Point, size: number, kind: Bubble['kind'], time: number, falling = false) => {
    bubbles.push({ attachment: falling ? null : attach(point), point: { ...point }, size, phase: Math.random() * Math.PI * 2, born: time, kind, falling, fallSpeed: 32 + Math.random() * 40 })
    if (bubbles.length > permanentLimit) bubbles.splice(0, bubbles.length - permanentLimit)
  }

  const emitTrail = (from: Point | null, to: Point, time: number) => {
    if (!from || !face) return
    const length = distance(from, to)
    const steps = Math.min(24, Math.max(1, Math.ceil(length / 8)))
    for (let index = 1; index <= steps; index += 1) {
      const ratio = index / steps
      const point = { x: lerp(from.x, to.x, ratio), y: lerp(from.y, to.y, ratio) }
      addBubble(point, 3.5 + Math.random() * 3.5, 'trail', time, !isNearFace(point))
    }
  }

  const emitBurst = (center: Point, time: number, falling = false) => {
    const count = lowPowerDevice ? 15 : 23
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.42
      const radius = (9 + Math.random() * 42) * (index % 3 === 0 ? 1.18 : 1)
      const point = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
      // No mark outside the facial area may become face-attached. It instead
      // gets a short, gravity-driven exit so the gesture path stays legible.
      addBubble(point, 6 + Math.random() * 8, 'burst', time, falling || !isNearFace(point))
    }
  }

  const isNearFace = (point: Point) => {
    if (!face || performance.now() - faceSeenAt > 330) return false
    const frame = cover()
    const left = projectInFrame(face[234], frame); const right = projectInFrame(face[454], frame); const top = projectInFrame(face[10], frame); const bottom = projectInFrame(face[152], frame)
    const faceHeight = Math.max(1, Math.abs(bottom.y - top.y))
    const center = { x: (left.x + right.x) * 0.5, y: top.y + faceHeight * 0.18 }
    const radiusX = Math.max(1, Math.abs(right.x - left.x) * 0.74)
    const radiusY = faceHeight * 1.02
    return ((point.x - center.x) / radiusX) ** 2 + ((point.y - center.y) / radiusY) ** 2 < 1
  }

  const emitBurstPath = (from: Point | null, to: Point, time: number) => {
    if (!from) { emitBurst(to, time, !isNearFace(to)); return }
    const steps = Math.min(8, Math.max(1, Math.ceil(distance(from, to) / 54)))
    for (let index = 1; index <= steps; index += 1) {
      const ratio = index / steps
      // Outside the face we deliberately retain a free camera-space bubble;
      // this keeps a held fist's path continuous until the hand opens.
      const point = { x: lerp(from.x, to.x, ratio), y: lerp(from.y, to.y, ratio) }
      emitBurst(point, time, !isNearFace(point))
    }
  }

  const gestureFor = (landmarks: Landmark[], previous: Gesture): Gesture => {
    const thumb = landmarks[4]; const index = landmarks[8]
    const palm = Math.max(0.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y))
    const pinch = Math.hypot(thumb.x - index.x, thumb.y - index.y) / palm
    // A Pinch is deliberately only thumb + index. Middle, ring, and little
    // fingers are ignored while this pair is closed, so they cannot turn a
    // Pinch pose into a competing three-finger/fist reading.
    if (pinch < (previous === 'pinch' ? 0.5 : 0.4)) return 'pinch'
    const tips = [8, 12, 16, 20]
    const curl = tips.reduce((sum, indexTip) => sum + Math.hypot(landmarks[indexTip].x - landmarks[0].x, landmarks[indexTip].y - landmarks[0].y) / palm, 0) / tips.length
    if (curl < (previous === 'fist' ? 1.7 : 1.48)) return 'fist'
    return 'open'
  }

  const processHands = (rawHands: Landmark[][], labels: string[], time: number) => {
    const seen = new Set<string>()
    const detected: { id: string; landmarks: Landmark[]; gesture: Gesture }[] = []
    rawHands.forEach((landmarks, index) => {
      if (landmarks.length < 21) return
      const label = labels[index] === 'left' ? 'left' : labels[index] === 'right' ? 'right' : `hand-${index}`
      const id = seen.has(label) ? `${label}-${index}` : label
      seen.add(id)
      const existing = hands.get(id)
      detected.push({ id, landmarks, gesture: gestureFor(landmarks, existing?.gesture ?? 'open') })
    })
    const pinchPresent = detected.some((hand) => hand.gesture === 'pinch')
    detected.forEach(({ id, landmarks, gesture }) => {
      const existing = hands.get(id)
      const nextGesture = gesture
      const pinchPoint = project({ x: (landmarks[4].x + landmarks[8].x) * 0.5, y: (landmarks[4].y + landmarks[8].y) * 0.5, z: (landmarks[4].z + landmarks[8].z) * 0.5 })
      const center = nextGesture === 'pinch' ? pinchPoint : project(landmarks[9])
      const hand: HandState = existing ?? { id, point: center, gesture: 'open', lastSeen: time, lastTrailPoint: null, lastBurstPoint: null, nextBurstAt: time, burstActive: false }
      const previousPoint = hand.point
      hand.point = center
      hand.lastSeen = time
      if (nextGesture === 'pinch') {
        emitTrail(hand.gesture === 'pinch' ? hand.lastTrailPoint ?? previousPoint : previousPoint, center, time)
        hand.lastTrailPoint = center
        hand.lastBurstPoint = null
      } else if (nextGesture === 'fist' && !pinchPresent) {
        if (hand.gesture !== 'fist') {
          hand.nextBurstAt = time
          hand.lastBurstPoint = previousPoint
          hand.burstActive = isNearFace(center)
        }
        if (!hand.burstActive && isNearFace(center)) hand.burstActive = true
        if (hand.burstActive && time >= hand.nextBurstAt) {
          emitBurstPath(hand.lastBurstPoint, center, time)
          hand.lastBurstPoint = center
          hand.nextBurstAt = time + 360 + Math.random() * 100
        }
        hand.lastTrailPoint = null
      } else {
        hand.lastTrailPoint = null
        hand.lastBurstPoint = null
        hand.burstActive = false
      }
      hand.gesture = nextGesture
      hands.set(id, hand)
    })
    for (const [id, hand] of hands) if (!seen.has(id) && time - hand.lastSeen > 210) hands.delete(id)
  }

  const updateFace = (time: number, gestureActive: boolean) => {
    const interval = 1000 / (gestureActive ? (lowPowerDevice ? 10 : 13) : (lowPowerDevice ? 13 : 17))
    if (!faceLandmarker || time - faceInferenceAt < interval) return false
    faceInferenceAt = time
    const result = faceLandmarker.detectForVideo(video, time)
    const detected = result.faceLandmarks[0] as Landmark[] | undefined
    if (!detected?.length) return true
    if (!face || face.length !== detected.length) face = detected.map((item) => ({ ...item }))
    else detected.forEach((item, index) => {
      face![index].x = lerp(face![index].x, item.x, 0.58)
      face![index].y = lerp(face![index].y, item.y, 0.58)
      face![index].z = lerp(face![index].z, item.z, 0.58)
    })
    faceSeenAt = time
    return true
  }

  const makeAmbient = (mask: Float32Array, maskWidth: number, maskHeight: number) => {
    if (performance.now() < rinseUntil) { ambient = []; humanSegValid = true; return }
    if (!face) { humanSegValid = false; ambient = []; return }
    const forehead = project(face[10]).y
    const left = project(face[234]); const right = project(face[454]); const bottom = project(face[152])
    const frame = cover()
    const rawY = (screenY: number) => clamp((screenY - (height - frame.drawnHeight) * 0.5) / frame.drawnHeight, 0, 1)
    const rawX = (screenX: number) => clamp(1 - (screenX - (width - frame.drawnWidth) * 0.5) / frame.drawnWidth, 0, 1)
    const top = rawY(forehead - Math.abs(bottom.y - forehead) * 0.88)
    const lower = rawY(forehead + Math.abs(bottom.y - forehead) * 0.11)
    const faceSpan = Math.abs(right.x - left.x)
    const leftBound = rawX(Math.min(left.x, right.x) - faceSpan * 0.4)
    const rightBound = rawX(Math.max(left.x, right.x) + faceSpan * 0.4)
    const minX = Math.floor(Math.min(leftBound, rightBound) * (maskWidth - 1))
    const maxX = Math.ceil(Math.max(leftBound, rightBound) * (maskWidth - 1))
    const minY = Math.floor(top * (maskHeight - 1))
    const maxY = Math.ceil(lower * (maskHeight - 1))
    const candidates: { x: number; y: number; value: number }[] = []
    for (let y = clamp(minY, 1, maskHeight - 2); y <= clamp(maxY, 1, maskHeight - 2); y += 3) for (let x = clamp(minX, 1, maskWidth - 2); x <= clamp(maxX, 1, maskWidth - 2); x += 3) {
      const value = mask[y * maskWidth + x]
      if (Number.isFinite(value) && value >= 0.53) candidates.push({ x, y, value })
    }
    if (candidates.length < 18) { humanSegValid = false; ambient = []; return }
    const threshold = 0.53
    const boundaries: { x: number; y: number; normal: Point }[] = []
    for (let y = clamp(minY, 2, maskHeight - 3); y <= clamp(maxY, 2, maskHeight - 3); y += 2) for (let x = clamp(minX, 2, maskWidth - 3); x <= clamp(maxX, 2, maskWidth - 3); x += 2) {
      const value = mask[y * maskWidth + x]
      const neighbor = Math.min(mask[y * maskWidth + x - 1], mask[y * maskWidth + x + 1], mask[(y - 1) * maskWidth + x], mask[(y + 1) * maskWidth + x])
      if (value < threshold || neighbor >= threshold) continue
      const gx = mask[y * maskWidth + x + 1] - mask[y * maskWidth + x - 1]
      const gy = mask[(y + 1) * maskWidth + x] - mask[(y - 1) * maskWidth + x]
      const length = Math.max(0.0001, Math.hypot(gx, gy))
      boundaries.push({ x, y, normal: { x: gx / length, y: gy / length } })
    }
    if (!boundaries.length) { humanSegValid = false; ambient = []; return }
    humanSegValid = true
    const next: AmbientBubble[] = []
    for (let index = 0; index < ambientLimit; index += 1) {
      const candidate = candidates[(index * 47 + Math.floor(index / 7) * 19) % candidates.length]
      let closest = boundaries[0]
      let closestDistance = Infinity
      boundaries.forEach((boundary) => {
        const distanceSquared = (boundary.x - candidate.x) ** 2 + (boundary.y - candidate.y) ** 2
        if (distanceSquared < closestDistance) { closestDistance = distanceSquared; closest = boundary }
      })
      const normal = closest.normal
      const edge = clamp(1 - Math.sqrt(closestDistance) / 16, 0, 1)
      next.push({
        u: candidate.x / (maskWidth - 1), v: candidate.y / (maskHeight - 1), size: 5 + ((index * 13) % 13), phase: index * 1.71,
        normal, tangent: { x: -normal.y, y: normal.x }, edge,
      })
    }
    ambient = next
  }

  const updateSegmentation = (time: number, gestureActive: boolean) => {
    const interval = gestureActive ? (lowPowerDevice ? 520 : 390) : (lowPowerDevice ? 260 : 180)
    if (!segmenter || time - segmentInferenceAt < interval || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    segmentInferenceAt = time
    const result = segmenter.segmentForVideo(video, time)
    try {
      const masks = result.confidenceMasks
      if (!masks?.length) { humanSegValid = false; ambient = []; return }
      const primary = masks[0]
      const first = primary.getAsFloat32Array()
      if (!segmentationValues || segmentationValues.length !== first.length) segmentationValues = new Float32Array(first.length)
      const values = segmentationValues
      if (masks.length > 1) {
        // The selfie model's first class is background; invert it to retain
        // its true person confidence rather than manufacturing a contour.
        for (let index = 0; index < first.length; index += 1) values[index] = 1 - first[index]
      } else values.set(first)
      makeAmbient(values, primary.width, primary.height)
    } catch {
      humanSegValid = false
      ambient = []
    } finally {
      result.close()
    }
  }

  const submitHandFrame = (time: number, priority: 'pinch' | 'fist' | 'idle') => {
    const interval = priority === 'pinch' ? (lowPowerDevice ? 52 : 38) : priority === 'fist' ? (lowPowerDevice ? 68 : 50) : (lowPowerDevice ? 94 : 70)
    if (!handWorker || !workerReady || handBusy || time - handSubmittedAt < interval || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    handSubmittedAt = time
    handBusy = true
    void createImageBitmap(video).then((bitmap) => handWorker?.postMessage({ type: 'frame', bitmap, timestamp: time }, [bitmap])).catch(() => { handBusy = false })
  }

  const continueGraceGestures = (time: number, pinchActive: boolean) => {
    if (pinchActive) return
    hands.forEach((hand) => {
      if (time - hand.lastSeen > 210 || hand.gesture !== 'fist' || !hand.burstActive || time < hand.nextBurstAt) return
      emitBurstPath(hand.lastBurstPoint, hand.point, time)
      hand.lastBurstPoint = hand.point
      hand.nextBurstAt = time + 360 + Math.random() * 100
    })
  }

  const rinseFoam = (time: number) => {
    if (!cameraActive) { say('카메라를 시작한 뒤 샤워 레버를 당겨 주세요.'); return }
    rinseUntil = time + 2400
    showerUntil = time + 1550
    lastWaterAt = -Infinity
    ambient = []
    bubbles = []
    hands.forEach((hand) => { hand.lastTrailPoint = null; hand.lastBurstPoint = null; hand.burstActive = false })
    root.classList.add('is-rinsing')
    say('샤워 중… 거품을 씻어내고 있어요.')
  }

  const emitWater = (time: number) => {
    if (time >= showerUntil || time - lastWaterAt < 48) return
    lastWaterAt = time
    const count = lowPowerDevice ? 5 : 8
    for (let index = 0; index < count; index += 1) {
      waterDrops.push({ x: Math.random() * width, y: -18 - Math.random() * height * 0.16, speed: 530 + Math.random() * 390, size: 1.7 + Math.random() * 3.2, born: time, drift: (Math.random() - 0.5) * 24 })
    }
    if (waterDrops.length > 150) waterDrops.splice(0, waterDrops.length - 150)
  }

  const drawWater = (time: number) => {
    let nextDropIndex = 0
    waterDrops.forEach((drop) => {
      if (time - drop.born < 1450 && drop.y + (time - drop.born) * drop.speed / 1000 < height + 34) waterDrops[nextDropIndex++] = drop
    })
    waterDrops.length = nextDropIndex
    context.save()
    context.lineCap = 'round'
    waterDrops.forEach((drop) => {
      const age = time - drop.born
      const y = drop.y + age * drop.speed / 1000
      const x = drop.x + Math.sin(age * .01) * drop.drift
      const alpha = clamp(1 - Math.max(0, age - 1050) / 400, 0, 1)
      context.strokeStyle = `rgba(210, 250, 255, ${0.34 * alpha})`
      context.lineWidth = Math.max(1, drop.size * .48)
      context.beginPath()
      context.moveTo(x, y - drop.size * 4.5)
      context.lineTo(x, y)
      context.stroke()
      context.fillStyle = `rgba(239, 253, 255, ${0.62 * alpha})`
      context.beginPath()
      context.arc(x, y, drop.size, 0, Math.PI * 2)
      context.fill()
    })
    context.restore()
  }

  const draw = (time: number) => {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.fillStyle = '#183342'
    context.fillRect(0, 0, width, height)
    const frame = cover()
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.save()
      context.translate(width, 0); context.scale(-1, 1)
      context.drawImage(video, frame.offsetX, frame.offsetY, frame.drawnWidth, frame.drawnHeight)
      context.restore()
    }
    if (humanSegValid && time >= rinseUntil) {
      ambient.forEach((bubble) => {
        const pointX = frame.offsetX + (1 - bubble.u) * frame.drawnWidth
        const pointY = frame.offsetY + bubble.v * frame.drawnHeight
        const wave = Math.sin(time * 0.00125 + bubble.phase)
        const bob = Math.cos(time * 0.0017 + bubble.phase) * 1.4
        const edgePush = bubble.edge * (2.5 + Math.sin(time * 0.001 + bubble.phase) * 1.2)
        const positionX = pointX - bubble.tangent.x * wave * 2 - bubble.normal.x * (bob + edgePush)
        const positionY = pointY + bubble.tangent.y * wave * 2 + bubble.normal.y * (bob + edgePush)
        const sprite = createSprite(bubble.size)
        // Double the default head foam only; keep sprite caching and counts.
        const diameter = (bubble.size * 2 + 10) * 2
        context.globalAlpha = 0.81 + bubble.edge * 0.15
        context.drawImage(sprite, positionX - diameter * 0.5, positionY - diameter * 0.5, diameter, diameter)
      })
    }
    let nextBubbleIndex = 0
    bubbles.forEach((bubble) => {
      if (!bubble.falling || (time - bubble.born < 1900 && bubble.point.y + (time - bubble.born) * bubble.fallSpeed / 1000 < height + 44)) bubbles[nextBubbleIndex++] = bubble
    })
    bubbles.length = nextBubbleIndex
    const basis = faceBasis(frame)
    bubbles.forEach((bubble) => {
      const lifetime = time - bubble.born
      const attached = attachedPoint(bubble, basis, frame)
      const pointX = bubble.falling ? attached.x + Math.sin(lifetime * 0.009 + bubble.phase) * 3 : attached.x
      const pointY = bubble.falling ? attached.y + lifetime * bubble.fallSpeed / 1000 + lifetime * lifetime * 0.000018 : attached.y
      const age = Math.min(1, lifetime / 220)
      const pulse = 1 + Math.sin(time * 0.003 + bubble.phase) * 0.045
      const size = bubble.size * pulse * (0.6 + age * 0.4)
      const sprite = createSprite(size)
      const diameter = size * 2 + 10
      const fade = bubble.falling ? clamp(1 - Math.max(0, lifetime - 950) / 950, 0, 1) : 1
      context.globalAlpha = (bubble.kind === 'trail' ? 0.86 : 0.93) * fade
      context.drawImage(sprite, pointX - diameter * 0.5, pointY - diameter * 0.5, diameter, diameter)
    })
    drawWater(time)
    context.globalAlpha = 1
  }

  const scheduleNextFrame = () => {
    if (disposed || !cameraActive) return
    if ('requestVideoFrameCallback' in video) {
      videoFrameRequest = video.requestVideoFrameCallback((time) => {
        videoFrameRequest = 0
        loop(time)
      })
    } else animationFrame = requestAnimationFrame(loop)
  }

  const cancelScheduledFrame = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = 0
    if (videoFrameRequest && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(videoFrameRequest)
    videoFrameRequest = 0
  }

  const loop = (time: number) => {
    if (disposed || !cameraActive) return
    animationFrame = 0
    videoFrameRequest = 0
    if (document.hidden) { scheduleNextFrame(); return }
    let pinchActive = false
    let fistActive = false
    hands.forEach((hand) => {
      if (time - hand.lastSeen > 210) return
      if (hand.gesture === 'pinch') pinchActive = true
      else if (hand.gesture === 'fist') fistActive = true
    })
    if (pinchActive) fistActive = false
    const activeGesture = pinchActive || fistActive
    emitWater(time)
    continueGraceGestures(time, pinchActive)
    const faceRan = updateFace(time, activeGesture)
    if (!faceRan) updateSegmentation(time, activeGesture)
    submitHandFrame(time, pinchActive ? 'pinch' : fistActive ? 'fist' : 'idle')
    draw(time)
    lastFrameAt = time
    if (time >= rinseUntil) root.classList.remove('is-rinsing')
    meter.textContent = time < rinseUntil ? 'RINSING' : pinchActive ? 'PINCH FOAM' : fistActive ? 'FOAM BURST' : humanSegValid ? 'SELFIE MASK' : 'SCANNING'
    scheduleNextFrame()
  }

  const startCamera = async () => {
    if (starting || cameraActive || disposed) return
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true
    say('카메라와 HumanSeg를 준비하고 있어요…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (disposed || request !== cameraRequest) { stream.getTracks().forEach((track) => track.stop()); return }
      cameraStream = stream
      video.srcObject = stream
      await video.play()
      if (disposed || request !== cameraRequest) return
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
      if (disposed || request !== cameraRequest) return
      const [nextFace, nextSegmenter] = await createModelPair(
        FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.55, minTrackingConfidence: 0.5 }),
        ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: SELFIE_MODEL }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false }),
      )
      if (disposed || request !== cameraRequest) { nextFace.close(); nextSegmenter.close(); return }
      faceLandmarker = nextFace
      segmenter = nextSegmenter
      handWorker = new Worker(new URL('./shampoo-hand.worker.ts', import.meta.url), { type: 'module' })
      handWorker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
        const message = event.data
        if (message.type === 'ready') { workerReady = true; say('핀치로 거품을 남기고, 주먹으로 거품을 퍼뜨려 보세요.') }
        if (message.type === 'result') { handBusy = false; processHands(message.landmarks ?? [], message.handedness ?? [], performance.now()) }
        if (message.type === 'error') { handBusy = false; if (!workerReady) say('손 인식기를 준비하지 못했어요. 카메라를 다시 시작해 주세요.') }
      })
      handWorker.postMessage({ type: 'init' })
      cameraActive = true
      root.classList.add('is-camera-active')
      toggleButton.textContent = '카메라 종료'
      toggleButton.classList.add('is-active')
      cancelScheduledFrame()
      lastFrameAt = performance.now()
      animationFrame = requestAnimationFrame(loop)
    } catch {
      say('카메라 또는 AI 모델을 시작하지 못했어요. 권한과 네트워크를 확인해 주세요.')
      cameraStream?.getTracks().forEach((track) => track.stop())
      cameraStream = null
    } finally {
      starting = false
      toggleButton.disabled = false
    }
  }

  const stopCamera = () => {
    cameraRequest += 1
    cameraActive = false
    cancelScheduledFrame()
    handWorker?.postMessage({ type: 'close' })
    handWorker?.terminate()
    handWorker = null
    workerReady = false
    handBusy = false
    faceLandmarker?.close(); faceLandmarker = null
    segmenter?.close(); segmenter = null
    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = null
    video.srcObject = null
    hands.clear(); ambient = []; bubbles = []; waterDrops = []; humanSegValid = false
    rinseUntil = -Infinity; showerUntil = -Infinity
    root.classList.remove('is-rinsing')
    root.classList.remove('is-camera-active')
    toggleButton.textContent = '카메라 시작'
    toggleButton.classList.remove('is-active')
    meter.textContent = 'READY'
    draw(performance.now())
  }

  const onToggle = () => { if (cameraActive) stopCamera(); else void startCamera() }
  const onLeverDown = (event: PointerEvent) => {
    leverPulling = true
    leverTriggered = false
    leverStartY = event.clientY
    showerLever.setPointerCapture(event.pointerId)
    showerLever.classList.add('is-pulling')
  }
  const onLeverMove = (event: PointerEvent) => {
    if (!leverPulling) return
    const pull = clamp((event.clientY - leverStartY) / 64, 0, 1)
    showerLever.style.setProperty('--pull', `${pull}`)
    if (pull >= 0.55 && !leverTriggered) { leverTriggered = true; rinseFoam(performance.now()) }
  }
  const onLeverUp = (event: PointerEvent) => {
    if (!leverPulling) return
    leverPulling = false
    if (showerLever.hasPointerCapture(event.pointerId)) showerLever.releasePointerCapture(event.pointerId)
    showerLever.classList.remove('is-pulling')
    showerLever.style.setProperty('--pull', '0')
  }
  const onLeverClick = () => {
    if (leverTriggered) { leverTriggered = false; return }
    rinseFoam(performance.now())
  }
  const observer = new ResizeObserver(() => {
    resize()
    if (!cameraActive) draw(performance.now())
  })
  observer.observe(stage)
  resize()
  draw(lastFrameAt)
  toggleButton.addEventListener('click', onToggle)
  showerLever.addEventListener('pointerdown', onLeverDown)
  showerLever.addEventListener('pointermove', onLeverMove)
  showerLever.addEventListener('pointerup', onLeverUp)
  showerLever.addEventListener('pointercancel', onLeverUp)
  showerLever.addEventListener('click', onLeverClick)
  say('카메라를 켠 뒤 핀치 또는 주먹 제스처를 해 보세요.')

  return () => {
    disposed = true
    observer.disconnect()
    toggleButton.removeEventListener('click', onToggle)
    showerLever.removeEventListener('pointerdown', onLeverDown)
    showerLever.removeEventListener('pointermove', onLeverMove)
    showerLever.removeEventListener('pointerup', onLeverUp)
    showerLever.removeEventListener('pointercancel', onLeverUp)
    showerLever.removeEventListener('click', onLeverClick)
    stopCamera()
  }
}
