import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const FACE_MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`
const SANRIO_CHARACTERS = ['hello-kitty', 'cinnamoroll', 'kuromi', 'my-melody', 'pompompurin', 'keroppi'] as const
const CHARACTER_HUES: Record<SanrioCharacter, number> = {
  'hello-kitty': 350,
  cinnamoroll: 198,
  kuromi: 278,
  'my-melody': 335,
  pompompurin: 42,
  keroppi: 118,
}

type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type SanrioCharacter = typeof SANRIO_CHARACTERS[number]
type TrackedHand = {
  id: string
  indexTip: Point
  pinch: Point
  pinching: boolean
  lastSeen: number
}
type Balloon = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  character: SanrioCharacter
  hue: number
  saturation: number
  lightness: number
  buoyancy: number
  phase: number
  stringLength: number
  stringAngle: number
  heldBy: string | null
  grabRatio: number
  depthProgress: number
  mouthCooldownUntil: number
}
type Fragment = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  spin: number
  age: number
  lifetime: number
  hue: number
  saturation: number
  lightness: number
}
type BalloonAsset = { image: HTMLImageElement; sprite: HTMLCanvasElement; ready: boolean }

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y)

function closestPointOnSegment(point: Point, start: Point, end: Point) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const ratio = lengthSquared > 0
    ? clamp(((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared, 0, 1)
    : 0
  const closest = { x: start.x + deltaX * ratio, y: start.y + deltaY * ratio }
  return { distance: distance(point, closest), ratio }
}

export function setupBalloon(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('.balloon-camera-stage')!
  const video = root.querySelector<HTMLVideoElement>('#balloon-camera')!
  const canvas = root.querySelector<HTMLCanvasElement>('#balloon-overlay')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#balloon-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#balloon-status')!
  const poppedCount = root.querySelector<HTMLElement>('#balloon-popped-count')!
  // The camera remains in the video layer below this transparent canvas.
  // Keeping the overlay transparent avoids copying a full video frame into a
  // second canvas on every animation frame.
  const context = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!context) return () => {}

  const makeBalloonAsset = (path: string): BalloonAsset => {
    const image = new Image()
    const sprite = document.createElement('canvas')
    const asset: BalloonAsset = { image, sprite, ready: false }
    image.addEventListener('load', () => {
      const source = document.createElement('canvas')
      source.width = image.naturalWidth
      source.height = image.naturalHeight
      const sourceContext = source.getContext('2d')
      if (!sourceContext) return
      sourceContext.drawImage(image, 0, 0)
      const pixels = sourceContext.getImageData(0, 0, source.width, source.height)
      const visited = new Uint8Array(source.width * source.height)
      const queue = new Int32Array(source.width * source.height)
      let head = 0
      let tail = 0
      const isWhiteBackground = (index: number) => pixels.data[index * 4] > 230 && pixels.data[index * 4 + 1] > 230 && pixels.data[index * 4 + 2] > 230
      const enqueue = (index: number) => { if (!visited[index] && isWhiteBackground(index)) { visited[index] = 1; queue[tail++] = index } }
      for (let x = 0; x < source.width; x += 1) { enqueue(x); enqueue((source.height - 1) * source.width + x) }
      for (let y = 1; y < source.height - 1; y += 1) { enqueue(y * source.width); enqueue(y * source.width + source.width - 1) }
      while (head < tail) {
        const index = queue[head++]
        const x = index % source.width
        const y = Math.floor(index / source.width)
        pixels.data[index * 4 + 3] = 0
        if (x > 0) enqueue(index - 1)
        if (x + 1 < source.width) enqueue(index + 1)
        if (y > 0) enqueue(index - source.width)
        if (y + 1 < source.height) enqueue(index + source.width)
      }
      for (let y = 1; y < source.height - 1; y += 1) for (let x = 1; x < source.width - 1; x += 1) {
        const index = y * source.width + x
        const pixelIndex = index * 4
        if (pixels.data[pixelIndex + 3] === 0) continue
        const lightestChannel = Math.min(pixels.data[pixelIndex], pixels.data[pixelIndex + 1], pixels.data[pixelIndex + 2])
        const touchesTransparentPixel = pixels.data[(index - 1) * 4 + 3] === 0 || pixels.data[(index + 1) * 4 + 3] === 0 || pixels.data[(index - source.width) * 4 + 3] === 0 || pixels.data[(index + source.width) * 4 + 3] === 0
        if (touchesTransparentPixel && lightestChannel > 185) pixels.data[pixelIndex + 3] = Math.round(pixels.data[pixelIndex + 3] * clamp((255 - lightestChannel) / 70, 0.16, 1))
      }
      sourceContext.putImageData(pixels, 0, 0)
      let left = source.width
      let top = source.height
      let right = 0
      let bottom = 0
      for (let index = 0; index < source.width * source.height; index += 1) {
        if (pixels.data[index * 4 + 3] < 20) continue
        const x = index % source.width
        const y = Math.floor(index / source.width)
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
      }
      const padding = 10
      left = Math.max(0, left - padding); top = Math.max(0, top - padding); right = Math.min(source.width - 1, right + padding); bottom = Math.min(source.height - 1, bottom + padding)
      sprite.width = Math.max(1, right - left + 1)
      sprite.height = Math.max(1, bottom - top + 1)
      sprite.getContext('2d')?.drawImage(source, left, top, sprite.width, sprite.height, 0, 0, sprite.width, sprite.height)
      asset.ready = true
    })
    image.src = path
    return asset
  }
  const balloonAssets = [
    makeBalloonAsset('/balloon/1.png'), makeBalloonAsset('/balloon/2.png'),
    makeBalloonAsset('/balloon/3.png'), makeBalloonAsset('/balloon/4.png'),
  ]

  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  // Balloon motion is display-rate interpolated. Lower landmark cadence avoids
  // hand and face models competing for the UI thread every frame.
  const inferenceInterval = 1000 / (lowPowerDevice ? 20 : 24)
  const faceInferenceInterval = 1000 / (lowPowerDevice ? 9 : 12)
  const maximumPixelRatio = lowPowerDevice ? 1.25 : 1.55
  const maximumBalloons = lowPowerDevice ? 13 : 18

  let landmarker: HandLandmarker | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
  let cameraStream: MediaStream | null = null
  let animationFrame = 0
  let disposed = false
  let starting = false
  let cameraActive = false
  let cameraRequest = 0
  let width = 1
  let height = 1
  let pixelRatio = 1
  let lastVideoTime = -1
  let lastDetectionTime = -Infinity
  let lastFaceVideoTime = -1
  let lastFaceDetectionTime = -Infinity
  let lastFrameTime = performance.now()
  let spawnTimer = 0.2
  let nextBalloonId = 1
  let totalPopped = 0
  let statusLockedUntil = 0
  let lastStatus = ''
  let balloons: Balloon[] = []
  let fragments: Fragment[] = []
  let mouth: { point: Point; makingO: boolean; lastSeen: number } | null = null
  let characterBag: SanrioCharacter[] = []
  const hands = new Map<string, TrackedHand>()

  const say = (message: string, lockMilliseconds = 0) => {
    if (lockMilliseconds > 0) statusLockedUntil = performance.now() + lockMilliseconds
    if (lastStatus === message) return
    lastStatus = message
    status.textContent = message
  }

  const resize = () => {
    const bounds = stage.getBoundingClientRect()
    const nextWidth = Math.max(1, bounds.width)
    const nextHeight = Math.max(1, bounds.height)
    if (width > 1 && height > 1) {
      const scaleX = nextWidth / width
      const scaleY = nextHeight / height
      balloons.forEach((balloon) => {
        balloon.x *= scaleX
        balloon.y *= scaleY
        balloon.stringLength = clamp(Math.min(nextWidth, nextHeight) * 0.145, 72, 112)
      })
      fragments.forEach((fragment) => { fragment.x *= scaleX; fragment.y *= scaleY })
    }
    width = nextWidth
    height = nextHeight
    pixelRatio = Math.min(window.devicePixelRatio || 1, maximumPixelRatio)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
  }

  const project = (landmark: Landmark): Point => {
    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawnWidth = videoWidth * scale
    const drawnHeight = videoHeight * scale
    return {
      x: (width - drawnWidth) * 0.5 + (1 - landmark.x) * drawnWidth,
      y: (height - drawnHeight) * 0.5 + landmark.y * drawnHeight,
    }
  }

  const nextCharacter = () => {
    if (!characterBag.length) {
      characterBag = [...SANRIO_CHARACTERS]
      for (let index = characterBag.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        ;[characterBag[index], characterBag[swapIndex]] = [characterBag[swapIndex], characterBag[index]]
      }
    }
    return characterBag.pop()!
  }

  const makeBalloon = (): Balloon => {
    const radius = clamp(Math.min(width, height) * (0.047 + Math.random() * 0.052), 31, 76)
    const margin = radius * 0.9
    const character = nextCharacter()
    const hue = CHARACTER_HUES[character] + (Math.random() - 0.5) * 5
    return {
      id: nextBalloonId++,
      x: margin + Math.random() * Math.max(1, width - margin * 2),
      y: height + radius * (1.15 + Math.random() * 0.7),
      vx: (Math.random() - 0.5) * 20,
      vy: -(26 + Math.random() * 27),
      radius,
      character,
      hue,
      saturation: 68 + Math.random() * 17,
      lightness: 50 + Math.random() * 10,
      buoyancy: 30 + Math.random() * 24,
      phase: Math.random() * Math.PI * 2,
      stringLength: clamp(Math.min(width, height) * 0.145, 72, 112),
      stringAngle: 0,
      heldBy: null,
      grabRatio: 1,
      depthProgress: 0,
      mouthCooldownUntil: 0,
    }
  }

  const bodyRadiusX = (balloon: Balloon) => balloon.radius * (
    balloon.character === 'cinnamoroll' ? 1.42
      : balloon.character === 'pompompurin' ? 1.15
        : balloon.character === 'keroppi' ? 1.08
          : 1
  )
  const bodyRadiusY = (balloon: Balloon) => balloon.radius * (
    balloon.character === 'kuromi' || balloon.character === 'my-melody' ? 1.42 : 1.08
  )
  const knotDistance = (balloon: Balloon) => balloon.radius * 1.04
  const getDepthScale = (balloon: Balloon) => {
    if (balloon.depthProgress <= 0) return 1
    const approachEnd = 0.34
    if (balloon.depthProgress < approachEnd) {
      const progress = balloon.depthProgress / approachEnd
      return 1 + 0.92 * (1 - (1 - progress) ** 3)
    }
    const progress = (balloon.depthProgress - approachEnd) / (1 - approachEnd)
    return 1 + 0.92 * (1 - progress) ** 2
  }

  const getBalloonRotation = (balloon: Balloon) => {
    if (!balloon.heldBy) return balloon.stringAngle * 0.22
    const hand = hands.get(balloon.heldBy)
    if (!hand) return 0
    return Math.atan2(hand.pinch.y - balloon.y, hand.pinch.x - balloon.x) - Math.PI * 0.5
  }

  const getKnot = (balloon: Balloon, visual = false): Point => {
    const rotation = getBalloonRotation(balloon)
    const depthScale = visual ? getDepthScale(balloon) : 1
    return {
      x: balloon.x - Math.sin(rotation) * knotDistance(balloon) * depthScale,
      y: balloon.y + Math.cos(rotation) * knotDistance(balloon) * depthScale,
    }
  }

  const getFreeString = (balloon: Balloon, visual = false) => {
    const start = getKnot(balloon, visual)
    const angle = balloon.stringAngle
    return {
      start,
      end: {
        x: start.x + Math.sin(angle) * balloon.stringLength,
        y: start.y + Math.cos(angle) * balloon.stringLength,
      },
    }
  }

  const releaseBalloon = (handId: string) => {
    const balloon = balloons.find((candidate) => candidate.heldBy === handId)
    if (!balloon) return
    balloon.heldBy = null
    balloon.grabRatio = 1
    balloon.vx = clamp(balloon.vx, -520, 520)
    balloon.vy = clamp(balloon.vy, -520, 360)
    say('끈을 놓았어요. 풍선이 다시 떠올라요.', 700)
  }

  const popBalloon = (balloon: Balloon) => {
    const fragmentCount = lowPowerDevice ? 18 : 27
    for (let index = 0; index < fragmentCount; index += 1) {
      const angle = (index / fragmentCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35
      const speed = 105 + Math.random() * 245
      fragments.push({
        x: balloon.x + Math.cos(angle) * balloon.radius * 0.16,
        y: balloon.y + Math.sin(angle) * balloon.radius * 0.16,
        vx: Math.cos(angle) * speed + balloon.vx * 0.35,
        vy: Math.sin(angle) * speed + balloon.vy * 0.22,
        size: balloon.radius * (0.075 + Math.random() * 0.105),
        rotation: angle + Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 16,
        age: 0,
        lifetime: 0.72 + Math.random() * 0.58,
        hue: balloon.hue + (Math.random() - 0.5) * 8,
        saturation: balloon.saturation,
        lightness: balloon.lightness,
      })
    }
    balloons = balloons.filter((candidate) => candidate !== balloon)
    totalPopped += 1
    poppedCount.textContent = String(totalPopped)
    root.classList.remove('is-popping')
    void root.offsetWidth
    root.classList.add('is-popping')
    say(`펑! ${totalPopped}개의 풍선을 터뜨렸어요.`, 900)
  }

  const segmentTouchesBalloon = (balloon: Balloon, start: Point, end: Point) => {
    const rotation = getBalloonRotation(balloon)
    const cosine = Math.cos(-rotation)
    const sine = Math.sin(-rotation)
    const depthScale = getDepthScale(balloon)
    const radiusX = bodyRadiusX(balloon) * depthScale + 7
    const radiusY = bodyRadiusY(balloon) * depthScale + 7
    const normalize = (point: Point): Point => {
      const deltaX = point.x - balloon.x
      const deltaY = point.y - balloon.y
      return {
        x: (deltaX * cosine - deltaY * sine) / radiusX,
        y: (deltaX * sine + deltaY * cosine) / radiusY,
      }
    }
    return closestPointOnSegment({ x: 0, y: 0 }, normalize(start), normalize(end)).distance <= 1
  }

  const triggerMouthBounce = (balloon: Balloon, time: number) => {
    if (balloon.depthProgress > 0 || time < balloon.mouthCooldownUntil) return
    if (balloon.heldBy) releaseBalloon(balloon.heldBy)
    balloon.depthProgress = 0.0001
    balloon.mouthCooldownUntil = time + 2100
    balloon.vx *= 0.45
    balloon.vy *= 0.45
    say('후— 풍선이 카메라 앞으로 다가왔다가 돌아와요!', 1150)
  }

  const updateMouthInteraction = (time: number) => {
    if (!mouth?.makingO || time - mouth.lastSeen > 190) return
    let touching: Balloon | null = null
    let nearestDistance = Infinity
    for (const balloon of balloons) {
      if (balloon.depthProgress > 0 || time < balloon.mouthCooldownUntil) continue
      const balloonDistance = distance(mouth.point, { x: balloon.x, y: balloon.y })
      if (balloonDistance >= nearestDistance || !segmentTouchesBalloon(balloon, mouth.point, mouth.point)) continue
      touching = balloon
      nearestDistance = balloonDistance
    }
    if (touching) triggerMouthBounce(touching, time)
  }

  const tryGrabBalloon = (hand: TrackedHand) => {
    if (balloons.some((balloon) => balloon.heldBy === hand.id)) return
    let match: { balloon: Balloon; distance: number; ratio: number } | null = null
    balloons.forEach((balloon) => {
      if (balloon.heldBy) return
      const string = getFreeString(balloon)
      const result = closestPointOnSegment(hand.pinch, string.start, string.end)
      const grabDistance = clamp(balloon.radius * 0.22 + 13, 19, 29)
      if (result.distance > grabDistance || (match && result.distance >= match.distance)) return
      match = { balloon, distance: result.distance, ratio: clamp(result.ratio, 0.1, 1) }
    })
    if (!match) return
    const grabbed = match as { balloon: Balloon; distance: number; ratio: number }
    grabbed.balloon.heldBy = hand.id
    grabbed.balloon.grabRatio = grabbed.ratio
    say('풍선 끈을 잡았어요. 손을 움직여 풍선을 이끌어 보세요.', 900)
  }

  const updateTracking = (time: number) => {
    if (!cameraActive || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const videoTime = video.currentTime

    if (faceLandmarker && videoTime !== lastFaceVideoTime && time - lastFaceDetectionTime >= faceInferenceInterval) {
      lastFaceVideoTime = videoTime
      lastFaceDetectionTime = time
      const faceResult = faceLandmarker.detectForVideo(video, time)
      const face = faceResult.faceLandmarks[0] as Landmark[] | undefined
      if (face?.[0] && face[13] && face[14] && face[17] && face[61] && face[291]) {
        const landmarkDistance = (firstIndex: number, secondIndex: number) => Math.hypot(
          (face[firstIndex].x - face[secondIndex].x) * (video.videoWidth || 1280),
          (face[firstIndex].y - face[secondIndex].y) * (video.videoHeight || 720),
        )
        const mouthWidth = Math.max(1, landmarkDistance(61, 291))
        const faceWidth = Math.max(1, landmarkDistance(234, 454))
        const innerOpenRatio = landmarkDistance(13, 14) / mouthWidth
        const outerRoundness = landmarkDistance(0, 17) / mouthWidth
        const blendshapes = faceResult.faceBlendshapes[0]?.categories || []
        const blendshapeScore = (name: string) => blendshapes.find((category) => category.categoryName === name)?.score || 0
        const roundedByExpression = blendshapeScore('mouthFunnel') > 0.12 || blendshapeScore('mouthPucker') > 0.18
        const openedByExpression = blendshapeScore('jawOpen') > 0.18
        const makingO = innerOpenRatio > 0.13
          && outerRoundness > 0.38
          && mouthWidth / faceWidth < 0.42
          && ((roundedByExpression && openedByExpression) || outerRoundness > 0.58)
        const upperLip = project(face[13])
        const lowerLip = project(face[14])
        const detectedPoint = { x: (upperLip.x + lowerLip.x) * 0.5, y: (upperLip.y + lowerLip.y) * 0.5 }
        const point = mouth
          ? { x: mouth.point.x + (detectedPoint.x - mouth.point.x) * 0.58, y: mouth.point.y + (detectedPoint.y - mouth.point.y) * 0.58 }
          : detectedPoint
        mouth = { point, makingO, lastSeen: time }
      }
    }

    if (!landmarker || videoTime === lastVideoTime || time - lastDetectionTime < inferenceInterval) return
    lastVideoTime = videoTime
    lastDetectionTime = time
    const result = landmarker.detectForVideo(video, time)
    const labels = result.landmarks.map((_, handIndex) => (
      result.handedness[handIndex]?.[0]?.categoryName?.toLowerCase() === 'left' ? 'left' : 'right'
    ))

    result.landmarks.forEach((rawLandmarks, handIndex) => {
      const landmarks = rawLandmarks as Landmark[]
      const label = labels[handIndex]
      const id = labels.filter((candidate) => candidate === label).length > 1 ? `${label}-${handIndex}` : label
      const previous = hands.get(id)
      const rawIndexTip = project(landmarks[8])
      const thumbTip = project(landmarks[4])
      const rawPinch = { x: (rawIndexTip.x + thumbTip.x) * 0.5, y: (rawIndexTip.y + thumbTip.y) * 0.5 }
      const palmSize = Math.max(0.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y))
      const pinchRatio = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y) / palmSize
      const pinching = pinchRatio < (previous?.pinching ? 0.63 : 0.48)
      const pinch = previous
        ? { x: previous.pinch.x + (rawPinch.x - previous.pinch.x) * 0.68, y: previous.pinch.y + (rawPinch.y - previous.pinch.y) * 0.68 }
        : rawPinch
      const hand: TrackedHand = { id, indexTip: rawIndexTip, pinch, pinching, lastSeen: time }
      hands.set(id, hand)

      const previousIndexTip = previous && time - previous.lastSeen < 130 ? previous.indexTip : rawIndexTip
      const touched = balloons.find((balloon) => segmentTouchesBalloon(balloon, previousIndexTip, rawIndexTip))
      if (touched) popBalloon(touched)

      if (pinching) tryGrabBalloon(hand)
      else if (previous?.pinching) releaseBalloon(id)
    })

    if (performance.now() >= statusLockedUntil) {
      if (balloons.some((balloon) => balloon.heldBy)) say('핀치를 유지한 채 움직이면 풍선이 줄에 이끌려 따라와요.')
      else if (mouth?.makingO && time - mouth.lastSeen < 190) say('O 모양 입술에 풍선이 닿으면 카메라 앞으로 튀어나와요.')
      else if (result.landmarks.length > 0) say('검지로 풍선을 터뜨리거나 엄지와 검지로 끈을 집어 보세요.')
      else say('손으로 풍선을 만지고, 입을 O 모양으로 만들어 보세요.')
    }
  }

  const updateHands = (time: number) => {
    hands.forEach((hand, id) => {
      if (time - hand.lastSeen <= 220) return
      releaseBalloon(id)
      hands.delete(id)
    })
  }

  const constrainHeldBalloon = (balloon: Balloon, hand: TrackedHand, deltaTime: number, previousPosition: Point) => {
    let deltaX = balloon.x - hand.pinch.x
    let deltaY = balloon.y - hand.pinch.y
    let currentDistance = Math.hypot(deltaX, deltaY)
    if (currentDistance < 0.001) {
      deltaX = 0
      deltaY = -1
      currentDistance = 1
    }
    const targetDistance = knotDistance(balloon) + balloon.stringLength * balloon.grabRatio
    balloon.x = hand.pinch.x + (deltaX / currentDistance) * targetDistance
    balloon.y = hand.pinch.y + (deltaY / currentDistance) * targetDistance
    const safeDelta = Math.max(deltaTime, 1 / 120)
    balloon.vx = clamp((balloon.x - previousPosition.x) / safeDelta * 0.94, -900, 900)
    balloon.vy = clamp((balloon.y - previousPosition.y) / safeDelta * 0.94, -900, 900)
  }

  const updateBalloons = (deltaTime: number, time: number) => {
    spawnTimer -= deltaTime
    if (spawnTimer <= 0 && balloons.length < maximumBalloons) {
      balloons.push(makeBalloon())
      spawnTimer = 0.48 + Math.random() * 0.62
    }

    balloons.forEach((balloon) => {
      if (balloon.depthProgress > 0) {
        balloon.depthProgress += deltaTime / 1.08
        if (balloon.depthProgress >= 1) balloon.depthProgress = 0
      }
      balloon.phase += deltaTime * (0.75 + 38 / balloon.radius)
      const previousPosition = { x: balloon.x, y: balloon.y }
      const wind = Math.sin(balloon.phase) * (9 + balloon.radius * 0.12)
      balloon.vx += wind * deltaTime
      balloon.vy -= balloon.buoyancy * deltaTime
      const drag = Math.exp(-deltaTime * (balloon.heldBy ? 0.72 : 0.42))
      balloon.vx *= drag
      balloon.vy *= drag
      balloon.vy = Math.max(balloon.vy, -(42 + balloon.radius * 0.5))
      balloon.x += balloon.vx * deltaTime
      balloon.y += balloon.vy * deltaTime

      if (balloon.heldBy) {
        const hand = hands.get(balloon.heldBy)
        if (hand?.pinching && time - hand.lastSeen < 220) constrainHeldBalloon(balloon, hand, deltaTime, previousPosition)
        else releaseBalloon(balloon.heldBy)
      } else {
        const edge = bodyRadiusX(balloon)
        if (balloon.x < edge) { balloon.x = edge; balloon.vx = Math.abs(balloon.vx) * 0.58 }
        if (balloon.x > width - edge) { balloon.x = width - edge; balloon.vx = -Math.abs(balloon.vx) * 0.58 }
        balloon.stringAngle = Math.sin(balloon.phase * 0.78) * 0.13 - clamp(balloon.vx / 520, -0.19, 0.19)
      }
    })

    let retained = 0
    for (const balloon of balloons) {
      if (!balloon.heldBy && balloon.depthProgress <= 0 && balloon.y + knotDistance(balloon) + balloon.stringLength <= -36) continue
      balloons[retained] = balloon
      retained += 1
    }
    balloons.length = retained
  }

  const updateFragments = (deltaTime: number) => {
    fragments.forEach((fragment) => {
      fragment.age += deltaTime
      fragment.vy += 310 * deltaTime
      fragment.vx *= Math.exp(-deltaTime * 0.55)
      fragment.x += fragment.vx * deltaTime
      fragment.y += fragment.vy * deltaTime
      fragment.rotation += fragment.spin * deltaTime
    })
    let retained = 0
    for (const fragment of fragments) {
      if (fragment.age >= fragment.lifetime) continue
      fragments[retained] = fragment
      retained += 1
    }
    fragments.length = retained
  }

  const clearOverlay = () => {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)
  }

  const drawString = (balloon: Balloon) => {
    const knot = getKnot(balloon, true)
    context.save()
    context.strokeStyle = balloon.heldBy ? 'rgba(255, 255, 255, 0.9)' : 'rgba(244, 239, 221, 0.72)'
    context.lineWidth = balloon.heldBy ? 1.5 : 1.1
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(knot.x, knot.y)
    if (balloon.heldBy) {
      const hand = hands.get(balloon.heldBy)
      if (hand) {
        context.lineTo(hand.pinch.x, hand.pinch.y)
        const remainingLength = balloon.stringLength * (1 - balloon.grabRatio)
        if (remainingLength > 1) {
          const tailAngle = Math.sin(balloon.phase * 0.7) * 0.16
          context.lineTo(
            hand.pinch.x + Math.sin(tailAngle) * remainingLength,
            hand.pinch.y + Math.cos(tailAngle) * remainingLength,
          )
        }
      }
    } else {
      const string = getFreeString(balloon, true)
      context.lineTo(string.end.x, string.end.y)
    }
    context.stroke()
    context.restore()
  }

  const drawBalloon = (balloon: Balloon) => {
    const radiusX = bodyRadiusX(balloon)
    const radiusY = balloon.radius
    const rotation = getBalloonRotation(balloon)
    const depthScale = getDepthScale(balloon)
    context.save()
    context.translate(balloon.x, balloon.y)
    context.rotate(rotation)
    context.scale(depthScale, depthScale)
    if (balloon.depthProgress > 0) {
      context.shadowColor = 'rgba(255, 255, 255, 0.42)'
      context.shadowBlur = 18
    }

    const imageAsset = balloonAssets[(balloon.id - 1) % balloonAssets.length]
    if (imageAsset.ready) {
      const imageHeight = radiusY * 2.72
      const imageWidth = imageHeight * (imageAsset.sprite.width / imageAsset.sprite.height)
      context.drawImage(imageAsset.sprite, -imageWidth * 0.5, -imageHeight * 0.62, imageWidth, imageHeight)
      context.restore()
      return
    }

    const makeGradient = (light: string, middle: string, dark: string) => {
      const gradient = context.createRadialGradient(-radiusX * 0.32, -radiusY * 0.4, radiusY * 0.05, 0, 0, radiusY * 1.18)
      gradient.addColorStop(0, light)
      gradient.addColorStop(0.53, middle)
      gradient.addColorStop(1, dark)
      return gradient
    }
    const fillEllipse = (x: number, y: number, radiusHorizontal: number, radiusVertical: number, rotation = 0) => {
      context.beginPath()
      context.ellipse(x, y, radiusHorizontal, radiusVertical, rotation, 0, Math.PI * 2)
      context.fill()
    }
    const drawHighlight = (x = -radiusX * 0.3, y = -radiusY * 0.34) => {
      context.fillStyle = 'rgba(255, 255, 255, 0.34)'
      fillEllipse(x, y, radiusY * 0.1, radiusY * 0.23, -0.3)
    }

    if (balloon.character === 'hello-kitty') {
      context.fillStyle = makeGradient('#ffffff', '#fff8fb', '#dce5ee')
      context.beginPath()
      context.moveTo(-radiusX * 0.82, -radiusY * 0.46)
      context.lineTo(-radiusX * 0.74, -radiusY * 1.02)
      context.lineTo(-radiusX * 0.28, -radiusY * 0.72)
      context.lineTo(radiusX * 0.4, -radiusY * 0.73)
      context.lineTo(radiusX * 0.78, -radiusY * 1.02)
      context.lineTo(radiusX * 0.88, -radiusY * 0.42)
      context.closePath()
      context.fill()
      fillEllipse(0, radiusY * 0.03, radiusX * 0.95, radiusY * 0.79)
      drawHighlight()

      context.fillStyle = '#2c2830'
      fillEllipse(-radiusX * 0.31, -radiusY * 0.05, radiusY * 0.055, radiusY * 0.085)
      fillEllipse(radiusX * 0.31, -radiusY * 0.05, radiusY * 0.055, radiusY * 0.085)
      context.fillStyle = '#f2c735'
      fillEllipse(0, radiusY * 0.12, radiusY * 0.075, radiusY * 0.052)
      context.strokeStyle = '#3a343c'
      context.lineWidth = Math.max(1, radiusY * 0.022)
      ;[-1, 1].forEach((side) => {
        for (let index = -1; index <= 1; index += 1) {
          context.beginPath()
          context.moveTo(side * radiusX * 0.48, radiusY * (0.08 + index * 0.11))
          context.lineTo(side * radiusX * 0.94, radiusY * (0.03 + index * 0.15))
          context.stroke()
        }
      })
      context.fillStyle = '#ef476f'
      fillEllipse(-radiusX * 0.55, -radiusY * 0.58, radiusY * 0.22, radiusY * 0.16, -0.32)
      fillEllipse(-radiusX * 0.2, -radiusY * 0.58, radiusY * 0.22, radiusY * 0.16, 0.32)
      context.fillStyle = '#cf3156'
      fillEllipse(-radiusX * 0.375, -radiusY * 0.58, radiusY * 0.1, radiusY * 0.1)
    } else if (balloon.character === 'cinnamoroll') {
      context.fillStyle = makeGradient('#ffffff', '#f4fbff', '#c9e9f5')
      fillEllipse(-radiusX * 0.66, -radiusY * 0.04, radiusX * 0.47, radiusY * 0.22, -0.12)
      fillEllipse(radiusX * 0.66, -radiusY * 0.04, radiusX * 0.47, radiusY * 0.22, 0.12)
      fillEllipse(0, 0, radiusX * 0.57, radiusY * 0.88)
      drawHighlight(-radiusX * 0.2, -radiusY * 0.38)
      context.fillStyle = '#4d78b8'
      fillEllipse(-radiusX * 0.22, -radiusY * 0.12, radiusY * 0.055, radiusY * 0.09)
      fillEllipse(radiusX * 0.22, -radiusY * 0.12, radiusY * 0.055, radiusY * 0.09)
      context.fillStyle = 'rgba(255, 142, 171, 0.62)'
      fillEllipse(-radiusX * 0.34, radiusY * 0.2, radiusY * 0.12, radiusY * 0.065)
      fillEllipse(radiusX * 0.34, radiusY * 0.2, radiusY * 0.12, radiusY * 0.065)
      context.strokeStyle = '#4d78b8'
      context.lineWidth = Math.max(1.3, radiusY * 0.026)
      context.beginPath()
      context.moveTo(0, radiusY * 0.06)
      context.quadraticCurveTo(-radiusX * 0.08, radiusY * 0.16, -radiusX * 0.14, radiusY * 0.1)
      context.moveTo(0, radiusY * 0.06)
      context.quadraticCurveTo(radiusX * 0.08, radiusY * 0.16, radiusX * 0.14, radiusY * 0.1)
      context.stroke()
    } else if (balloon.character === 'kuromi') {
      context.fillStyle = makeGradient('#62506f', '#2d2637', '#14121b')
      context.beginPath()
      context.moveTo(-radiusX * 0.78, -radiusY * 0.48)
      context.lineTo(-radiusX * 0.7, -radiusY * 1.35)
      context.lineTo(-radiusX * 0.2, -radiusY * 0.72)
      context.lineTo(radiusX * 0.2, -radiusY * 0.72)
      context.lineTo(radiusX * 0.7, -radiusY * 1.35)
      context.lineTo(radiusX * 0.78, -radiusY * 0.45)
      context.closePath()
      context.fill()
      fillEllipse(0, -radiusY * 0.02, radiusX * 0.92, radiusY * 0.84)
      context.fillStyle = '#fff9f7'
      fillEllipse(0, radiusY * 0.13, radiusX * 0.65, radiusY * 0.58)
      drawHighlight(-radiusX * 0.42, -radiusY * 0.4)
      context.fillStyle = '#332b3c'
      fillEllipse(-radiusX * 0.24, radiusY * 0.04, radiusY * 0.06, radiusY * 0.085)
      fillEllipse(radiusX * 0.24, radiusY * 0.04, radiusY * 0.06, radiusY * 0.085)
      context.strokeStyle = '#332b3c'
      context.lineWidth = Math.max(1.3, radiusY * 0.026)
      context.beginPath()
      context.arc(0, radiusY * 0.17, radiusY * 0.13, 0.12, Math.PI - 0.12)
      context.stroke()
      context.fillStyle = '#f47ca8'
      fillEllipse(0, -radiusY * 0.53, radiusY * 0.14, radiusY * 0.12)
      context.strokeStyle = '#f47ca8'
      context.lineWidth = Math.max(2, radiusY * 0.065)
      context.beginPath()
      context.moveTo(-radiusY * 0.15, -radiusY * 0.43)
      context.lineTo(radiusY * 0.15, -radiusY * 0.63)
      context.moveTo(-radiusY * 0.15, -radiusY * 0.63)
      context.lineTo(radiusY * 0.15, -radiusY * 0.43)
      context.stroke()
    } else if (balloon.character === 'my-melody') {
      context.fillStyle = makeGradient('#ffb8d2', '#ef6fa6', '#c83d78')
      context.beginPath()
      context.moveTo(-radiusX * 0.68, -radiusY * 0.45)
      context.lineTo(-radiusX * 0.62, -radiusY * 1.38)
      context.quadraticCurveTo(-radiusX * 0.35, -radiusY * 1.5, -radiusX * 0.23, -radiusY * 0.68)
      context.lineTo(radiusX * 0.2, -radiusY * 0.68)
      context.quadraticCurveTo(radiusX * 0.42, -radiusY * 1.16, radiusX * 0.78, -radiusY * 1.2)
      context.quadraticCurveTo(radiusX * 0.86, -radiusY * 0.82, radiusX * 0.65, -radiusY * 0.48)
      context.closePath()
      context.fill()
      fillEllipse(0, -radiusY * 0.02, radiusX * 0.9, radiusY * 0.84)
      context.fillStyle = '#fffaf2'
      fillEllipse(0, radiusY * 0.14, radiusX * 0.63, radiusY * 0.57)
      drawHighlight(-radiusX * 0.42, -radiusY * 0.42)
      context.fillStyle = '#40343b'
      fillEllipse(-radiusX * 0.24, radiusY * 0.08, radiusY * 0.05, radiusY * 0.075)
      fillEllipse(radiusX * 0.24, radiusY * 0.08, radiusY * 0.05, radiusY * 0.075)
      context.fillStyle = '#f1bd43'
      fillEllipse(0, radiusY * 0.2, radiusY * 0.065, radiusY * 0.05)
      context.fillStyle = '#fff1a6'
      fillEllipse(radiusX * 0.55, -radiusY * 0.46, radiusY * 0.17, radiusY * 0.17)
      context.fillStyle = '#ffd95f'
      fillEllipse(radiusX * 0.55, -radiusY * 0.46, radiusY * 0.075, radiusY * 0.075)
    } else if (balloon.character === 'pompompurin') {
      context.fillStyle = makeGradient('#fff0a2', '#f3c64f', '#cc8d25')
      fillEllipse(-radiusX * 0.78, radiusY * 0.02, radiusX * 0.32, radiusY * 0.44, 0.28)
      fillEllipse(radiusX * 0.78, radiusY * 0.02, radiusX * 0.32, radiusY * 0.44, -0.28)
      fillEllipse(0, radiusY * 0.05, radiusX * 0.84, radiusY * 0.83)
      drawHighlight()
      context.fillStyle = '#76502d'
      fillEllipse(-radiusX * 0.25, -radiusY * 0.02, radiusY * 0.055, radiusY * 0.075)
      fillEllipse(radiusX * 0.25, -radiusY * 0.02, radiusY * 0.055, radiusY * 0.075)
      fillEllipse(0, radiusY * 0.14, radiusY * 0.07, radiusY * 0.052)
      context.strokeStyle = '#76502d'
      context.lineWidth = Math.max(1.2, radiusY * 0.026)
      context.beginPath()
      context.moveTo(0, radiusY * 0.18)
      context.quadraticCurveTo(-radiusX * 0.07, radiusY * 0.28, -radiusX * 0.14, radiusY * 0.22)
      context.moveTo(0, radiusY * 0.18)
      context.quadraticCurveTo(radiusX * 0.07, radiusY * 0.28, radiusX * 0.14, radiusY * 0.22)
      context.stroke()
      context.fillStyle = '#7b4d2c'
      fillEllipse(0, -radiusY * 0.78, radiusX * 0.4, radiusY * 0.13)
      context.fillRect(-radiusX * 0.045, -radiusY * 0.92, radiusX * 0.09, radiusY * 0.14)
    } else {
      context.fillStyle = makeGradient('#baff83', '#63ce53', '#258e3e')
      fillEllipse(0, radiusY * 0.12, radiusX * 0.92, radiusY * 0.69)
      context.fillStyle = '#f7fff4'
      fillEllipse(-radiusX * 0.38, -radiusY * 0.47, radiusY * 0.3, radiusY * 0.34)
      fillEllipse(radiusX * 0.38, -radiusY * 0.47, radiusY * 0.3, radiusY * 0.34)
      context.fillStyle = '#263c2d'
      fillEllipse(-radiusX * 0.34, -radiusY * 0.48, radiusY * 0.095, radiusY * 0.13)
      fillEllipse(radiusX * 0.34, -radiusY * 0.48, radiusY * 0.095, radiusY * 0.13)
      context.fillStyle = 'rgba(255, 118, 129, 0.62)'
      fillEllipse(-radiusX * 0.58, radiusY * 0.21, radiusY * 0.13, radiusY * 0.07)
      fillEllipse(radiusX * 0.58, radiusY * 0.21, radiusY * 0.13, radiusY * 0.07)
      context.fillStyle = '#ef5362'
      context.beginPath()
      context.ellipse(0, radiusY * 0.27, radiusX * 0.31, radiusY * 0.2, 0, 0, Math.PI)
      context.fill()
      drawHighlight(-radiusX * 0.67, -radiusY * 0.08)
    }

    context.fillStyle = `hsl(${balloon.hue} ${balloon.saturation}% ${Math.max(28, balloon.lightness - 14)}%)`
    context.beginPath()
    context.moveTo(0, radiusY * 0.94)
    context.lineTo(-radiusX * 0.13, radiusY * 1.15)
    context.lineTo(radiusX * 0.13, radiusY * 1.15)
    context.closePath()
    context.fill()
    context.restore()
  }

  const drawFragments = () => {
    fragments.forEach((fragment) => {
      const progress = fragment.age / fragment.lifetime
      context.save()
      context.globalAlpha = Math.max(0, 1 - progress * progress)
      context.translate(fragment.x, fragment.y)
      context.rotate(fragment.rotation)
      context.fillStyle = `hsl(${fragment.hue} ${fragment.saturation}% ${fragment.lightness}%)`
      context.beginPath()
      context.moveTo(-fragment.size, -fragment.size * 0.46)
      context.lineTo(fragment.size * 0.9, -fragment.size * 0.2)
      context.lineTo(fragment.size * 0.35, fragment.size)
      context.lineTo(-fragment.size * 0.5, fragment.size * 0.48)
      context.closePath()
      context.fill()
      context.restore()
    })
  }

  const draw = (time: number) => {
    if (disposed) return
    const deltaTime = Math.min(0.034, Math.max(0, (time - lastFrameTime) / 1000))
    lastFrameTime = time
    if (!document.hidden) {
      updateTracking(time)
      updateHands(time)
      updateMouthInteraction(time)
      updateBalloons(deltaTime, time)
      updateFragments(deltaTime)
      clearOverlay()
      balloons.forEach(drawString)
      balloons.forEach((balloon) => { if (balloon.depthProgress <= 0) drawBalloon(balloon) })
      balloons.forEach((balloon) => { if (balloon.depthProgress > 0) drawBalloon(balloon) })
      drawFragments()
    }
    animationFrame = requestAnimationFrame(draw)
  }

  const getVision = () => {
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    return visionPromise
  }

  const ensureLandmarker = async () => {
    if (landmarker) return landmarker
    say('손 제스처 인식 모델을 준비하고 있어요…')
    const vision = await getVision()
    if (disposed) throw new Error('Balloon has been disposed.')
    const created = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.58,
      minHandPresenceConfidence: 0.54,
      minTrackingConfidence: 0.54,
    })
    if (disposed) { created.close(); throw new Error('Balloon has been disposed.') }
    landmarker = created
    return landmarker
  }

  const ensureFaceLandmarker = async () => {
    if (faceLandmarker) return faceLandmarker
    const vision = await getVision()
    if (disposed) throw new Error('Balloon has been disposed.')
    const created = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_PATH },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    })
    if (disposed) { created.close(); throw new Error('Balloon has been disposed.') }
    faceLandmarker = created
    return faceLandmarker
  }

  const stopCamera = () => {
    cameraRequest += 1
    cameraActive = false
    hands.forEach((_, id) => releaseBalloon(id))
    hands.clear()
    mouth = null
    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = null
    video.srcObject = null
    root.classList.remove('is-camera-active')
    toggleButton.textContent = '카메라 시작'
    toggleButton.classList.remove('is-active')
    say('카메라가 꺼졌어요.')
  }

  const startCamera = async () => {
    if (starting || disposed) return
    if (!navigator.mediaDevices?.getUserMedia) { say('이 브라우저에서는 카메라를 사용할 수 없어요.'); return }
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true
    say('카메라 권한을 요청하고 있어요…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      if (disposed || request !== cameraRequest) { stream.getTracks().forEach((track) => track.stop()); return }
      cameraStream = stream
      video.srcObject = stream
      await video.play()
      await Promise.all([ensureLandmarker(), ensureFaceLandmarker()])
      if (disposed || request !== cameraRequest) return
      cameraActive = true
      lastVideoTime = -1
      lastDetectionTime = -Infinity
      lastFaceVideoTime = -1
      lastFaceDetectionTime = -Infinity
      root.classList.add('is-camera-active')
      toggleButton.textContent = '카메라 끄기'
      toggleButton.classList.add('is-active')
      say('검지로 풍선을 터뜨리고, 엄지와 검지로 끈을 집어 보세요.')
    } catch {
      cameraStream?.getTracks().forEach((track) => track.stop())
      cameraStream = null
      cameraActive = false
      video.srcObject = null
      root.classList.remove('is-camera-active')
      say('카메라 또는 손 인식 모델을 준비하지 못했어요. 권한과 인터넷 연결을 확인해 주세요.')
    } finally {
      starting = false
      toggleButton.disabled = false
    }
  }

  const toggleCamera = () => {
    if (cameraActive || cameraStream) stopCamera()
    else void startCamera()
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(stage)
  toggleButton.addEventListener('click', toggleCamera)
  resize()
  animationFrame = requestAnimationFrame(draw)

  return () => {
    disposed = true
    cameraRequest += 1
    cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    toggleButton.removeEventListener('click', toggleCamera)
    cameraStream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
    landmarker?.close()
    faceLandmarker?.close()
  }
}
