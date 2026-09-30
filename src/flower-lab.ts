import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const FINGER_COUNT = 5
const PETAL_COUNT = FINGER_COUNT
const PETAL_OPEN_ORDER = [0, 4, 1, 3, 2]
const PETAL_OPEN_RANK = PETAL_OPEN_ORDER.reduce<number[]>((ranks, petalIndex, rank) => {
  ranks[petalIndex] = rank
  return ranks
}, [])

type Landmark = { x: number; y: number; z: number }
type TrackedHand = { fingers: number; openness: number; landmarks: Landmark[] }
type PetalPose = {
  closed: [x: number, y: number, z: number, rotateX: number, rotateY: number, rotateZ: number, scale: number]
  open: [x: number, y: number, z: number, rotateX: number, rotateY: number, rotateZ: number, scale: number]
}

// Every complete petal shares one attachment point at the base of the flower.
// It unfolds around that hinge with three-dimensional rotations instead of
// moving away from the flower like a sliced image fragment.
const PETAL_POSES: PetalPose[] = [
  { closed: [0, 0, -38, -10, 18, -4, 0.56], open: [-8, 8, -28, 70, -22, -64, 1.08] },
  { closed: [0, 0, -22, -8, 10, -2, 0.62], open: [-4, -4, 10, 44, -13, -32, 1.04] },
  { closed: [0, 0, -12, -6, 0, 0, 0.68], open: [0, -18, -38, 16, 0, 0, 1.02] },
  { closed: [0, 0, -22, -8, -10, 2, 0.62], open: [4, -4, 10, 44, 13, 32, 1.04] },
  { closed: [0, 0, -38, -10, -18, 4, 0.56], open: [8, 8, -28, 70, 22, 64, 1.08] },
]

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress

export function setupFlowerLab(root: HTMLElement) {
  const video = root.querySelector<HTMLVideoElement>('#lab-camera')!
  const toggle = root.querySelector<HTMLButtonElement>('#lab-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#lab-status')!
  const counter = root.querySelector<HTMLElement>('#lab-finger-count')!
  const lotus = root.querySelector<HTMLElement>('#lab-lotus')!
  const lotusBud = root.querySelector<HTMLImageElement>('#lab-lotus-bud')!
  const lotusBloom = root.querySelector<HTMLElement>('#lab-lotus-bloom')!
  const lotusComplete = root.querySelector<HTMLImageElement>('#lab-lotus-complete')!
  const petalElements = Array.from(root.querySelectorAll<HTMLImageElement>('[data-lotus-petal]'))
    .sort((first, second) => Number(first.dataset.lotusPetal) - Number(second.dataset.lotusPetal))
  if (petalElements.length !== PETAL_COUNT) return () => {}

  const lowPower = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  const trackingInterval = 1000 / (lowPower ? 20 : 24)

  let landmarker: HandLandmarker | null = null
  let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
  let stream: MediaStream | null = null
  let animationFrame = 0
  let videoFrameRequest = 0
  let disposed = false
  let active = false
  let starting = false
  let lastVideoTime = -1
  let lastDetection = -Infinity
  let lastFrame = performance.now()
  const petalProgress = Array(PETAL_COUNT).fill(0) as number[]
  const petalVelocity = Array(PETAL_COUNT).fill(0) as number[]
  let targetPetalCount = 0
  let candidatePetalCount = 0
  let candidatePetalSince = -Infinity
  let lastHandSeenAt = -Infinity
  let consecutiveDetectionErrors = 0
  let lastOpenness = 0
  let lastOpennessAt = -Infinity
  let gestureEnergy = 0
  let announcedPetalCount = -1
  let lotusDirty = true
  let lotusUnit = .48

  const say = (message: string) => { status.textContent = message }

  const resizeLayout = () => {
    lotusUnit = Math.max(0.48, lotus.getBoundingClientRect().width / 700)
    lotusDirty = true
  }

  const getHand = (landmarks: Landmark[]): TrackedHand => {
    const wrist = landmarks[0]
    const palmSize = Math.max(0.001, Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y))
    const fingerPairs: Array<[number, number, number]> = [[4, 3, 1.02], [8, 6, 1.3], [12, 10, 1.36], [16, 14, 1.28], [20, 18, 1.16]]
    const fingers = fingerPairs.reduce((count, [tipIndex, jointIndex, threshold]) => {
      const tip = landmarks[tipIndex]
      const joint = landmarks[jointIndex]
      const tipDistance = Math.hypot(tip.x - wrist.x, tip.y - wrist.y) / palmSize
      const jointDistance = Math.hypot(joint.x - wrist.x, joint.y - wrist.y) / palmSize
      return count + (tipDistance > Math.max(threshold, jointDistance + 0.1) ? 1 : 0)
    }, 0)
    const spread = [4, 8, 12, 16, 20].reduce((sum, index) => sum + Math.hypot(landmarks[index].x - wrist.x, landmarks[index].y - wrist.y) / palmSize, 0) / 5
    const fingerChains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
    const curlOpenness = fingerChains.reduce((sum, chain, chainIndex) => {
      const base = landmarks[chain[0]]
      const tip = landmarks[chain[chain.length - 1]]
      const chord = Math.hypot(tip.x - base.x, tip.y - base.y, tip.z - base.z)
      let path = 0
      for (let index = 1; index < chain.length; index += 1) {
        const first = landmarks[chain[index - 1]]
        const second = landmarks[chain[index]]
        path += Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z)
      }
      const ratio = chord / Math.max(0.001, path)
      const closedRatio = chainIndex === 0 ? 0.48 : 0.5
      const openRatio = chainIndex === 0 ? 0.88 : 0.93
      return sum + clamp((ratio - closedRatio) / (openRatio - closedRatio), 0, 1)
    }, 0) / fingerChains.length
    const radialOpenness = clamp((spread - 1.1) / 1.05, 0, 1)
    return { fingers, openness: clamp(curlOpenness * 0.78 + radialOpenness * 0.22, 0, 1), landmarks }
  }

  const createLandmarker = async () => {
    if (landmarker) return landmarker
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    const vision = await visionPromise
    if (disposed) throw new Error('Lab has been disposed.')
    const created = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH }, runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    })
    if (disposed) { created.close(); throw new Error('Lab has been disposed.') }
    landmarker = created
    return landmarker
  }

  const updateTracking = (now: number) => {
    if (!active || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    if (video.currentTime === lastVideoTime || now - lastDetection < trackingInterval) return
    lastVideoTime = video.currentTime; lastDetection = now
    try {
      const result = landmarker.detectForVideo(video, now)
      consecutiveDetectionErrors = 0
      const controlHand = result.landmarks[0] ? getHand(result.landmarks[0] as Landmark[]) : null
      const fingerCount = controlHand?.fingers || 0
      const fullyOpen = fingerCount === FINGER_COUNT
      if (controlHand) {
        lastHandSeenAt = now
        if (Number.isFinite(lastOpennessAt)) {
          const elapsed = Math.max(0.016, (now - lastOpennessAt) / 1000)
          const opennessVelocity = Math.abs(controlHand.openness - lastOpenness) / elapsed
          gestureEnergy = Math.max(gestureEnergy * 0.72, clamp(opennessVelocity * 0.3, 0, 1))
        }
        lastOpenness = controlHand.openness; lastOpennessAt = now
        const detectedPetalCount = fullyOpen ? 5 : fingerCount
        if (detectedPetalCount !== candidatePetalCount) {
          candidatePetalCount = detectedPetalCount
          candidatePetalSince = now
        }
        const stableFor = detectedPetalCount === 0 || detectedPetalCount === 5 ? 70 : 110
        if (now - candidatePetalSince >= stableFor && targetPetalCount !== detectedPetalCount) {
          targetPetalCount = detectedPetalCount
          lotusDirty = true
        }
        const openPetals = targetPetalCount
        counter.textContent = `${targetPetalCount} / ${FINGER_COUNT} · ${openPetals} PETALS`
        if (announcedPetalCount !== targetPetalCount) {
          announcedPetalCount = targetPetalCount
          if (targetPetalCount === 5) say('다섯 손가락을 모두 폈어요. 연꽃이 만개했습니다.')
          else if (targetPetalCount === 0) say('손을 오므렸어요. 연꽃이 봉오리로 돌아갑니다.')
          else say(`손가락 ${targetPetalCount}개를 인식했어요. 온전한 꽃잎 ${openPetals}장이 겹겹이 열립니다.`)
        }
      } else if (now - lastHandSeenAt > 420) {
        targetPetalCount = 0; candidatePetalCount = 0; candidatePetalSince = now; lotusDirty = true
        counter.textContent = '0 / 5 · 0 PETALS'
        announcedPetalCount = -1
      }
    } catch {
      consecutiveDetectionErrors += 1
      lastVideoTime = -1
      if (consecutiveDetectionErrors === 1) say('손 인식을 다시 맞추고 있어요. 손바닥을 카메라 정면에 보여 주세요.')
    }
  }

  const updateLotus3D = () => {
    const bloomMix = petalProgress.reduce((sum, progress) => sum + progress, 0) / PETAL_COUNT
    const completeInput = clamp((Math.min(...petalProgress) - 0.72) / 0.28, 0, 1)
    const completeMix = completeInput * completeInput * (3 - completeInput * 2)
    lotusBud.style.opacity = String(1 - bloomMix)
    lotusBloom.style.opacity = String(1 - completeMix)
    lotusComplete.style.opacity = String(completeMix)
    lotusComplete.style.transform = `scale(${lerp(0.94, 1, completeMix)})`

    petalElements.forEach((petal, index) => {
      const progress = petalProgress[index]
      const opened = 1 - Math.pow(1 - progress, 3)
      const pose = PETAL_POSES[index]
      const values = pose.closed.map((value, valueIndex) => lerp(value, pose.open[valueIndex], opened))
      const [x, y, z, rotateX, rotateY, rotateZ, scale] = values
      petal.style.transform = `translate3d(calc(-50% + ${x * lotusUnit}px), ${y * lotusUnit}px, ${z * lotusUnit}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`
      petal.style.opacity = String(clamp(progress * 1.6, 0, 1))
      petal.style.zIndex = String(Math.round(100 + z))
    })

  }

  const scheduleNextFrame = (motionActive = false) => {
    if (disposed || (!active && !motionActive)) return
    if (active && !motionActive && 'requestVideoFrameCallback' in video) {
      videoFrameRequest = video.requestVideoFrameCallback((now) => {
        videoFrameRequest = 0
        frame(now)
      })
    } else animationFrame = requestAnimationFrame(frame)
  }

  const cancelScheduledFrame = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = 0
    if (videoFrameRequest && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(videoFrameRequest)
    videoFrameRequest = 0
  }

  const frame = (now: number) => {
    if (disposed) return
    animationFrame = 0
    videoFrameRequest = 0
    if (document.hidden) { lastFrame = now; scheduleNextFrame(); return }
    const delta = Math.min(0.06, (now - lastFrame) / 1000); lastFrame = now
    updateTracking(now)
    gestureEnergy *= Math.pow(0.12, delta)
    const stiffness = 48 + gestureEnergy * 115
    const damping = 13 + gestureEnergy * 5
    let petalsChanged = lotusDirty
    let motionActive = false
    petalProgress.forEach((progress, index) => {
      const target = PETAL_OPEN_RANK[index] < targetPetalCount ? 1 : 0
      petalVelocity[index] += (target - progress) * stiffness * delta
      petalVelocity[index] *= Math.exp(-damping * delta)
      let next = clamp(progress + petalVelocity[index] * delta, 0, 1)
      if (Math.abs(target - next) <= .0005 && Math.abs(petalVelocity[index]) <= .001) {
        next = target
        petalVelocity[index] = 0
      }
      if (Math.abs(next - progress) > 0.0005) petalsChanged = true
      petalProgress[index] = next
      if ((next === 0 && petalVelocity[index] < 0) || (next === 1 && petalVelocity[index] > 0)) petalVelocity[index] = 0
      if (Math.abs(target - next) > .0005 || Math.abs(petalVelocity[index]) > .001) motionActive = true
    })
    if (petalsChanged) { updateLotus3D(); lotusDirty = false }
    scheduleNextFrame(motionActive)
  }

  const start = async () => {
    if (starting || active || disposed) return
    starting = true; toggle.disabled = true; say('손 인식 모델과 카메라를 준비하고 있어요…')
    try {
      await createLandmarker()
      if (disposed) return
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (disposed) { stream.getTracks().forEach((track) => track.stop()); return }
      lastVideoTime = -1; lastDetection = -Infinity; lastHandSeenAt = -Infinity; lastOpennessAt = -Infinity; gestureEnergy = 0; announcedPetalCount = -1; candidatePetalCount = 0; candidatePetalSince = -Infinity; consecutiveDetectionErrors = 0
      petalVelocity.fill(0)
      video.srcObject = stream; await video.play()
      if (disposed) return
      active = true; toggle.textContent = '카메라 끄기'; toggle.classList.add('is-active')
      say('주먹은 봉오리, 손가락을 하나씩 펴면 온전한 연꽃잎이 3차원으로 열려요.')
      cancelScheduledFrame()
      lastFrame = performance.now()
      animationFrame = requestAnimationFrame(frame)
    } catch { say('카메라를 시작하지 못했어요. 브라우저의 카메라 권한을 확인해 주세요.') }
    finally { starting = false; toggle.disabled = false }
  }

  const stop = () => {
    active = false; targetPetalCount = 0; candidatePetalCount = 0; candidatePetalSince = -Infinity; lastHandSeenAt = -Infinity; lastOpennessAt = -Infinity; gestureEnergy = 0; announcedPetalCount = -1; lastVideoTime = -1; lastDetection = -Infinity; counter.textContent = '0 / 5 · 0 PETALS'; lotusDirty = true
    stream?.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null
    toggle.textContent = '카메라 시작'; toggle.classList.remove('is-active'); say('카메라가 꺼졌어요. 다시 켜면 손가락으로 연꽃을 피울 수 있어요.')
    cancelScheduledFrame()
    lastFrame = performance.now()
    animationFrame = requestAnimationFrame(frame)
  }

  const onToggle = () => { if (active) stop(); else void start() }
  const onVisibilityChange = () => {
    if (document.hidden || disposed) return
    cancelScheduledFrame()
    lastFrame = performance.now()
    animationFrame = requestAnimationFrame(frame)
  }
  const resizeObserver = new ResizeObserver(() => {
    resizeLayout()
    if (!active) {
      cancelScheduledFrame()
      animationFrame = requestAnimationFrame(frame)
    }
  })
  resizeObserver.observe(lotus)
  resizeLayout()
  toggle.addEventListener('click', onToggle)
  document.addEventListener('visibilitychange', onVisibilityChange)
  updateLotus3D()
  animationFrame = requestAnimationFrame(frame)
  return () => {
    stop()
    disposed = true
    cancelScheduledFrame()
    resizeObserver.disconnect()
    toggle.removeEventListener('click', onToggle)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    landmarker?.close()
  }
}
