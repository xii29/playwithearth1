import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { createLuminanceGridRenderer, randomWindowEffect, type EffectMode } from './travel-effects'
import { PalmTurn } from './palm-turn'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const HAND_MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`
const DEFAULT_IMAGE_PATH = `${import.meta.env.BASE_URL}fire.jpeg`
const MIRROR_EFFECT_CAMERA: boolean = true
const HAND_CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]] as const

type SourceMedia = HTMLImageElement | HTMLVideoElement
type DetectedBlob = { x: number; y: number; minX: number; minY: number; maxX: number; maxY: number; area: number }
type TrackedBlob = DetectedBlob & { id: number; lastSeen: number }
type SavedPhoto = { id?: number; name: string; blob: Blob; createdAt: number }
type Landmark = { x: number; y: number; z: number }
type Point = { x: number; y: number }
type EffectCorners = [topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point]
type EffectWindow = {
  corners: EffectCorners
  targetCorners: EffectCorners
  depth: number
  targetDepth: number
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export function setupTravel(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('.travel-stage')!
  const output = root.querySelector<HTMLCanvasElement>('#effect-output')!
  const camera = root.querySelector<HTMLVideoElement>('#effect-camera')!
  const status = root.querySelector<HTMLElement>('#travel-status')!
  const modeName = root.querySelector<HTMLElement>('#travel-effect-mode-name')!
  const modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-effect-mode]'))
  const colorButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-color-mode]')]
  const toolbarToggle = root.querySelector<HTMLButtonElement>('#effect-toolbar-toggle')!
  const toolbarContent = root.querySelector<HTMLElement>('#effect-toolbar-content')!
  const controlLabel = root.querySelector<HTMLElement>('#travel-effect-control-label')!
  const effectRange = root.querySelector<HTMLInputElement>('#travel-effect-range')!
  const effectValue = root.querySelector<HTMLOutputElement>('#travel-effect-value')!
  const paletteEditor = root.querySelector<HTMLElement>('#recolor-palette-editor')!
  const recolorSwatches = root.querySelector<HTMLElement>('#recolor-swatches')!
  const randomizeButton = root.querySelector<HTMLButtonElement>('#recolor-randomize')!
  const addColorButton = root.querySelector<HTMLButtonElement>('#recolor-add-color')!
  const mediaInput = root.querySelector<HTMLInputElement>('#effect-media-input')!
  const savePhotoButton = root.querySelector<HTMLButtonElement>('#effect-save-photo')!
  const capturePhotoButton = root.querySelector<HTMLButtonElement>('#effect-capture-photo')!
  const recordVideoButton = root.querySelector<HTMLButtonElement>('#effect-record-video')!
  const savedPhotos = root.querySelector<HTMLElement>('#effect-saved-photos')!
  const blobCount = root.querySelector<HTMLElement>('#effect-blob-count')!
  const context = output.getContext('2d', { alpha: false, desynchronized: true })
  if (!context) return () => {}

  const lowPowerDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  const handInferenceInterval = 1000 / (lowPowerDevice ? 18 : 24)
  const maximumPixelRatio = lowPowerDevice ? 1.2 : 1.5
  const sampleCanvas = document.createElement('canvas')
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })!
  const heatCanvas = document.createElement('canvas')
  const heatContext = heatCanvas.getContext('2d')!
  const defaultImage = new Image()
  defaultImage.src = DEFAULT_IMAGE_PATH

  const renderLuminanceGrid = createLuminanceGridRenderer()
  const modeLabels: Record<EffectMode, string> = { pixel: 'PIXEL', blur: 'BLUR', recolor: 'RECOLOR', lightmap: 'BRIGHT MAP', melt: 'MELTED SPECTRUM', thermal: 'THERMAL CAMERA' }
  const settings: Record<EffectMode, { label: string; min: number; max: number; step: number }> = {
    pixel: { label: '픽셀 개수', min: 24, max: 144, step: 4 },
    blur: { label: '블러 강도', min: 0, max: 28, step: 1 },
    recolor: { label: '컬러 도수', min: 1, max: 6, step: 1 },
    lightmap: { label: '밝기 기준', min: 42, max: 92, step: 1 },
    melt: { label: '멜트 · 글로우 강도', min: 24, max: 96, step: 4 },
    thermal: { label: '열화상 색상 대비', min: 24, max: 96, step: 4 },
  }
  const effectAmounts: Record<EffectMode, number> = { pixel: 72, blur: 8, recolor: 2, lightmap: 64, melt: 64, thermal: 80 }
  let monochrome = false
  let windowGestureActive = false
  let lastWindowGestureAt = -Infinity

  const hslToHex = (hue: number, saturation: number, lightness: number) => {
    const saturationRatio = saturation / 100
    const lightnessRatio = lightness / 100
    const channel = (offset: number) => {
      const value = (offset + hue / 30) % 12
      const amount = saturationRatio * Math.min(lightnessRatio, 1 - lightnessRatio)
      return lightnessRatio - amount * Math.max(-1, Math.min(value - 3, 9 - value, 1))
    }
    return `#${[channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
  }
  const makeRandomPalette = () => {
    const baseHue = Math.random() * 360
    return Array.from({ length: 6 }, (_, index) => hslToHex(
      (baseHue + index * (34 + Math.random() * 42)) % 360,
      48 + Math.random() * 38,
      16 + index * 13 + Math.random() * 5,
    ))
  }
  const hexToRgb = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
  let customRecolorPalette = makeRandomPalette()

  let width = 1
  let height = 1
  let pixelRatio = 1
  let effectMode: EffectMode = 'pixel'
  let activeSource: SourceMedia = defaultImage
  let sourceBeforeCamera: SourceMedia = defaultImage
  let activePhotoBlob: Blob | null = null
  let activePhotoName = ''
  let cameraStream: MediaStream | null = null
  let uploadedVideo: HTMLVideoElement | null = null
  let activeObjectUrl: string | null = null
  let savedObjectUrls: string[] = []
  let animationFrame = 0
  let disposed = false
  let needsRender = true
  let lastVideoRender = -Infinity
  let lastStatus = ''
  let nextBlobId = 1
  let trackedBlobs: TrackedBlob[] = []
  let mediaRecorder: MediaRecorder | null = null
  let recordingStream: MediaStream | null = null
  let recordedChunks: Blob[] = []
  let brightPixels = new Uint8Array(0)
  let visitedPixels = new Uint8Array(0)
  let blobStack = new Int32Array(0)
  let heatImage: ImageData | null = null
  let displayedEffectValue = ''
  let displayedBlobCount = -1
  let hasDisplayedBrightBlobs = false
  let handLandmarker: HandLandmarker | null = null
  let visionPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
  let lastHandVideoTime = -1
  let lastHandDetection = -Infinity
  const effectWindows = new Map<string, EffectWindow>()
  let trackedHands: Landmark[][] = []
  let handsVisibleAt = -Infinity
  const handOverlayPoints = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }))

  const resizeWorkingCanvas = (canvas: HTMLCanvasElement, nextWidth: number, nextHeight: number) => {
    const roundedWidth = Math.max(1, Math.round(nextWidth))
    const roundedHeight = Math.max(1, Math.round(nextHeight))
    if (canvas.width === roundedWidth && canvas.height === roundedHeight) return false
    canvas.width = roundedWidth
    canvas.height = roundedHeight
    return true
  }

  const displayEffectValue = (value: string) => {
    if (displayedEffectValue === value) return
    displayedEffectValue = value
    effectValue.value = value
  }

  const displayBlobState = (count: number) => {
    if (displayedBlobCount !== count) {
      displayedBlobCount = count
      blobCount.textContent = String(count)
    }
    const hasBlobs = count > 0
    if (hasDisplayedBrightBlobs === hasBlobs) return
    hasDisplayedBrightBlobs = hasBlobs
    root.classList.toggle('has-bright-blobs', hasBlobs)
  }

  const say = (message: string) => {
    if (lastStatus === message) return
    lastStatus = message
    status.textContent = message
  }

  const sourceSize = (source: SourceMedia) => source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.naturalWidth, height: source.naturalHeight }

  const sourceReady = (source: SourceMedia) => source instanceof HTMLVideoElement
    ? source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0
    : source.complete && source.naturalWidth > 0

  const drawCover = (drawingContext: CanvasRenderingContext2D, source: SourceMedia, targetWidth: number, targetHeight: number, overscan = 1) => {
    const dimensions = sourceSize(source)
    const scale = Math.max(targetWidth / dimensions.width, targetHeight / dimensions.height) * overscan
    const drawnWidth = dimensions.width * scale
    const drawnHeight = dimensions.height * scale
    const drawX = (targetWidth - drawnWidth) * 0.5
    const drawY = (targetHeight - drawnHeight) * 0.5
    if (source === camera && MIRROR_EFFECT_CAMERA) {
      drawingContext.save()
      drawingContext.translate(targetWidth, 0)
      drawingContext.scale(-1, 1)
      drawingContext.drawImage(source, drawX, drawY, drawnWidth, drawnHeight)
      drawingContext.restore()
      return
    }
    drawingContext.drawImage(source, drawX, drawY, drawnWidth, drawnHeight)
  }

  const ensureHandLandmarker = async () => {
    if (handLandmarker) return handLandmarker
    visionPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    const vision = await visionPromise
    if (disposed) throw new Error('Effect was disposed.')
    const created = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL_PATH },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    if (disposed) { created.close(); throw new Error('Effect was disposed.') }
    handLandmarker = created
    return created
  }

  const projectLandmark = (landmark: Landmark) => {
    const videoWidth = camera.videoWidth || 1280
    const videoHeight = camera.videoHeight || 720
    const scale = Math.max(width / videoWidth, height / videoHeight)
    const drawnWidth = videoWidth * scale
    const drawnHeight = videoHeight * scale
    const normalizedX = MIRROR_EFFECT_CAMERA ? 1 - landmark.x : landmark.x
    return { x: (width - drawnWidth) * 0.5 + normalizedX * drawnWidth, y: (height - drawnHeight) * 0.5 + landmark.y * drawnHeight }
  }

  const selectRandomGestureEffect = () => {
    const next = randomWindowEffect(effectMode)
    if (next.mode === 'recolor') effectAmounts.recolor = next.recolorAmount
    selectEffectMode(next.mode)
  }
  const palmTurn=new PalmTurn()

  const updateHandWindows = (now: number) => {
    if (!cameraStream || !handLandmarker || camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    if (camera.currentTime === lastHandVideoTime || now - lastHandDetection < handInferenceInterval) return
    lastHandVideoTime = camera.currentTime
    lastHandDetection = now
    try {
      const result = handLandmarker.detectForVideo(camera, now)
      if(palmTurn.update(result.landmarks as Landmark[][],result.handedness.map(h=>h[0]?.categoryName??''),now)){selectRandomGestureEffect();say('손바닥을 앞으로 돌려 효과를 바꿨어요.')}
      trackedHands = result.landmarks.slice(0, 2).filter(hand => hand.length >= 21) as Landmark[][]
      handsVisibleAt = now
      const hands = result.landmarks.slice(0, 2).map((detectedLandmarks) => {
        const landmarks = detectedLandmarks as Landmark[]
        if (landmarks.length < 21) return null
        const thumb = projectLandmark(landmarks[4])
        const index = projectLandmark(landmarks[8])
        const midpoint = { x: (thumb.x + index.x) * 0.5, y: (thumb.y + index.y) * 0.5 }

        // Palm width alone changes too much when the hand rolls. Combining width,
        // length and fingertip Z keeps camera-distance estimation stable.
        const palmWidth = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y)
        const palmLength = Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y)
        const apparentPalmSize = Math.sqrt(Math.max(0.000001, palmWidth * palmLength))
        const palmZ = (landmarks[0].z + landmarks[5].z + landmarks[9].z + landmarks[17].z) * 0.25
        const fingertipZ = (landmarks[4].z + landmarks[8].z) * 0.5
        const forwardReach = clamp((palmZ - fingertipZ + 0.015) / 0.17, 0, 1)
        const sizeDepth = clamp((apparentPalmSize - 0.065) / 0.19, 0, 1)
        const proximity = clamp(sizeDepth * 0.84 + forwardReach * 0.16, 0, 1)

        // Keep the detected tips as the actual edge endpoints. The small depth
        // expansion makes the nearer hand's side of the window visibly larger.
        const edgeScale = 0.9 + proximity * 0.34
        const first = {
          x: midpoint.x + (thumb.x - midpoint.x) * edgeScale,
          y: midpoint.y + (thumb.y - midpoint.y) * edgeScale,
        }
        const second = {
          x: midpoint.x + (index.x - midpoint.x) * edgeScale,
          y: midpoint.y + (index.y - midpoint.y) * edgeScale,
        }
        const [top, bottom] = first.y <= second.y ? [first, second] : [second, first]
        return { midpoint, top, bottom, proximity }
      }).filter((hand): hand is NonNullable<typeof hand> => hand !== null)
      if (hands.length < 2) {
        if (now - lastWindowGestureAt > 450) windowGestureActive = false
        return
      }

      const [screenLeft, screenRight] = [...hands].sort((first, second) => first.midpoint.x - second.midpoint.x)
      const validWindow = screenRight.midpoint.x - screenLeft.midpoint.x > 40
        && screenLeft.bottom.y - screenLeft.top.y > 18 && screenRight.bottom.y - screenRight.top.y > 18
      if (!validWindow) {
        if (now - lastWindowGestureAt > 450) windowGestureActive = false
        return
      }
      if (!windowGestureActive) {
        say('손 창의 크기를 조절해 보세요. 손등에서 손바닥을 앞으로 돌리면 효과가 바뀝니다.')
        windowGestureActive = true
      }
      lastWindowGestureAt = now
      const averageProximity = (screenLeft.proximity + screenRight.proximity) * 0.5
      const keepOnStage = (point: Point): Point => ({
        x: clamp(point.x, 8, Math.max(8, width - 8)),
        y: clamp(point.y, 8, Math.max(8, height - 8)),
      })
      const targetCorners: EffectCorners = [
        keepOnStage(screenLeft.top),
        keepOnStage(screenRight.top),
        keepOnStage(screenRight.bottom),
        keepOnStage(screenLeft.bottom),
      ]
      const existing = effectWindows.get('both-hands')
      if (existing) {
        existing.targetCorners = targetCorners
        existing.targetDepth = averageProximity
      } else {
        effectWindows.clear()
        effectWindows.set('both-hands', {
          corners: targetCorners.map((point) => ({ ...point })) as EffectCorners,
          targetCorners,
          depth: averageProximity,
          targetDepth: averageProximity,
        })
      }
    } catch { /* Keep the last windows visible when a frame cannot be detected. */ }
  }

  const activePaletteIndices = () => {
    const count = effectAmounts.recolor
    if (count === 1) return [3]
    return Array.from({ length: count }, (_, index) => Math.round(index * 5 / (count - 1)))
  }

  const renderPaletteEditor = () => {
    recolorSwatches.replaceChildren()
    activePaletteIndices().forEach((paletteIndex, displayIndex) => {
      const label = document.createElement('label')
      label.title = `${displayIndex + 1}도 색상`
      const input = document.createElement('input')
      input.type = 'color'
      input.value = customRecolorPalette[paletteIndex]
      input.setAttribute('aria-label', `Recolor ${displayIndex + 1}번째 색상`)
      const number = document.createElement('span')
      number.textContent = String(displayIndex + 1).padStart(2, '0')
      input.addEventListener('input', () => {
        customRecolorPalette[paletteIndex] = input.value
        needsRender = true
      })
      label.append(input, number)
      recolorSwatches.append(label)
    })
    addColorButton.disabled = effectAmounts.recolor >= settings.recolor.max
  }

  const randomizePalette = () => {
    customRecolorPalette = makeRandomPalette()
    renderPaletteEditor()
    needsRender = true
  }

  const addRecolorColor = () => {
    effectAmounts.recolor = Math.min(settings.recolor.max, effectAmounts.recolor + 1)
    if (effectMode === 'recolor') effectRange.value = String(effectAmounts.recolor)
    renderPaletteEditor()
    needsRender = true
  }

  const prepareBlobBuffers = (size: number) => {
    if (brightPixels.length !== size) {
      brightPixels = new Uint8Array(size)
      visitedPixels = new Uint8Array(size)
      blobStack = new Int32Array(size)
    } else {
      visitedPixels.fill(0)
    }
  }

  const findBrightBlobs = (processWidth: number, processHeight: number) => {
    const blobs: DetectedBlob[] = []
    const size = brightPixels.length
    for (let start = 0; start < size; start += 1) {
      if (!brightPixels[start] || visitedPixels[start]) continue
      visitedPixels[start] = 1
      let stackLength = 1
      blobStack[0] = start
      let area = 0; let sumX = 0; let sumY = 0
      let minX = processWidth; let minY = processHeight; let maxX = 0; let maxY = 0
      while (stackLength > 0) {
        const index = blobStack[--stackLength]
        const x = index % processWidth
        const y = Math.floor(index / processWidth)
        area += 1; sumX += x; sumY += y
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        let neighbor = index - processWidth
        if (neighbor >= 0 && brightPixels[neighbor] && !visitedPixels[neighbor]) { visitedPixels[neighbor] = 1; blobStack[stackLength++] = neighbor }
        neighbor = index + processWidth
        if (neighbor < size && brightPixels[neighbor] && !visitedPixels[neighbor]) { visitedPixels[neighbor] = 1; blobStack[stackLength++] = neighbor }
        neighbor = index - 1
        if (x > 0 && brightPixels[neighbor] && !visitedPixels[neighbor]) { visitedPixels[neighbor] = 1; blobStack[stackLength++] = neighbor }
        neighbor = index + 1
        if (x < processWidth - 1 && brightPixels[neighbor] && !visitedPixels[neighbor]) { visitedPixels[neighbor] = 1; blobStack[stackLength++] = neighbor }
      }
      if (area >= 3) blobs.push({ x: sumX / area, y: sumY / area, minX, minY, maxX, maxY, area })
    }
    return blobs.sort((first, second) => second.area - first.area).slice(0, 18)
  }

  const assignStableIds = (detected: DetectedBlob[], now: number, processWidth: number, processHeight: number) => {
    const candidates = trackedBlobs.filter((blob) => now - blob.lastSeen < 500)
    const used = new Set<number>()
    const current = detected.map((blob) => {
      let closestId: number | null = null
      let closestDistance = Infinity
      candidates.forEach((candidate) => {
        if (used.has(candidate.id)) return
        const distance = Math.hypot((blob.x - candidate.x) / processWidth, (blob.y - candidate.y) / processHeight)
        if (distance < 0.16 && distance < closestDistance) { closestId = candidate.id; closestDistance = distance }
      })
      const id = closestId ?? nextBlobId++
      used.add(id)
      return { ...blob, id, lastSeen: now }
    })
    trackedBlobs = [...current, ...candidates.filter((blob) => !used.has(blob.id) && now - blob.lastSeen < 260)]
    return current
  }

  const renderLightMap = (now: number) => {
    const processWidth = lowPowerDevice ? 132 : 180
    const processHeight = Math.max(72, Math.round(processWidth * height / width))
    resizeWorkingCanvas(sampleCanvas, processWidth, processHeight)
    const heatCanvasChanged = resizeWorkingCanvas(heatCanvas, processWidth, processHeight)
    sampleContext.clearRect(0, 0, processWidth, processHeight)
    drawCover(sampleContext, activeSource, processWidth, processHeight)
    const sourceImage = sampleContext.getImageData(0, 0, processWidth, processHeight)
    const analysisSize = processWidth * processHeight
    prepareBlobBuffers(analysisSize)
    if (!heatImage || heatCanvasChanged || heatImage.width !== processWidth || heatImage.height !== processHeight) heatImage = heatContext.createImageData(processWidth, processHeight)
    else heatImage.data.fill(0)
    const heatPixels = heatImage.data
    const threshold = effectAmounts.lightmap / 100
    for (let pixel = 0; pixel < sourceImage.data.length; pixel += 4) {
      const red = sourceImage.data[pixel]; const green = sourceImage.data[pixel + 1]; const blue = sourceImage.data[pixel + 2]
      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
      brightPixels[pixel >> 2] = luminance >= threshold ? 1 : 0
      const energy = clamp((luminance - threshold * 0.45) / Math.max(0.08, 1 - threshold * 0.45), 0, 1)
      if (energy <= 0.04) continue
      if (energy < 0.67) {
        const mix = energy / 0.67
        heatPixels[pixel] = Math.round(60+175*mix); heatPixels[pixel + 1] = Math.round(60 + 175 * mix); heatPixels[pixel + 2] = Math.round(45 + 130 * mix)
      } else {
        const mix = (energy - 0.67) / 0.33
        heatPixels[pixel] = Math.round(235 + 20 * mix); heatPixels[pixel + 1] = Math.round(235 + 15 * mix); heatPixels[pixel + 2] = Math.round(175 + 55 * mix)
      }
      heatPixels[pixel + 3] = Math.round(energy * 238)
    }
    heatContext.putImageData(heatImage, 0, 0)
    context.save(); context.filter = 'brightness(0.48) saturate(0.58)'; drawCover(context, activeSource, width, height); context.restore()
    context.save(); context.globalCompositeOperation = 'screen'; context.imageSmoothingEnabled = true; context.drawImage(heatCanvas, 0, 0, width, height); context.restore()

    const blobs = assignStableIds(findBrightBlobs(processWidth, processHeight), now, processWidth, processHeight)
    displayBlobState(blobs.length)
    context.save(); context.strokeStyle = 'rgba(255, 49, 49, 0.84)'; context.fillStyle = 'rgba(255, 63, 52, 0.94)'; context.lineWidth = 1.25
    blobs.forEach((first, firstIndex) => {
      const centerX = first.x / processWidth * width; const centerY = first.y / processHeight * height
      for (let secondIndex = firstIndex + 1; secondIndex < blobs.length; secondIndex += 1) {
        const second = blobs[secondIndex]; const targetX = second.x / processWidth * width; const targetY = second.y / processHeight * height
        if (Math.hypot(targetX - centerX, targetY - centerY) > Math.min(width, height) * 0.48) continue
        context.globalAlpha = 0.3; context.beginPath(); context.moveTo(centerX, centerY); context.lineTo(targetX, targetY); context.stroke()
      }
      context.globalAlpha = 0.9
      const blobWidth = Math.max(12, (first.maxX - first.minX + 1) / processWidth * width)
      const blobHeight = Math.max(12, (first.maxY - first.minY + 1) / processHeight * height)
      context.beginPath(); context.ellipse(centerX, centerY, blobWidth * 0.58, blobHeight * 0.58, 0, 0, Math.PI * 2); context.stroke()
      context.beginPath(); context.arc(centerX, centerY, 2.5, 0, Math.PI * 2); context.fill()
      context.font = '700 9px Inter, system-ui, sans-serif'; context.fillText(`#${String(first.id).padStart(2, '0')}`, centerX + 7, centerY - 7)
    })
    context.restore()
  }

  const renderActiveEffect = (now: number) => {
    const amount = effectAmounts[effectMode]
    context.save()
    if (effectMode === 'blur') {
      if (amount === 0) {
        drawCover(context, activeSource, width, height)
      } else {
        // Downsampling guarantees a visible softening even where Canvas filters are unsupported.
        const reduction = 1 + amount * 0.22
        const processWidth = Math.max(24, Math.round(width / reduction))
        const processHeight = Math.max(24, Math.round(height / reduction))
        resizeWorkingCanvas(sampleCanvas, processWidth, processHeight)
        sampleContext.clearRect(0, 0, processWidth, processHeight)
        sampleContext.imageSmoothingEnabled = true; sampleContext.imageSmoothingQuality = 'high'
        drawCover(sampleContext, activeSource, processWidth, processHeight)
        const padding = amount * 1.4
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
        context.filter = `blur(${Math.max(0.75, amount * 0.6)}px)`
        context.drawImage(sampleCanvas, -padding, -padding, width + padding * 2, height + padding * 2)
      }
      displayEffectValue(`${amount}px`)
    } else if (effectMode === 'pixel') {
      const columns = amount; const rows = Math.max(1, Math.ceil(columns * height / width))
      resizeWorkingCanvas(sampleCanvas, columns, rows); sampleContext.clearRect(0, 0, columns, rows); drawCover(sampleContext, activeSource, columns, rows)
      context.imageSmoothingEnabled = false; context.drawImage(sampleCanvas, 0, 0, width, height); displayEffectValue(`${columns} × ${rows}`)
    } else if (effectMode === 'recolor') {
      const processWidth = Math.min(lowPowerDevice ? 420 : 680, Math.max(280, Math.round(width * 0.52)))
      const processHeight = Math.max(1, Math.round(processWidth * height / width))
      resizeWorkingCanvas(sampleCanvas, processWidth, processHeight); sampleContext.clearRect(0, 0, processWidth, processHeight); drawCover(sampleContext, activeSource, processWidth, processHeight)
      const imageData = sampleContext.getImageData(0, 0, processWidth, processHeight)
      const palette = activePaletteIndices().map((index) => hexToRgb(customRecolorPalette[index]))
      for (let pixel = 0; pixel < imageData.data.length; pixel += 4) {
        const luminance = (imageData.data[pixel] * 0.2126 + imageData.data[pixel + 1] * 0.7152 + imageData.data[pixel + 2] * 0.0722) / 255
        const color = palette[palette.length === 1 ? 0 : Math.min(palette.length - 1, Math.floor(luminance * palette.length))]
        const brightness = palette.length === 1 ? 0.22 + luminance * 0.92 : 1
        imageData.data[pixel] = color[0] * brightness; imageData.data[pixel + 1] = color[1] * brightness; imageData.data[pixel + 2] = color[2] * brightness
      }
      sampleContext.putImageData(imageData, 0, 0); context.imageSmoothingEnabled = true; context.drawImage(sampleCanvas, 0, 0, width, height); displayEffectValue(`${amount}도`)
    } else if (effectMode === 'melt' || effectMode === 'thermal') {
      const columns = lowPowerDevice ? 240 : 360, rows = Math.max(2,Math.min(480,Math.round(columns*height/width)))
      resizeWorkingCanvas(sampleCanvas, columns, rows)
      sampleContext.clearRect(0,0,columns,rows)
      drawCover(sampleContext,activeSource,columns,rows)
      renderLuminanceGrid(context,sampleContext.getImageData(0,0,columns,rows),amount,width,height,effectMode,now)
      displayEffectValue(`${amount}%`)

    } else {
      renderLightMap(now); displayEffectValue(`${amount}%`)
    }
    context.restore()
    if (effectMode !== 'lightmap') displayBlobState(0)
  }

  const effectWindowCorners = (effectWindow: EffectWindow): [Point, Point, Point, Point] => {
    return effectWindow.corners
  }

  const addEffectWindowPath = (effectWindow: EffectWindow) => {
    const [topLeft, topRight, bottomRight, bottomLeft] = effectWindowCorners(effectWindow)
    context.moveTo(topLeft.x, topLeft.y)
    context.lineTo(topRight.x, topRight.y)
    context.lineTo(bottomRight.x, bottomRight.y)
    context.lineTo(bottomLeft.x, bottomLeft.y)
    context.closePath()
  }

  const drawEffectWindowFrame = (effectWindow: EffectWindow) => {
    const corners = effectWindowCorners(effectWindow)
    context.save()
    context.strokeStyle = `rgba(173, 255, 239, ${0.72 + effectWindow.depth * 0.24})`
    context.lineWidth = 1.15 + effectWindow.depth * 0.75
    context.shadowColor = 'rgba(36, 225, 203, 0.62)'
    context.shadowBlur = 7 + effectWindow.depth * 11
    context.beginPath(); addEffectWindowPath(effectWindow); context.stroke()
    context.shadowBlur = 0
    corners.forEach((corner) => {
      context.fillStyle = '#d8fff6'
      context.beginPath()
      context.arc(corner.x, corner.y, 2.6 + effectWindow.depth * 1.8, 0, Math.PI * 2)
      context.fill()
    })
    const label = `${modeLabels[effectMode]} · PINCH WINDOW`
    context.font = '800 9px Inter, system-ui, sans-serif'
    const labelWidth = context.measureText(label).width + 18
    const left = clamp(Math.min(...corners.map((corner) => corner.x)), 4, Math.max(4, width - labelWidth - 4))
    const top = clamp(Math.min(...corners.map((corner) => corner.y)), 4, Math.max(4, height - 27))
    context.fillStyle = 'rgba(5, 38, 47, 0.86)'
    context.fillRect(left, top, labelWidth, 23)
    context.fillStyle = '#baffef'
    context.fillText(label, left + 9, top + 15)
    context.restore()
  }

  const drawTrackedHands = (now: number) => {
    if (activeSource !== camera || now - handsVisibleAt > 250 || !trackedHands.length) return
    context.save()
    context.lineWidth = 1.4; context.lineCap = 'round'; context.lineJoin = 'round'
    context.strokeStyle = '#a6ffe8'; context.fillStyle = '#f4ffeb'
    for (const landmarks of trackedHands) {
      for (let i = 0; i < 21; i++) {
        const point = projectLandmark(landmarks[i])
        handOverlayPoints[i].x = point.x; handOverlayPoints[i].y = point.y
      }
      context.beginPath()
      for (const [from, to] of HAND_CONNECTIONS) {
        const a = handOverlayPoints[from], b = handOverlayPoints[to]
        context.moveTo(a.x, a.y); context.lineTo(b.x, b.y)
      }
      context.stroke(); context.beginPath()
      handOverlayPoints.forEach((point, i) => {
        const radius = i > 0 && i % 4 === 0 ? 3 : 2
        context.moveTo(point.x + radius, point.y); context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      })
      context.fill()
    }
    context.restore()
  }

  const finishColorMode = () => {
    if (!monochrome) return
    context.save()
    // Desaturate the actual output (including captures) without a full-frame
    // readback or depending on Canvas filter support.
    context.globalCompositeOperation = 'saturation'
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    context.restore()
  }

  const renderEffect = (now = performance.now()) => {
    if (!sourceReady(activeSource) || width <= 1 || height <= 1) return
    context.save(); context.clearRect(0, 0, width, height); context.fillStyle = '#07100e'; context.fillRect(0, 0, width, height)
    if (!cameraStream) {
      renderActiveEffect(now)
      context.restore()
      finishColorMode()
      return
    }

    drawCover(context, activeSource, width, height)
    const visibleWindows = [...effectWindows.values()]
    if (!visibleWindows.length) {
      displayBlobState(0)
      context.restore()
      drawTrackedHands(now)
      finishColorMode()
      return
    }
    const easing = 0.34
    visibleWindows.forEach((effectWindow) => {
      effectWindow.corners.forEach((corner, index) => {
        const target = effectWindow.targetCorners[index]
        corner.x += (target.x - corner.x) * easing
        corner.y += (target.y - corner.y) * easing
      })
      effectWindow.depth += (effectWindow.targetDepth - effectWindow.depth) * easing
    })
    context.save()
    context.beginPath()
    visibleWindows.forEach(addEffectWindowPath)
    context.clip()
    renderActiveEffect(now)
    context.restore()
    visibleWindows.forEach(drawEffectWindowFrame)
    context.restore()
    drawTrackedHands(now)
    finishColorMode()
  }

  const selectEffectMode = (mode: EffectMode) => {
    effectMode = mode
    const setting = settings[mode]
    modeName.textContent = modeLabels[mode]; controlLabel.textContent = setting.label
    effectRange.min = String(setting.min); effectRange.max = String(setting.max); effectRange.step = String(setting.step); effectRange.value = String(effectAmounts[mode])
    modeButtons.forEach((button) => { const active = button.dataset.effectMode === mode; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)) })
    paletteEditor.hidden = mode !== 'recolor'
    if (mode === 'recolor') renderPaletteEditor()
    needsRender = true
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { say('이 브라우저에서는 카메라를 사용할 수 없어요.'); return }
    if (cameraStream) return
    say('카메라 권한을 요청하고 있어요…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (disposed) { stream.getTracks().forEach((track) => track.stop()); return }
      sourceBeforeCamera = activeSource; cameraStream = stream; camera.srcObject = stream; await camera.play(); activeSource = camera
      say('엄지와 검지 추적 모델을 준비하고 있어요…'); await ensureHandLandmarker()
      if (disposed) return
      effectWindows.clear(); windowGestureActive = false; lastWindowGestureAt = -Infinity; lastHandVideoTime = -1; lastHandDetection = -Infinity
      root.classList.add('is-camera-active'); say('양손의 엄지와 검지로 창을 만들면 랜덤 효과가 적용돼요. 2도 표현은 제외됩니다.')
      capturePhotoButton.disabled = false; recordVideoButton.disabled = false
    } catch {
      cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; camera.srcObject = null; activeSource = sourceBeforeCamera
      say('카메라 또는 손 추적 모델을 시작하지 못했어요. 권한과 인터넷 연결을 확인해 주세요.')
    }
  }

  const openPhotoDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('effect-photo-library', 1)
    request.addEventListener('upgradeneeded', () => { if (!request.result.objectStoreNames.contains('photos')) request.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true }) })
    request.addEventListener('success', () => resolve(request.result)); request.addEventListener('error', () => reject(request.error))
  })

  const usePhoto = (photo: SavedPhoto) => {
    uploadedVideo?.pause()
    const image = new Image(); const url = URL.createObjectURL(photo.blob)
    image.addEventListener('load', () => { URL.revokeObjectURL(url); activeSource = image; activePhotoBlob = photo.blob; activePhotoName = photo.name; savePhotoButton.disabled = false; needsRender = true }, { once: true })
    image.addEventListener('error', () => URL.revokeObjectURL(url), { once: true }); image.src = url
  }

  const deleteStoredPhoto = async (photo: SavedPhoto) => {
    if (photo.id == null) throw new Error('Saved photo has no id.')
    const database = await openPhotoDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('photos', 'readwrite')
      transaction.objectStore('photos').delete(photo.id!)
      transaction.addEventListener('complete', () => resolve(), { once: true })
      transaction.addEventListener('error', () => reject(transaction.error), { once: true })
      transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
    })
    database.close()
  }

  const refreshSavedPhotos = async () => {
    try {
      const database = await openPhotoDatabase()
      const photos = await new Promise<SavedPhoto[]>((resolve, reject) => {
        const request = database.transaction('photos', 'readonly').objectStore('photos').getAll()
        request.addEventListener('success', () => resolve(request.result as SavedPhoto[])); request.addEventListener('error', () => reject(request.error))
      })
      database.close(); savedObjectUrls.forEach((url) => URL.revokeObjectURL(url)); savedObjectUrls = []; savedPhotos.replaceChildren()
      if (!photos.length) { const empty = document.createElement('span'); empty.textContent = '저장된 사진이 없어요.'; savedPhotos.append(empty); return }
      photos.sort((first, second) => second.createdAt - first.createdAt).forEach((photo) => {
        const item = document.createElement('div'); item.className = 'effect-saved-photo'
        const button = document.createElement('button'); button.type = 'button'; button.className = 'effect-saved-photo__preview'; button.title = photo.name; button.setAttribute('aria-label', `${photo.name} 열기`)
        const image = document.createElement('img'); const url = URL.createObjectURL(photo.blob); savedObjectUrls.push(url); image.src = url; image.alt = photo.name; image.loading = 'lazy'; image.decoding = 'async'
        const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.className = 'effect-saved-photo__delete'; deleteButton.textContent = '×'; deleteButton.setAttribute('aria-label', `${photo.name} 삭제`)
        button.append(image); button.addEventListener('click', () => usePhoto(photo))
        deleteButton.addEventListener('click', () => {
          deleteButton.disabled = true
          void deleteStoredPhoto(photo)
            .then(async () => { await refreshSavedPhotos(); say('저장된 사진을 삭제했어요.') })
            .catch(() => { deleteButton.disabled = false; say('저장된 사진을 삭제하지 못했어요.') })
        })
        item.append(button, deleteButton); savedPhotos.append(item)
      })
    } catch { say('저장된 사진 목록을 불러오지 못했어요.') }
  }

  const handleMediaInput = () => {
    const file = mediaInput.files?.[0]
    if (!file) return
    uploadedVideo?.pause(); if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl); activeObjectUrl = URL.createObjectURL(file)
    if (file.type.startsWith('video/')) {
      const video = document.createElement('video'); video.muted = true; video.loop = true; video.playsInline = true; video.src = activeObjectUrl
      video.addEventListener('canplay', () => { uploadedVideo = video; activeSource = video; activePhotoBlob = null; savePhotoButton.disabled = true; void video.play(); selectEffectMode('lightmap'); needsRender = true; say('영상의 밝은 영역을 안정적인 ID로 추적하고 있어요.') }, { once: true })
      return
    }
    const image = new Image()
    image.addEventListener('load', () => { activeSource = image; activePhotoBlob = file; activePhotoName = file.name; savePhotoButton.disabled = false; needsRender = true; say('추가한 사진에 선택한 효과를 적용했어요.') }, { once: true }); image.src = activeObjectUrl
  }

  const storePhotoBlob = async (photoBlob: Blob, name: string) => {
    const database = await openPhotoDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('photos', 'readwrite')
      transaction.objectStore('photos').add({ name, blob: photoBlob, createdAt: Date.now() } satisfies SavedPhoto)
      transaction.addEventListener('complete', () => resolve()); transaction.addEventListener('error', () => reject(transaction.error))
    })
    database.close()
    await refreshSavedPhotos()
  }

  const saveCurrentPhoto = async () => {
    if (!activePhotoBlob) return
    savePhotoButton.disabled = true
    try { await storePhotoBlob(activePhotoBlob, activePhotoName || 'photo'); say('현재 사진을 이 브라우저에 저장했어요.') }
    catch { say('사진을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.') }
    finally { savePhotoButton.disabled = false }
  }

  const capturePhoto = () => {
    if (!cameraStream) return
    renderEffect()
    capturePhotoButton.disabled = true
    output.toBlob((blob) => {
      if (!blob) { capturePhotoButton.disabled = false; say('이미지를 촬영하지 못했어요.'); return }
      const filename = `effect-photo-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      void storePhotoBlob(blob, filename)
        .then(() => say('효과가 적용된 카메라 이미지를 촬영하고 저장했어요.'))
        .catch(() => say('촬영한 이미지를 저장하지 못했어요.'))
        .finally(() => { capturePhotoButton.disabled = !cameraStream })
    }, 'image/png')
  }

  const toggleVideoRecording = () => {
    if (mediaRecorder?.state === 'recording') {
      recordVideoButton.disabled = true
      mediaRecorder.stop()
      say('영상 파일을 마무리하고 있어요…')
      return
    }
    if (!cameraStream || typeof output.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      say('이 브라우저에서는 효과 영상을 녹화할 수 없어요.')
      return
    }
    recordedChunks = []
    recordingStream = output.captureStream(lowPowerDevice ? 20 : 30)
    const preferredType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
    mediaRecorder = new MediaRecorder(recordingStream, preferredType ? { mimeType: preferredType } : undefined)
    mediaRecorder.addEventListener('dataavailable', (event) => { if (event.data.size) recordedChunks.push(event.data) })
    mediaRecorder.addEventListener('stop', () => {
      recordingStream?.getTracks().forEach((track) => track.stop())
      recordingStream = null
      recordVideoButton.classList.remove('is-recording')
      recordVideoButton.querySelector('span')!.textContent = '영상 녹화'
      recordVideoButton.disabled = !cameraStream
      if (disposed || !recordedChunks.length) return
      const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'video/webm' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `effect-video-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`
      document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      say('효과가 적용된 영상을 저장했어요.')
    }, { once: true })
    mediaRecorder.start(1000)
    recordVideoButton.classList.add('is-recording')
    recordVideoButton.querySelector('span')!.textContent = '녹화 종료'
    say('효과 화면을 영상으로 녹화하고 있어요.')
  }

  const resize = () => {
    const bounds = stage.getBoundingClientRect(); width = Math.max(1, bounds.width); height = Math.max(1, bounds.height); pixelRatio = Math.min(window.devicePixelRatio || 1, maximumPixelRatio)
    const targetWidth = Math.round(width * pixelRatio); const targetHeight = Math.round(height * pixelRatio)
    if (output.width !== targetWidth || output.height !== targetHeight) { output.width = targetWidth; output.height = targetHeight }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); needsRender = true
  }

  const draw = (time: number) => {
    if (disposed) return
    if (document.hidden) { lastVideoRender = time; animationFrame = requestAnimationFrame(draw); return }
    updateHandWindows(time)
    const isMoving = effectMode === 'melt' || (activeSource instanceof HTMLVideoElement && !activeSource.paused)
    if ((needsRender || isMoving) && (!isMoving || time - lastVideoRender >= 1000 / (lowPowerDevice ? 20 : 30))) { renderEffect(time); needsRender = false; lastVideoRender = time }
    animationFrame = requestAnimationFrame(draw)
  }

  const updateEffectAmount = () => {
    effectAmounts[effectMode] = Number(effectRange.value)
    if (effectMode === 'recolor') renderPaletteEditor()
    needsRender = true
  }
  const adjustEffect = (direction: -1 | 1) => {
    const minimum = Number(effectRange.min)
    const maximum = Number(effectRange.max)
    const step = Number(effectRange.step) || 1
    effectRange.value = String(clamp(Number(effectRange.value) + direction * step, minimum, maximum))
    updateEffectAmount()
  }
  const handleArrowKey = (event: KeyboardEvent) => {
    const arrowKeys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']
    if (event.defaultPrevented || !arrowKeys.includes(event.key)) return
    const target = event.target
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) return
    event.preventDefault()
    adjustEffect(event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1)
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(stage)
  modeButtons.forEach((button) => button.addEventListener('click', () => selectEffectMode(button.dataset.effectMode as EffectMode)))
  colorButtons.forEach(button => button.addEventListener('click', () => {
    monochrome = button.dataset.colorMode === 'mono'
    root.classList.toggle('is-monochrome', monochrome)
    colorButtons.forEach(item => item.setAttribute('aria-pressed', String((item.dataset.colorMode === 'mono') === monochrome)))
    needsRender = true
  }))
  toolbarToggle.addEventListener('click', () => {
    toolbarContent.hidden = !toolbarContent.hidden
    toolbarToggle.setAttribute('aria-expanded', String(!toolbarContent.hidden))
    toolbarToggle.textContent = toolbarContent.hidden ? '도구 펼치기 ＋' : '접기 −'
    root.classList.toggle('is-toolbar-collapsed', toolbarContent.hidden)
  })
  effectRange.addEventListener('input', updateEffectAmount); mediaInput.addEventListener('change', handleMediaInput)
  randomizeButton.addEventListener('click', randomizePalette); addColorButton.addEventListener('click', addRecolorColor)
  savePhotoButton.addEventListener('click', () => { void saveCurrentPhoto() })
  capturePhotoButton.addEventListener('click', capturePhoto); recordVideoButton.addEventListener('click', toggleVideoRecording)
  window.addEventListener('keydown', handleArrowKey)
  defaultImage.addEventListener('load', () => { needsRender = true }); resize(); void refreshSavedPhotos(); animationFrame = requestAnimationFrame(draw); void startCamera()

  return () => {
    disposed = true; cancelAnimationFrame(animationFrame); resizeObserver.disconnect(); window.removeEventListener('keydown', handleArrowKey)
    trackedHands = []; handsVisibleAt = -Infinity
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
    recordingStream?.getTracks().forEach((track) => track.stop()); cameraStream?.getTracks().forEach((track) => track.stop()); uploadedVideo?.pause(); camera.srcObject = null
    handLandmarker?.close()
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl); savedObjectUrls.forEach((url) => URL.revokeObjectURL(url))
  }
}
