import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { createModelPair } from './model-lifecycle'
import { createRubberRenderer } from './rubber-renderer'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const HAND_MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const FACE_MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`

type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type TrackedHand = { id: string; pinch: Point; pinching: boolean; lastSeen: number }
type Grab = {
  handId: string | null
  anchorIndex: number
  offset: Point
  displacement: Point
  velocity: Point
  target: Point
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y)
const FACE_OVAL = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map((edge) => edge.start)
const FACE_OVAL_SET = new Set(FACE_OVAL)
export function setupRubberHuman(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('.rubber-camera-stage')!
  const video = root.querySelector<HTMLVideoElement>('#rubber-camera')!
  const canvas = root.querySelector<HTMLCanvasElement>('#rubber-surface')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#rubber-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#rubber-status')!
  const stateLabel = root.querySelector<HTMLElement>('#rubber-state')!

  let renderer: ReturnType<typeof createRubberRenderer>
  try {
    renderer = createRubberRenderer(canvas)
  } catch {
    status.textContent = '이 브라우저에서는 얼굴 변형 효과를 표시할 수 없어요.'
    stateLabel.textContent = 'UNAVAILABLE'
    toggleButton.disabled = true
    return () => {}
  }

  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  const faceInferenceInterval = 1000 / (lowPowerDevice ? 16 : 22)
  const handInferenceInterval = 1000 / (lowPowerDevice ? 18 : 24)
  const maximumPixelRatio = lowPowerDevice ? 1.25 : 1.6

  let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let handLandmarker: HandLandmarker | null = null
  let cameraStream: MediaStream | null = null
  let disposed = false
  let starting = false
  let cameraActive = false
  let cameraRequest = 0
  let animationFrame = 0
  let videoFrameRequest = 0
  let width = 1
  let height = 1
  let pixelRatio = 1
  let lastFrameTime = performance.now()
  let lastFaceVideoTime = -1
  let lastHandVideoTime = -1
  let lastFaceDetectionTime = -Infinity
  let lastHandDetectionTime = -Infinity
  let lastRenderedVideoTime = -1
  let lastInterfaceUpdate = -Infinity
  let renderDirty = true
  let faceSeenAt = -Infinity
  let faceLandmarks: Landmark[] | null = null
  const grabs = new Map<string, Grab>()
  let lastStatus = ''
  const hands = new Map<string, TrackedHand>()
  const projectedFacePoints: Point[] = []

  const say = (message: string) => {
    if (lastStatus === message) return
    lastStatus = message
    status.textContent = message
  }

  const resize = () => {
    const bounds = stage.getBoundingClientRect()
    width = Math.max(1, bounds.width)
    height = Math.max(1, bounds.height)
    pixelRatio = Math.min(window.devicePixelRatio || 1, maximumPixelRatio)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    renderDirty = true
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

  const projectFace = (landmarks: Landmark[]) => {
    const videoWidth = video.videoWidth || 1280
    const videoHeight = video.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawnWidth = videoWidth * scale
    const drawnHeight = videoHeight * scale
    const offsetX = (width - drawnWidth) * 0.5
    const offsetY = (height - drawnHeight) * 0.5
    while (projectedFacePoints.length < landmarks.length) projectedFacePoints.push({ x: 0, y: 0 })
    projectedFacePoints.length = landmarks.length
    landmarks.forEach((landmark, index) => {
      const point = projectedFacePoints[index]
      point.x = offsetX + (1 - landmark.x) * drawnWidth
      point.y = offsetY + landmark.y * drawnHeight
    })
    return projectedFacePoints
  }

  const pointInsideFace = (point: Point, points: Point[]) => {
    let inside = false
    let minimumX = Infinity
    let maximumX = -Infinity
    let minimumY = Infinity
    let maximumY = -Infinity
    for (let index = 0, previous = FACE_OVAL.length - 1; index < FACE_OVAL.length; previous = index++) {
      const currentPoint = points[FACE_OVAL[index]]
      const previousPoint = points[FACE_OVAL[previous]]
      minimumX = Math.min(minimumX, currentPoint.x)
      maximumX = Math.max(maximumX, currentPoint.x)
      minimumY = Math.min(minimumY, currentPoint.y)
      maximumY = Math.max(maximumY, currentPoint.y)
      const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
        && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y) / (previousPoint.y - currentPoint.y) + currentPoint.x
      if (crosses) inside = !inside
    }
    if (inside) return true
    // A small elliptical margin keeps a pinch on the soft face contour from
    // flickering out when the hand temporarily obscures the outer landmarks.
    const centerX = (minimumX + maximumX) * 0.5
    const centerY = (minimumY + maximumY) * 0.5
    const radiusX = Math.max(1, (maximumX - minimumX) * 0.54)
    const radiusY = Math.max(1, (maximumY - minimumY) * 0.53)
    return ((point.x - centerX) / radiusX) ** 2 + ((point.y - centerY) / radiusY) ** 2 <= 1
  }

  const beginGrab = (hand: TrackedHand, points: Point[]) => {
    if (!faceLandmarks || grabs.has(hand.id) || grabs.size >= 2 || !pointInsideFace(hand.pinch, points)) return
    let anchorIndex = 0
    let nearestDistance = Infinity
    points.forEach((point, index) => {
      if (FACE_OVAL_SET.has(index)) return
      const pointDistance = distance(point, hand.pinch)
      if (pointDistance >= nearestDistance) return
      nearestDistance = pointDistance
      anchorIndex = index
    })
    const anchorPoint = points[anchorIndex]
    grabs.set(hand.id, {
      handId: hand.id,
      anchorIndex,
      offset: { x: hand.pinch.x - anchorPoint.x, y: hand.pinch.y - anchorPoint.y },
      displacement: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      target: { x: 0, y: 0 },
    })
    root.classList.add('is-grabbed')
    root.classList.remove('is-rebounding')
    stateLabel.textContent = 'GRABBED'
    say(grabs.size === 2 ? '양손으로 잡았어요! 두 방향으로 얼굴을 늘여 보세요.' : '잡았어요! 다른 손으로도 얼굴의 반대쪽을 잡아 보세요.')
  }

  const releaseGrab = (id: string) => {
    const grab = grabs.get(id)
    if (!grab?.handId) return
    grab.handId = null
    grab.target.x = 0
    grab.target.y = 0
    const stillHeld = [...grabs.values()].some((candidate) => candidate.handId)
    root.classList.toggle('is-grabbed', stillHeld)
    root.classList.toggle('is-rebounding', !stillHeld)
    stateLabel.textContent = stillHeld ? 'GRABBED' : 'BOUNCE'
    say(stillHeld ? '한쪽을 놓았어요. 다른 손으로 계속 늘일 수 있어요.' : '손을 놓았어요. 얼굴이 탄력 있게 돌아가고 있어요.')
  }

  const updateGrabTarget = (grab: Grab, pinch: Point, points: Point[]) => {
    const anchorPoint = points[grab.anchorIndex]
    if (!anchorPoint) return
    const anchor = { x: anchorPoint.x + grab.offset.x, y: anchorPoint.y + grab.offset.y }
    grab.target.x = pinch.x - anchor.x
    grab.target.y = pinch.y - anchor.y
  }

  const updateFaceTracking = (time: number) => {
    if (!faceLandmarker || video.currentTime === lastFaceVideoTime || time - lastFaceDetectionTime < faceInferenceInterval) return false
    lastFaceVideoTime = video.currentTime
    lastFaceDetectionTime = time
    const result = faceLandmarker.detectForVideo(video, time)
    const detected = result.faceLandmarks[0] as Landmark[] | undefined
    if (!detected?.length) return true
    if (!faceLandmarks || faceLandmarks.length !== detected.length) {
      faceLandmarks = detected.map((landmark) => ({ ...landmark }))
    } else {
      detected.forEach((landmark, index) => {
        const current = faceLandmarks![index]
        current.x += (landmark.x - current.x) * 0.58
        current.y += (landmark.y - current.y) * 0.58
        current.z += (landmark.z - current.z) * 0.58
      })
    }
    faceSeenAt = time
    return true
  }

  const updateHandTracking = (time: number) => {
    if (!handLandmarker || video.currentTime === lastHandVideoTime || time - lastHandDetectionTime < handInferenceInterval) return
    lastHandVideoTime = video.currentTime
    lastHandDetectionTime = time
    const result = handLandmarker.detectForVideo(video, time)
    const labels = result.landmarks.map((_, handIndex) => (
      result.handedness[handIndex]?.[0]?.categoryName?.toLowerCase() === 'left' ? 'left' : 'right'
    ))
    const currentIds = new Set<string>()
    const points = faceLandmarks ? projectFace(faceLandmarks) : null

    result.landmarks.forEach((rawLandmarks, handIndex) => {
      const landmarks = rawLandmarks as Landmark[]
      const label = labels[handIndex]
      const id = labels.filter((candidate) => candidate === label).length > 1 ? `${label}-${handIndex}` : label
      currentIds.add(id)
      const previous = hands.get(id)
      const thumb = project(landmarks[4])
      const indexFinger = project(landmarks[8])
      const detectedPinch = { x: (thumb.x + indexFinger.x) * 0.5, y: (thumb.y + indexFinger.y) * 0.5 }
      const pinch = previous
        ? { x: previous.pinch.x + (detectedPinch.x - previous.pinch.x) * 0.72, y: previous.pinch.y + (detectedPinch.y - previous.pinch.y) * 0.72 }
        : detectedPinch
      const palmSize = Math.max(0.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y))
      const pinchRatio = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y) / palmSize
      const pinching = pinchRatio < (previous?.pinching ? 0.60 : 0.46)
      const hand: TrackedHand = { id, pinch, pinching, lastSeen: time }
      hands.set(id, hand)

      let grab = grabs.get(id)
      if (pinching && !grab && points) {
        beginGrab(hand, points)
        grab = grabs.get(id)
      }
      if (!grab) return
      if (!pinching) {
        releaseGrab(id)
        return
      }
      if (grab.handId === null) {
        grab.handId = id
        root.classList.add('is-grabbed')
        root.classList.remove('is-rebounding')
        stateLabel.textContent = 'GRABBED'
      }
      if (points) {
        updateGrabTarget(grab, pinch, points)
      }
    })

    hands.forEach((hand, id) => {
      if (currentIds.has(id) || time - hand.lastSeen < 220) return
      releaseGrab(id)
      hands.delete(id)
    })
  }

  const updateSpring = (deltaTime: number, points: Point[] | null) => {
    if (!grabs.size) return
    if (timeSinceFace() > 420) {
      grabs.forEach((grab, id) => { if (grab.handId) releaseGrab(id) })
    }
    const settled: string[] = []
    grabs.forEach((grab, id) => {
      const held = grab.handId !== null
      const stiffness = held ? 96 : 74
      const damping = held ? 18 : 7.2
      const accelerationX = (grab.target.x - grab.displacement.x) * stiffness - grab.velocity.x * damping
      const accelerationY = (grab.target.y - grab.displacement.y) * stiffness - grab.velocity.y * damping
      grab.velocity.x = clamp(grab.velocity.x + accelerationX * deltaTime, -2800, 2800)
      grab.velocity.y = clamp(grab.velocity.y + accelerationY * deltaTime, -2800, 2800)
      grab.displacement.x += grab.velocity.x * deltaTime
      grab.displacement.y += grab.velocity.y * deltaTime
      if (!held && Math.hypot(grab.displacement.x, grab.displacement.y) < 0.55 && Math.hypot(grab.velocity.x, grab.velocity.y) < 7) settled.push(id)
    })
    settled.forEach((id) => grabs.delete(id))

    if (!grabs.size) {
      renderDirty = true
      root.classList.remove('is-rebounding')
      stateLabel.textContent = points ? 'READY' : 'SEARCHING'
      say(points ? '양손으로 얼굴의 양쪽을 집어 원하는 방향으로 당겨 보세요.' : '얼굴을 카메라 중앙에 보여 주세요.')
    }
  }

  const timeSinceFace = () => performance.now() - faceSeenAt

  const updateInterface = (time: number) => {
    if ([...grabs.values()].some((grab) => grab.handId)) return
    if (grabs.size) return
    if (time - faceSeenAt > 420) {
      stateLabel.textContent = 'SEARCHING'
      say('얼굴을 카메라 중앙에 보여 주세요.')
      return
    }
    const hasPinchingHand = [...hands.values()].some((hand) => hand.pinching && time - hand.lastSeen < 220)
    stateLabel.textContent = 'READY'
    say(hasPinchingHand ? '다른 손으로 얼굴 반대쪽도 핀치하면 양쪽으로 늘일 수 있어요.' : '양손으로 얼굴의 양쪽을 집어 원하는 방향으로 당겨 보세요.')
  }

  const scheduleNextFrame = () => {
    // The idle view only changes when the camera produces a new frame. This
    // avoids waking the main thread at display refresh rate (usually 60fps)
    // while preserving a full refresh-rate loop during grab and rebound.
    if (!cameraActive) return
    if (!grabs.size && 'requestVideoFrameCallback' in video) {
      videoFrameRequest = video.requestVideoFrameCallback((time) => {
        videoFrameRequest = 0
        draw(time)
      })
      return
    }
    animationFrame = requestAnimationFrame(draw)
  }

  const cancelScheduledFrame = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = 0
    if (videoFrameRequest && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(videoFrameRequest)
    videoFrameRequest = 0
  }

  const draw = (time: number) => {
    if (disposed) return
    animationFrame = 0
    videoFrameRequest = 0
    const deltaTime = Math.min(0.034, Math.max(0.001, (time - lastFrameTime) / 1000))
    lastFrameTime = time
    if (!document.hidden && cameraActive) {
      // Do not run both neural models in the same display frame. The next
      // frame is at most one refresh later, while avoiding CPU spikes that
      // otherwise make lower-power devices visibly stutter.
      const faceRan = updateFaceTracking(time)
      const faceIsRecent = time - faceSeenAt < 520
      if (!faceRan && (faceIsRecent || grabs.size)) updateHandTracking(time)

      let points: Point[] | null = null
      if (grabs.size) {
        points = time - faceSeenAt < 850 && faceLandmarks ? projectFace(faceLandmarks) : null
        updateSpring(deltaTime, points)
      }

      const videoChanged = video.currentTime !== lastRenderedVideoTime
      const effectActive = grabs.size > 0
      if (renderDirty || videoChanged || effectActive) {
        renderer.draw(video, width, height, effectActive ? points : null, grabs.values())
        lastRenderedVideoTime = video.currentTime
        renderDirty = false
      }

      if (videoChanged || time - lastInterfaceUpdate > 180) {
        updateInterface(time)
        lastInterfaceUpdate = time
      }
    } else if (!cameraActive) {
      if (renderDirty) {
        renderer.draw(video, width, height, null, grabs.values())
        renderDirty = false
      }
    }
    scheduleNextFrame()
  }

  const getVision = () => {
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    return visionPromise
  }

  const ensureModels = async () => {
    if (faceLandmarker && handLandmarker) return
    const vision = await getVision()
    if (disposed) throw new Error('고무 인간 예제가 종료되었습니다.')
    const [createdFace, createdHand] = await createModelPair(
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_PATH },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.58,
        minFacePresenceConfidence: 0.58,
        minTrackingConfidence: 0.56,
      }),
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_PATH },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.58,
        minHandPresenceConfidence: 0.54,
        minTrackingConfidence: 0.54,
      }),
    )
    if (disposed) {
      createdFace.close()
      createdHand.close()
      throw new Error('고무 인간 예제가 종료되었습니다.')
    }
    faceLandmarker?.close()
    handLandmarker?.close()
    faceLandmarker = createdFace
    handLandmarker = createdHand
  }

  const stopCamera = () => {
    cameraRequest += 1
    cameraActive = false
    cancelScheduledFrame()
    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = null
    video.srcObject = null
    faceLandmarks = null
    hands.clear()
    grabs.clear()
    lastRenderedVideoTime = -1
    renderDirty = true
    root.classList.remove('is-camera-active', 'is-grabbed', 'is-rebounding')
    toggleButton.textContent = '카메라 시작'
    toggleButton.classList.remove('is-active')
    stateLabel.textContent = 'READY'
    say('카메라가 꺼졌어요.')
    animationFrame = requestAnimationFrame(draw)
  }

  const startCamera = async () => {
    if (starting || disposed) return
    if (!navigator.mediaDevices?.getUserMedia) {
      say('이 브라우저에서는 카메라를 사용할 수 없어요.')
      return
    }
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true
    stateLabel.textContent = 'LOADING'
    say('카메라와 얼굴·손 인식 모델을 준비하고 있어요…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      if (disposed || request !== cameraRequest) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      cameraStream = stream
      video.srcObject = stream
      await video.play()
      await ensureModels()
      if (disposed || request !== cameraRequest) return
      cameraActive = true
      lastFaceVideoTime = -1
      lastHandVideoTime = -1
      lastFaceDetectionTime = -Infinity
      lastHandDetectionTime = -Infinity
      lastRenderedVideoTime = -1
      renderDirty = true
      faceSeenAt = -Infinity
      root.classList.add('is-camera-active')
      toggleButton.textContent = '카메라 끄기'
      toggleButton.classList.add('is-active')
      stateLabel.textContent = 'SEARCHING'
      say('얼굴을 카메라 중앙에 보여 주세요.')
      cancelScheduledFrame()
      lastFrameTime = performance.now()
      animationFrame = requestAnimationFrame(draw)
    } catch {
      cameraStream?.getTracks().forEach((track) => track.stop())
      cameraStream = null
      cameraActive = false
      video.srcObject = null
      root.classList.remove('is-camera-active')
      stateLabel.textContent = 'ERROR'
      say('카메라 또는 인식 모델을 준비하지 못했어요. 권한과 인터넷 연결을 확인해 주세요.')
    } finally {
      starting = false
      toggleButton.disabled = false
    }
  }

  const toggleCamera = () => {
    if (cameraActive || cameraStream) stopCamera()
    else void startCamera()
  }

  const resizeObserver = new ResizeObserver(() => {
    resize()
    if (!cameraActive) {
      cancelScheduledFrame()
      animationFrame = requestAnimationFrame(draw)
    }
  })
  resizeObserver.observe(stage)
  toggleButton.addEventListener('click', toggleCamera)
  resize()
  animationFrame = requestAnimationFrame(draw)

  return () => {
    disposed = true
    cameraRequest += 1
    cancelScheduledFrame()
    resizeObserver.disconnect()
    toggleButton.removeEventListener('click', toggleCamera)
    cameraStream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
    faceLandmarker?.close()
    handLandmarker?.close()
    renderer.dispose()
  }
}
