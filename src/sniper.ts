import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const FACE_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/face_landmarker.task`
const INFERENCE_INTERVAL = 1000 / 24
const FACE_GRACE_MS = 520
const WINK_HOLD_MS = 180
const SHOT_COOLDOWN_MS = 760

type Landmark = { x: number; y: number; z: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const random = (min: number, max: number) => min + Math.random() * (max - min)

export function setupSniper(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('#sniper-canvas')!
  const context = canvas.getContext('2d', { alpha: false })
  const visualOverlay = document.createElement('canvas')
  const overlayContext = visualOverlay.getContext('2d')
  const video = root.querySelector<HTMLVideoElement>('#sniper-camera')!
  const toggleButton = root.querySelector<HTMLButtonElement>('#sniper-camera-toggle')!
  const status = root.querySelector<HTMLElement>('#sniper-status')!
  const scoreValue = root.querySelector<HTMLElement>('#sniper-score-value')!
  const hitCount = root.querySelector<HTMLElement>('#sniper-hit-count')!
  const shotCount = root.querySelector<HTMLElement>('#sniper-shot-count')!
  const leftEyeMeter = root.querySelector<HTMLElement>('#sniper-left-eye-meter')!
  const rightEyeMeter = root.querySelector<HTMLElement>('#sniper-right-eye-meter')!
  if (!context) return () => {}

  let width = 1
  let height = 1
  let pixelRatio = 1
  let animationFrame = 0
  let videoFrameRequest = 0
  let previousFrame = performance.now()
  let stream: MediaStream | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let visionPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null
  let starting = false
  let cameraActive = false
  let disposed = false
  let cameraRequest = 0
  let lastVideoTime = -1
  let lastInferenceAt = -Infinity
  let lastFaceAt = -Infinity
  let rawBlinkLeft = 0
  let rawBlinkRight = 0
  let rawYaw = 0
  let rawPitch = 0
  let blinkLeft = 0
  let blinkRight = 0
  let yaw = 0
  let pitch = 0
  let pitchBaseline: number | null = null
  let aiming = false
  let winkSince = -Infinity
  let score = 0
  let hits = 0
  let shots = 0
  let targetX = 0
  let targetY = 0
  let targetVelocity = 34
  let aimX = 0
  let aimY = 0
  let shotAt = -Infinity
  let lastShotAt = -Infinity
  let shotWasHit = false
  let shotPoints = 0
  let hitPulseAt = -Infinity

  const say = (message: string) => { status.textContent = message }

  const resize = () => {
    const box = root.getBoundingClientRect()
    width = Math.max(1, Math.round(box.width))
    height = Math.max(1, Math.round(box.height))
    pixelRatio = Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.8)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    visualOverlay.width = canvas.width
    visualOverlay.height = canvas.height
    if (overlayContext) {
      overlayContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      overlayContext.clearRect(0, 0, width, height)
      const grade = overlayContext.createRadialGradient(width * .5, height * .43, 0, width * .5, height * .45, Math.max(width, height) * .72)
      grade.addColorStop(0, 'rgba(116, 135, 119, .08)')
      grade.addColorStop(.58, 'rgba(9, 19, 18, .12)')
      grade.addColorStop(1, 'rgba(2, 7, 8, .58)')
      overlayContext.fillStyle = grade
      overlayContext.fillRect(0, 0, width, height)
      overlayContext.save()
      overlayContext.globalAlpha = .08
      overlayContext.strokeStyle = '#d8e4d5'
      overlayContext.lineWidth = 1
      overlayContext.beginPath()
      for (let y = 0; y < height; y += 5) {
        overlayContext.moveTo(0, y + .5)
        overlayContext.lineTo(width, y + .5)
      }
      overlayContext.stroke()
      overlayContext.restore()
    }
    aimX = aimX || width * .5
    aimY = height * .52
    targetX = targetX || width * .7
    targetY = height * .52
  }

  const drawCamera = (time: number) => {
    const hasCamera = cameraActive && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0
    if (hasCamera) {
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const drawWidth = video.videoWidth * scale
      const drawHeight = video.videoHeight * scale
      const recoil = time - shotAt < 120 ? Math.sin((time - shotAt) * .09) * 5 * (1 - (time - shotAt) / 120) : 0
      context.save()
      context.translate(width + recoil, 0)
      context.scale(-1, 1)
      context.filter = 'saturate(.7) contrast(1.08) brightness(.72)'
      context.drawImage(video, (width - drawWidth) * .5, (height - drawHeight) * .5, drawWidth, drawHeight)
      context.restore()
    } else {
      const background = context.createLinearGradient(0, 0, 0, height)
      background.addColorStop(0, '#293032')
      background.addColorStop(.55, '#151c1e')
      background.addColorStop(1, '#090d0e')
      context.fillStyle = background
      context.fillRect(0, 0, width, height)
    }

    context.drawImage(visualOverlay, 0, 0, width, height)
  }

  const targetRadius = () => clamp(Math.min(width, height) * .058, 31, 53)

  const moveTarget = (delta: number, time: number) => {
    if (!aiming) return
    const radius = targetRadius()
    targetX += targetVelocity * delta
    const left = Math.max(radius + 24, width * .13)
    const right = Math.min(width - radius - 24, width * .87)
    if (targetX < left) { targetX = left; targetVelocity = Math.abs(targetVelocity) }
    if (targetX > right) { targetX = right; targetVelocity = -Math.abs(targetVelocity) }
    targetY = height * .52 + Math.sin(time * .00075) * Math.min(10, height * .012)
  }

  const drawTarget = (time: number) => {
    if (!aiming && time - shotAt > 330) return
    const radius = targetRadius()
    const pulse = time - hitPulseAt < 420 ? 1 + Math.sin((time - hitPulseAt) * .025) * .13 : 1
    context.save()
    context.translate(targetX, targetY)
    context.scale(pulse, pulse)
    context.shadowColor = 'rgba(0,0,0,.42)'
    context.shadowBlur = 18
    context.fillStyle = '#ece9d7'
    context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill()
    context.shadowBlur = 0
    const rings = [
      { ratio: .78, color: '#bd3b36' },
      { ratio: .58, color: '#f1e9cf' },
      { ratio: .38, color: '#bd3b36' },
      { ratio: .17, color: '#251e1b' },
    ]
    rings.forEach((ring) => {
      context.fillStyle = ring.color
      context.beginPath(); context.arc(0, 0, radius * ring.ratio, 0, Math.PI * 2); context.fill()
    })
    context.strokeStyle = 'rgba(26, 22, 18, .72)'
    context.lineWidth = 2
    context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.stroke()
    context.restore()
  }

  const drawScope = (time: number) => {
    if (!aiming && time - shotAt > 330) return
    const radius = clamp(Math.min(width, height) * .28, 145, 270)
    const recoil = time - shotAt < 150 ? Math.sin((time - shotAt) * .08) * 8 * (1 - (time - shotAt) / 150) : 0
    const x = aimX + recoil
    const y = aimY

    context.save()
    context.fillStyle = 'rgba(0, 5, 6, .7)'
    context.beginPath()
    context.rect(0, 0, width, height)
    context.arc(x, y, radius, 0, Math.PI * 2, true)
    context.fill('evenodd')

    context.strokeStyle = 'rgba(210, 236, 213, .82)'
    context.lineWidth = 1.3
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke()
    context.strokeStyle = 'rgba(8, 17, 14, .92)'
    context.lineWidth = 2
    context.beginPath(); context.moveTo(x - radius, y); context.lineTo(x - 18, y); context.moveTo(x + 18, y); context.lineTo(x + radius, y); context.moveTo(x, y - radius); context.lineTo(x, y - 18); context.moveTo(x, y + 18); context.lineTo(x, y + radius); context.stroke()
    context.strokeStyle = 'rgba(219, 76, 67, .9)'
    context.lineWidth = 1
    context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.stroke()
    context.fillStyle = '#d95049'
    context.beginPath(); context.arc(x, y, 2.2, 0, Math.PI * 2); context.fill()

    for (let mark = -4; mark <= 4; mark += 1) {
      if (mark === 0) continue
      const offset = mark * radius * .09
      context.strokeStyle = 'rgba(9, 18, 15, .78)'
      context.lineWidth = 1
      context.beginPath(); context.moveTo(x + offset, y - 5); context.lineTo(x + offset, y + 5); context.stroke()
    }
    context.restore()
  }

  const drawShotEffect = (time: number) => {
    const elapsed = time - shotAt
    if (elapsed < 0 || elapsed > 650) return
    const progress = elapsed / 650
    if (elapsed < 95) {
      context.fillStyle = `rgba(255, 247, 213, ${.82 * (1 - elapsed / 95)})`
      context.fillRect(0, 0, width, height)
      const flash = context.createRadialGradient(aimX, aimY, 0, aimX, aimY, Math.min(width, height) * .24)
      flash.addColorStop(0, `rgba(255,255,255,${1 - elapsed / 95})`)
      flash.addColorStop(.25, `rgba(255,198,103,${.8 * (1 - elapsed / 95)})`)
      flash.addColorStop(1, 'rgba(255,140,60,0)')
      context.fillStyle = flash
      context.fillRect(0, 0, width, height)
    }
    context.save()
    context.globalAlpha = clamp(1 - progress, 0, 1)
    context.translate(width * .5, height * .36 - progress * 14)
    context.textAlign = 'center'
    context.font = `900 ${clamp(width * .035, 28, 52)}px Inter, sans-serif`
    context.fillStyle = shotWasHit ? '#e5ff78' : '#ffffff'
    context.shadowColor = shotWasHit ? 'rgba(192,255,53,.55)' : 'rgba(0,0,0,.55)'
    context.shadowBlur = 18
    context.fillText(shotWasHit ? `HIT  +${shotPoints}` : 'MISS', 0, 0)
    context.restore()
  }

  const updateScore = () => {
    scoreValue.textContent = String(score).padStart(4, '0')
    hitCount.textContent = String(hits)
    shotCount.textContent = String(shots)
  }

  const activateAim = () => {
    aiming = true
    targetX = random(width * .2, width * .8)
    targetY = height * .52
    targetVelocity = (Math.random() < .5 ? -1 : 1) * random(27, 39)
    root.classList.add('is-aiming')
    say('한쪽 눈을 감은 채 고개로 조준하세요. 두 눈을 뜨는 순간 발사됩니다.')
  }

  const fire = (time: number) => {
    const hitDistance = Math.hypot(aimX - targetX, aimY - targetY)
    const distanceRatio = hitDistance / targetRadius()
    shotPoints = distanceRatio <= .17 ? 100
      : distanceRatio <= .38 ? 80
        : distanceRatio <= .58 ? 60
          : distanceRatio <= .78 ? 40
            : distanceRatio <= 1 ? 20 : 0
    shotWasHit = shotPoints > 0
    shots += 1
    if (shotWasHit) { hits += 1; score += shotPoints; hitPulseAt = time }
    shotAt = time
    lastShotAt = time
    aiming = false
    root.classList.remove('is-aiming')
    root.classList.add('is-firing')
    window.setTimeout(() => { if (!disposed) root.classList.remove('is-firing') }, 180)
    updateScore()
    say(shotWasHit ? `명중! ${shotPoints}점을 획득했어요. 다시 한쪽 눈을 감아 조준하세요.` : '빗나갔어요. 다시 한쪽 눈을 감아 조준하세요.')
  }

  const updateFaceSignals = (time: number, delta: number) => {
    if (time - lastFaceAt > FACE_GRACE_MS) {
      rawBlinkLeft = 0
      rawBlinkRight = 0
      rawYaw = 0
      rawPitch = 0
    }
    const fast = 1 - Math.exp(-delta * 13)
    const steady = 1 - Math.exp(-delta * 7)
    blinkLeft += (rawBlinkLeft - blinkLeft) * fast
    blinkRight += (rawBlinkRight - blinkRight) * fast
    yaw += (rawYaw - yaw) * steady
    pitch += (rawPitch - pitch) * steady
    aimX += ((width * .5 + yaw * width * .37) - aimX) * (1 - Math.exp(-delta * 8))
    aimX = clamp(aimX, width * .08, width * .92)
    aimY += ((height * .52 + pitch * height * .33) - aimY) * (1 - Math.exp(-delta * 8))
    aimY = clamp(aimY, height * .14, height * .86)

    leftEyeMeter.style.width = `${clamp(blinkLeft * 100, 0, 100)}%`
    rightEyeMeter.style.width = `${clamp(blinkRight * 100, 0, 100)}%`

    const oneEyeClosed = Math.max(blinkLeft, blinkRight) > .55 && Math.min(blinkLeft, blinkRight) < .34
    if (!aiming && oneEyeClosed && time - shotAt > 500) {
      if (!Number.isFinite(winkSince)) winkSince = time
      if (time - winkSince >= WINK_HOLD_MS) activateAim()
    } else if (!oneEyeClosed) winkSince = -Infinity

    const bothEyesOpen = blinkLeft < .24 && blinkRight < .24
    if (aiming && bothEyesOpen && time - lastShotAt > SHOT_COOLDOWN_MS) fire(time)
  }

  const updateTracking = (time: number) => {
    if (!cameraActive || !faceLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    if (video.currentTime === lastVideoTime || time - lastInferenceAt < INFERENCE_INTERVAL) return
    lastVideoTime = video.currentTime
    lastInferenceAt = time
    try {
      const result = faceLandmarker.detectForVideo(video, time)
      const categories = result.faceBlendshapes[0]?.categories
      const landmarks = result.faceLandmarks[0] as Landmark[] | undefined
      if (!categories?.length || !landmarks?.[454]) return
      lastFaceAt = time
      const scoreFor = (name: string) => categories.find((category) => category.categoryName === name)?.score ?? 0
      rawBlinkLeft = scoreFor('eyeBlinkLeft')
      rawBlinkRight = scoreFor('eyeBlinkRight')
      const leftCheek = landmarks[234]
      const rightCheek = landmarks[454]
      const nose = landmarks[1]
      const midpoint = (leftCheek.x + rightCheek.x) * .5
      const faceWidth = Math.max(.04, Math.abs(rightCheek.x - leftCheek.x))
      rawYaw = clamp((midpoint - nose.x) / faceWidth * 3.4, -1, 1)
      const forehead = landmarks[10]
      const chin = landmarks[152]
      const faceHeight = Math.max(.05, Math.abs(chin.y - forehead.y))
      const pitchPosition = (nose.y - (forehead.y + chin.y) * .5) / faceHeight
      if (pitchBaseline === null) pitchBaseline = pitchPosition
      else if (!aiming && rawBlinkLeft < .3 && rawBlinkRight < .3) pitchBaseline += (pitchPosition - pitchBaseline) * .018
      rawPitch = clamp((pitchPosition - pitchBaseline) * 7.2, -1, 1)
    } catch {
      // Keep rendering when a single inference frame is dropped.
    }
  }

  const scheduleNextFrame = () => {
    if (disposed || !cameraActive) return
    const animationActive = aiming || performance.now() - shotAt < 700
    if (!animationActive && 'requestVideoFrameCallback' in video) {
      videoFrameRequest = video.requestVideoFrameCallback((time) => {
        videoFrameRequest = 0
        draw(time)
      })
    } else {
      animationFrame = requestAnimationFrame(draw)
    }
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
    if (document.hidden) {
      previousFrame = time
      scheduleNextFrame()
      return
    }
    const delta = Math.min(.034, Math.max(.001, (time - previousFrame) / 1000))
    previousFrame = time
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    updateTracking(time)
    updateFaceSignals(time, delta)
    moveTarget(delta, time)
    drawCamera(time)
    drawTarget(time)
    drawScope(time)
    drawShotEffect(time)
    scheduleNextFrame()
  }

  const getVision = () => {
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    return visionPromise
  }

  const ensureFaceLandmarker = async () => {
    if (faceLandmarker) return faceLandmarker
    const vision = await getVision()
    if (disposed) throw new Error('Sniper has been disposed.')
    const options = {
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: .56,
      minFacePresenceConfidence: .55,
      minTrackingConfidence: .55,
    }
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' } })
    } catch (error) {
      if (disposed) throw error
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' } })
    }
    if (disposed) { faceLandmarker.close(); faceLandmarker = null; throw new Error('Sniper has been disposed.') }
    return faceLandmarker
  }

  const stopCamera = () => {
    cameraRequest += 1
    cameraActive = false
    cancelScheduledFrame()
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    aiming = false
    root.classList.remove('is-camera-active', 'is-aiming', 'is-firing')
    toggleButton.classList.remove('is-active')
    toggleButton.textContent = '카메라 시작'
    rawBlinkLeft = 0
    rawBlinkRight = 0
    blinkLeft = 0
    blinkRight = 0
    leftEyeMeter.style.width = '0%'
    rightEyeMeter.style.width = '0%'
    say('카메라가 꺼졌어요.')
    animationFrame = requestAnimationFrame(draw)
  }

  const startCamera = async () => {
    if (starting || disposed) return
    if (!navigator.mediaDevices?.getUserMedia) { say('이 브라우저에서는 카메라를 사용할 수 없어요.'); return }
    starting = true
    const request = ++cameraRequest
    toggleButton.disabled = true
    say('카메라와 얼굴 인식 모델을 준비하고 있어요…')
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false,
      })
      if (disposed || request !== cameraRequest) { nextStream.getTracks().forEach((track) => track.stop()); return }
      stream = nextStream
      video.srcObject = nextStream
      await Promise.all([video.play(), ensureFaceLandmarker()])
      if (disposed || request !== cameraRequest) return
      cameraActive = true
      lastVideoTime = -1
      lastInferenceAt = -Infinity
      lastFaceAt = -Infinity
      pitchBaseline = null
      rawPitch = 0
      pitch = 0
      root.classList.add('is-camera-active')
      toggleButton.classList.add('is-active')
      toggleButton.textContent = '카메라 끄기'
      say('한쪽 눈을 잠시 감으면 조준경이 나타납니다. 고개를 상하좌우로 움직여 보세요.')
      cancelScheduledFrame()
      previousFrame = performance.now()
      animationFrame = requestAnimationFrame(draw)
    } catch {
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      video.srcObject = null
      say('카메라 또는 얼굴 인식 모델을 준비하지 못했어요. 권한을 확인해 주세요.')
    } finally {
      starting = false
      toggleButton.disabled = false
    }
  }

  const toggleCamera = () => {
    if (cameraActive || stream) stopCamera()
    else void startCamera()
  }

  const resizeObserver = new ResizeObserver(() => {
    resize()
    if (!cameraActive) {
      cancelScheduledFrame()
      animationFrame = requestAnimationFrame(draw)
    }
  })
  resizeObserver.observe(root)
  toggleButton.addEventListener('click', toggleCamera)
  resize()
  updateScore()
  animationFrame = requestAnimationFrame(draw)

  return () => {
    disposed = true
    cameraRequest += 1
    cancelScheduledFrame()
    resizeObserver.disconnect()
    toggleButton.removeEventListener('click', toggleCamera)
    stream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
    faceLandmarker?.close()
  }
}
