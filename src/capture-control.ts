type CaptureSource = {
  stream: MediaStream
  video: HTMLVideoElement
  internal: boolean
  prefix: string
  renderCanvas?: HTMLCanvasElement
}

const HOLD_MS = 520

function supportedMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1,mp4a',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/mp4',
    'video/webm',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

function filename(prefix: string, extension: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return `${prefix}_${timestamp}.${extension}`
}

export function setupCaptureControl(root: HTMLElement) {
  const button = root.querySelector<HTMLButtonElement>('#global-capture-button')!
  const status = root.querySelector<HTMLElement>('#global-capture-status')!
  const hiddenVideo = root.querySelector<HTMLVideoElement>('#global-capture-video')!

  let internalStream: MediaStream | null = null
  let activeSource: CaptureSource | null = null
  let recorder: MediaRecorder | null = null
  let recordingStream: MediaStream | null = null
  let chunks: Blob[] = []
  let holdTimer: number | null = null
  let pressActive = false
  let wantsVideo = false
  let photoRequested = false
  let disposed = false
  let suppressClickUntil = 0

  const say = (message: string) => { if (!disposed) status.textContent = message }
  const updateMode = (mode: 'idle' | 'flash' | 'recording') => {
    button.classList.toggle('is-recording', mode === 'recording')
    button.classList.toggle('is-flashing', mode === 'flash')
    button.setAttribute('aria-label', mode === 'recording' ? '동영상 녹화 종료' : '사진 촬영 또는 길게 눌러 동영상 녹화')
  }

  const releaseInternalStream = () => {
    internalStream?.getTracks().forEach((track) => track.stop())
    internalStream = null
    hiddenVideo.srcObject = null
  }

  const currentExampleCamera = () => {
    const exampleVideo = document.querySelector<HTMLVideoElement>('#water-camera, #hand-camera, #balloon-camera, #rubber-camera, #shampoo-camera, #doodle-camera, #aquarium-camera, #sniper-camera, #body-camera, #lab-camera')
    const stream = exampleVideo?.srcObject
    if (exampleVideo && stream instanceof MediaStream && stream.getVideoTracks().some((track) => track.readyState === 'live')) {
      const isWaterTouch = exampleVideo.id === 'water-camera'
      const isBalloon = exampleVideo.id === 'balloon-camera'
      const isRubber = exampleVideo.id === 'rubber-camera'
      const isShampoo = exampleVideo.id === 'shampoo-camera'
      const isDoodle = exampleVideo.id === 'doodle-camera'
      const isAquarium = exampleVideo.id === 'aquarium-camera'
      const isSniper = exampleVideo.id === 'sniper-camera'
      const isBody = exampleVideo.id === 'body-camera'
      const isLab = exampleVideo.id === 'lab-camera'
      return {
        stream,
        video: exampleVideo,
        internal: false,
        prefix: isLab ? 'lab' : isBody ? (root.dataset.activeExample || 'body') : isWaterTouch ? 'watertouch' : isBalloon ? 'balloon' : isRubber ? 'rubber-human' : isShampoo ? 'shampoo' : isDoodle ? 'doodleface' : isAquarium ? 'aquarium' : isSniper ? 'sniper' : 'lemonade',
        renderCanvas: isLab ? document.querySelector<HTMLCanvasElement>('#lab-flowers') || undefined : isBody ? document.querySelector<HTMLCanvasElement>('#body-canvas') || undefined : isWaterTouch
          ? document.querySelector<HTMLCanvasElement>('#water-surface') || undefined
          : isBalloon
            ? document.querySelector<HTMLCanvasElement>('#balloon-overlay') || undefined
            : isRubber
              ? document.querySelector<HTMLCanvasElement>('#rubber-surface') || undefined
              : isShampoo
                ? document.querySelector<HTMLCanvasElement>('#shampoo-bubbles') || undefined
                : isAquarium
                  ? document.querySelector<HTMLCanvasElement>('#aquarium-canvas') || undefined
                  : isSniper
                    ? document.querySelector<HTMLCanvasElement>('#sniper-canvas') || undefined
                : undefined,
      } satisfies CaptureSource
    }
    return null
  }

  const getSource = async (): Promise<CaptureSource> => {
    const exampleSource = currentExampleCamera()
    if (exampleSource) return exampleSource
    if (internalStream?.getVideoTracks().some((track) => track.readyState === 'live')) return { stream: internalStream, video: hiddenVideo, internal: true, prefix: 'camera' }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API is unavailable.')
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    if (disposed) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Capture is disposed.') }
    internalStream = stream
    hiddenVideo.srcObject = stream
    await hiddenVideo.play()
    return { stream, video: hiddenVideo, internal: true, prefix: 'camera' }
  }

  const saveBlob = async (blob: Blob, name: string) => {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name })
        return
      }
    } catch {
      // Sharing can be cancelled; a regular download remains available below.
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const capturePhoto = async (source: CaptureSource) => {
    if (disposed) return
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    if (source.renderCanvas?.width && source.renderCanvas.height) {
      canvas.width = source.renderCanvas.width
      canvas.height = source.renderCanvas.height
      context.drawImage(source.renderCanvas, 0, 0)
    } else {
      const videoWidth = source.video.videoWidth
      const videoHeight = source.video.videoHeight
      if (!videoWidth || !videoHeight) throw new Error('Camera is not ready.')
      canvas.width = videoWidth
      canvas.height = videoHeight
      // Mirror selfie-camera captures to match the interactive camera previews.
      context.translate(videoWidth, 0)
      context.scale(-1, 1)
      context.drawImage(source.video, 0, 0, videoWidth, videoHeight)
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (disposed) return
    if (!blob) throw new Error('Photo encoding failed.')
    await saveBlob(blob, filename(`${source.prefix}-photo`, 'jpg'))
    if (disposed) return
    updateMode('flash')
    window.setTimeout(() => { if (!disposed) updateMode('idle') }, 180)
    say('사진을 저장했어요.')
    if (source.internal) releaseInternalStream()
  }

  const stopRecording = () => {
    if (!recorder) return
    if (recorder.state === 'inactive') return
    say('동영상을 저장하고 있어요…')
    recorder.stop()
  }

  const startRecording = async (source: CaptureSource) => {
    if (recorder || disposed) return
    if (!('MediaRecorder' in window)) {
      say('이 브라우저는 웹 동영상 녹화를 지원하지 않아요.')
      if (source.internal) releaseInternalStream()
      return
    }
    const mimeType = supportedMimeType()
    chunks = []
    activeSource = source
    recordingStream = source.renderCanvas?.captureStream ? source.renderCanvas.captureStream(30) : source.stream
    recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined)
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data) })
    recorder.addEventListener('stop', () => {
      if (disposed) { chunks = []; return }
      const completed = recorder
      recorder = null
      if (recordingStream && recordingStream !== activeSource?.stream) recordingStream.getTracks().forEach((track) => track.stop())
      recordingStream = null
      updateMode('idle')
      const recordedBlob = new Blob(chunks, { type: completed?.mimeType || mimeType || 'video/webm' })
      const extension = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm'
      void saveBlob(recordedBlob, filename(`${activeSource?.prefix || 'camera'}-video`, extension)).then(() => say('동영상을 저장했어요.')).catch(() => say('동영상 저장을 완료하지 못했어요.'))
      if (activeSource?.internal) releaseInternalStream()
      activeSource = null
      chunks = []
    }, { once: true })
    recorder.start(750)
    updateMode('recording')
    say('동영상 녹화 중… 촬영 버튼을 다시 누르면 저장됩니다.')
  }

  const prepareCapture = () => {
    void getSource().then((source) => {
      if (disposed) return
      activeSource = source
      if (wantsVideo) void startRecording(source)
      else if (photoRequested) void capturePhoto(source).catch(() => say('사진을 저장하지 못했어요.'))
    }).catch(() => say('카메라 권한이 필요합니다. 브라우저 권한을 확인해 주세요.'))
  }

  const pointerDown = (event: PointerEvent) => {
    if (recorder) { event.preventDefault(); suppressClickUntil = performance.now() + 700; stopRecording(); return }
    pressActive = true
    wantsVideo = false
    photoRequested = false
    activeSource = null
    button.setPointerCapture(event.pointerId)
    prepareCapture()
    holdTimer = window.setTimeout(() => {
      if (!pressActive) return
      wantsVideo = true
      if (activeSource) void startRecording(activeSource)
      else say('동영상 녹화를 준비하고 있어요…')
    }, HOLD_MS)
  }

  const pointerUp = () => {
    if (!pressActive) return
    pressActive = false
    if (holdTimer !== null) window.clearTimeout(holdTimer)
    holdTimer = null
    suppressClickUntil = performance.now() + 700
    if (!wantsVideo) {
      photoRequested = true
      if (activeSource) void capturePhoto(activeSource).catch(() => say('사진을 저장하지 못했어요.'))
    }
  }

  const keyboardClick = () => {
    if (performance.now() < suppressClickUntil) return
    if (recorder) { stopRecording(); return }
    void getSource().then(capturePhoto).catch(() => say('카메라 권한이 필요합니다. 브라우저 권한을 확인해 주세요.'))
  }

  button.addEventListener('pointerdown', pointerDown)
  button.addEventListener('pointerup', pointerUp)
  button.addEventListener('pointercancel', pointerUp)
  button.addEventListener('click', keyboardClick)
  updateMode('idle')

  return () => {
    disposed = true
    if (holdTimer !== null) window.clearTimeout(holdTimer)
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (recordingStream && recordingStream !== activeSource?.stream) recordingStream.getTracks().forEach((track) => track.stop())
    button.removeEventListener('pointerdown', pointerDown)
    button.removeEventListener('pointerup', pointerUp)
    button.removeEventListener('pointercancel', pointerUp)
    button.removeEventListener('click', keyboardClick)
    releaseInternalStream()
    hiddenVideo.srcObject = null
    status.textContent = ''
    updateMode('idle')
  }
}
