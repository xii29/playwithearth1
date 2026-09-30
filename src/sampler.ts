type SamplerKey = 'q' | 'w' | 'e' | 'a' | 's' | 'd' | 'z' | 'x' | 'c'
type PadState = { buffer: AudioBuffer; sourceLabel: string; pitch: number; speed: number }
type RecordedEvent = { time: number; buffer: AudioBuffer; pitch: number; speed: number }
type Recording = { id: number; name: string; duration: number; events: RecordedEvent[] }

const KEYS: SamplerKey[] = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c']
const CODE_TO_KEY: Record<string, SamplerKey> = {
  KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyA: 'a', KeyS: 's',
  KeyD: 'd', KeyZ: 'z', KeyX: 'x', KeyC: 'c',
}
const EXTENSIONS = ['wav', 'mp3'] as const
const LONG_PRESS_MS = 560

function createDefaultSample(context: AudioContext, index: number) {
  const duration = index < 3 ? 0.42 : 0.68
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate)
  const channel = buffer.getChannelData(0)
  const frequencies = [72, 165, 420, 220, 277, 330, 392, 494, 587]
  for (let frame = 0; frame < channel.length; frame += 1) {
    const time = frame / context.sampleRate
    const progress = frame / channel.length
    const envelope = Math.pow(1 - progress, index < 3 ? 5 : 2.8)
    const noise = Math.random() * 2 - 1
    let sample: number
    if (index === 0) sample = Math.sin(Math.PI * 2 * (45 + 105 * Math.exp(-time * 22)) * time)
    else if (index === 1) sample = noise * 0.72 + Math.sin(Math.PI * 2 * 185 * time) * 0.28
    else if (index === 2) sample = noise * Math.pow(1 - progress, 9) * 0.7
    else {
      const frequency = frequencies[index]
      sample = Math.sin(Math.PI * 2 * frequency * time) * 0.65
        + Math.sin(Math.PI * 4 * frequency * time) * 0.2
        + Math.sin(Math.PI * 6 * frequency * time) * 0.08
    }
    channel[frame] = sample * envelope * 0.72
  }
  return buffer
}

export function setupSampler(root: HTMLElement) {
  const context = new AudioContext({ latencyHint: 'interactive' })
  const master = context.createGain()
  master.gain.value = 0.82
  master.connect(context.destination)

  const padRoot = root.querySelector<HTMLElement>('#sampler-pads')!
  const status = root.querySelector<HTMLElement>('#sampler-status')!
  const sampleButton = root.querySelector<HTMLButtonElement>('#sampling-button')!
  const recordButton = root.querySelector<HTMLButtonElement>('#mix-record-button')!
  const newButton = root.querySelector<HTMLButtonElement>('#new-recording-button')!
  const list = root.querySelector<HTMLElement>('#recording-list')!
  const editor = root.querySelector<HTMLElement>('#sampler-editor')!
  const editorKey = root.querySelector<HTMLElement>('#editor-key')!
  const pitchValue = root.querySelector<HTMLOutputElement>('#pitch-value')!
  const speedValue = root.querySelector<HTMLOutputElement>('#speed-value')!
  const editorClose = root.querySelector<HTMLButtonElement>('#editor-close')!

  const pads = new Map<SamplerKey, PadState>()
  const buttons = new Map<SamplerKey, HTMLButtonElement>()
  const sources = new Set<AudioBufferSourceNode>()
  const loopSources = new Set<AudioBufferSourceNode>()
  const presses = new Map<SamplerKey, Set<string>>()
  const pointerKeys = new Map<number, SamplerKey>()
  const holdTimers = new Map<string, number>()
  const recordings: Recording[] = []
  let disposed = false
  let selectingSample = false
  let samplingKey: SamplerKey | null = null
  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null
  let chunks: Blob[] = []
  let editedKey: SamplerKey | null = null
  let selectedId: number | null = null
  let nextId = 1
  let recordStartedAt: number | null = null
  let pendingEvents: RecordedEvent[] = []
  let loopId: number | null = null
  let loopTimer: number | null = null
  let nextLoopTime = 0
  let loopGeneration = 0

  KEYS.forEach((key, index) => {
    pads.set(key, { buffer: createDefaultSample(context, index), sourceLabel: '기본 샘플', pitch: 0, speed: 1 })
    const button = padRoot.querySelector<HTMLButtonElement>(`[data-sampler-key="${key}"]`)!
    button.classList.add('is-configured')
    buttons.set(key, button)
    presses.set(key, new Set())
  })

  const say = (message: string) => { status.textContent = message }
  const ready = async () => { if (context.state === 'suspended') await context.resume() }
  const findRecording = (id: number | null) => recordings.find((recording) => recording.id === id)
  const updatePadLabel = (key: SamplerKey, label: string) => {
    buttons.get(key)!.querySelector<HTMLElement>('.sampler-pad__source')!.textContent = label
  }

  const loadSample = async (key: SamplerKey) => {
    for (const extension of EXTENSIONS) {
      if (disposed) return
      try {
        const response = await fetch(`/sounds/${key}.${extension}`)
        if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) continue
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        if (disposed) return
        const pad = pads.get(key)!
        pad.buffer = buffer
        pad.sourceLabel = `${key}.${extension}`
        updatePadLabel(key, pad.sourceLabel)
        return
      } catch { /* 다음 확장자를 확인한다. */ }
    }
  }
  void Promise.all(KEYS.map(loadSample))

  const playBuffer = (event: Omit<RecordedEvent, 'time'>, when = context.currentTime, fromLoop = false) => {
    const source = context.createBufferSource()
    source.buffer = event.buffer
    source.detune.value = event.pitch * 100
    source.playbackRate.value = event.speed
    source.connect(master)
    sources.add(source)
    if (fromLoop) loopSources.add(source)
    source.addEventListener('ended', () => {
      sources.delete(source)
      loopSources.delete(source)
    }, { once: true })
    source.start(Math.max(when, context.currentTime))
  }

  function renderRecordings() {
    if (!recordings.length) {
      list.innerHTML = '<p class="recording-list__empty">저장된 연주가 없어요.</p>'
      return
    }
    list.innerHTML = recordings.map((recording) => `
      <article class="recording-item${selectedId === recording.id ? ' is-selected' : ''}">
        <button class="recording-item__select" data-recording-select="${recording.id}" type="button"><strong>${recording.name}</strong><span>${recording.duration.toFixed(1)}초 · ${recording.events.length} hits</span></button>
        <button class="recording-item__play${loopId === recording.id ? ' is-playing' : ''}" data-recording-play="${recording.id}" type="button" aria-label="${loopId === recording.id ? '재생 정지' : '반복 재생'}">${loopId === recording.id ? '■' : '▶'}</button>
      </article>`).join('')
  }

  const stopLoop = () => {
    loopGeneration += 1
    loopId = null
    if (loopTimer !== null) window.clearTimeout(loopTimer)
    loopTimer = null
    loopSources.forEach((source) => {
      try { source.stop() } catch { /* 이미 종료된 반복재생 소스 */ }
      source.disconnect()
      sources.delete(source)
    })
    loopSources.clear()
    renderRecordings()
  }

  const scheduleLoop = () => {
    const recording = findRecording(loopId)
    if (!recording || disposed) return
    while (nextLoopTime < context.currentTime + 0.14) {
      recording.events.forEach((event) => playBuffer(event, nextLoopTime + event.time, true))
      nextLoopTime += recording.duration
    }
    loopTimer = window.setTimeout(scheduleLoop, 45)
  }

  const startLoop = (recording: Recording) => {
    stopLoop()
    const generation = loopGeneration
    void ready().then(() => {
      if (disposed || generation !== loopGeneration) return
      loopId = recording.id
      nextLoopTime = context.currentTime + 0.035
      scheduleLoop()
      renderRecordings()
    })
  }

  const playPad = (key: SamplerKey) => {
    const pad = pads.get(key)!
    void ready().then(() => {
      if (disposed) return
      playBuffer(pad)
      if (recordStartedAt !== null) pendingEvents.push({
        time: context.currentTime - recordStartedAt,
        buffer: pad.buffer,
        pitch: pad.pitch,
        speed: pad.speed,
      })
    })
  }

  const startMixRecording = () => {
    void ready().then(() => {
      const selected = findRecording(selectedId)
      pendingEvents = []
      recordStartedAt = context.currentTime
      recordButton.classList.add('is-recording')
      recordButton.querySelector('span')!.textContent = '녹음 완료'
      if (selected) {
        startLoop(selected)
        say(`${selected.name} 재생 위에 새 레이어를 녹음 중…`)
      } else say('새 연주를 녹음 중… Space를 다시 누르면 저장됩니다.')
    })
  }

  const stopMixRecording = () => {
    if (recordStartedAt === null) return
    const selected = findRecording(selectedId)
    if (selected) {
      selected.events.push(...pendingEvents.map((event) => ({ ...event, time: event.time % selected.duration })))
      say(`${selected.name}에 ${pendingEvents.length}개의 소리를 겹쳐 저장했어요.`)
    } else {
      const recording: Recording = {
        id: nextId,
        name: `녹음 ${nextId}`,
        duration: Math.max(0.5, context.currentTime - recordStartedAt),
        events: [...pendingEvents],
      }
      nextId += 1
      recordings.push(recording)
      selectedId = recording.id
      say(`${recording.name}을 저장했어요. 재생 버튼으로 반복할 수 있어요.`)
    }
    recordStartedAt = null
    pendingEvents = []
    recordButton.classList.remove('is-recording')
    recordButton.querySelector('span')!.textContent = '녹음 시작'
    renderRecordings()
  }

  const toggleMixRecording = () => recordStartedAt === null ? startMixRecording() : stopMixRecording()

  const finishMicSampling = () => {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop()
      say(`${samplingKey?.toUpperCase()} 샘플을 저장하는 중…`)
    }
  }

  const startMicSampling = async (key: SamplerKey) => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      selectingSample = false
      sampleButton.classList.remove('is-armed')
      say('이 브라우저에서는 마이크 녹음을 지원하지 않아요.')
      return
    }
    try {
      say('마이크 권한을 확인하는 중…')
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      if (disposed) { mediaStream.getTracks().forEach((track) => track.stop()); return }
      chunks = []
      const supported = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      mediaRecorder = new MediaRecorder(mediaStream, supported ? { mimeType: supported } : undefined)
      samplingKey = key
      selectingSample = false
      sampleButton.classList.remove('is-armed')
      sampleButton.classList.add('is-recording')
      buttons.get(key)!.classList.add('is-recording')
      say(`${key.toUpperCase()} 마이크 샘플링 중 · 같은 패드를 다시 누르면 저장`)
      mediaRecorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data) })
      mediaRecorder.addEventListener('stop', () => {
        if (disposed) { chunks = []; return }
        const completedKey = samplingKey
        const mimeType = mediaRecorder?.mimeType || chunks[0]?.type || 'audio/webm'
        mediaStream?.getTracks().forEach((track) => track.stop())
        mediaStream = null
        mediaRecorder = null
        samplingKey = null
        sampleButton.classList.remove('is-recording')
        if (completedKey) buttons.get(completedKey)?.classList.remove('is-recording')
        if (!completedKey || !chunks.length) { say('녹음된 소리가 없어요. 다시 시도해 주세요.'); return }
        void new Blob(chunks, { type: mimeType }).arrayBuffer()
          .then((data) => context.decodeAudioData(data))
          .then((buffer) => {
            if (disposed) return
            const pad = pads.get(completedKey)!
            pad.buffer = buffer
            pad.sourceLabel = '마이크 녹음'
            updatePadLabel(completedKey, pad.sourceLabel)
            say(`${completedKey.toUpperCase()} 패드에 마이크 샘플을 저장했어요.`)
          }).catch(() => say('마이크 녹음을 처리하지 못했어요.'))
      }, { once: true })
      mediaRecorder.start()
    } catch {
      mediaStream?.getTracks().forEach((track) => track.stop())
      mediaStream = null
      samplingKey = null
      selectingSample = false
      sampleButton.classList.remove('is-armed', 'is-recording')
      say('마이크 권한이 필요합니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  const triggerPad = (key: SamplerKey) => {
    if (samplingKey === key && mediaRecorder?.state === 'recording') finishMicSampling()
    else if (selectingSample && !samplingKey) void startMicSampling(key)
    else playPad(key)
  }

  const setPressed = (key: SamplerKey, token: string, active: boolean) => {
    const tokens = presses.get(key)!
    if (active) tokens.add(token); else tokens.delete(token)
    buttons.get(key)!.classList.toggle('is-pressed', tokens.size > 0)
  }

  const renderEditor = () => {
    if (!editedKey) return
    const pad = pads.get(editedKey)!
    editorKey.textContent = `${editedKey.toUpperCase()} PAD`
    pitchValue.textContent = `${pad.pitch > 0 ? '+' : ''}${pad.pitch} st`
    speedValue.textContent = `${pad.speed.toFixed(1)}×`
  }
  const openEditor = (key: SamplerKey) => {
    editedKey = key
    editor.hidden = false
    buttons.forEach((button, padKey) => button.classList.toggle('is-editing', padKey === key))
    renderEditor()
    say(`${key.toUpperCase()} 패드 편집 중 · 변경값은 다음 재생부터 적용됩니다.`)
  }
  const closeEditor = () => {
    editedKey = null
    editor.hidden = true
    buttons.forEach((button) => button.classList.remove('is-editing'))
  }
  const beginPress = (key: SamplerKey, token: string) => {
    setPressed(key, token, true)
    triggerPad(key)
    holdTimers.set(token, window.setTimeout(() => { holdTimers.delete(token); openEditor(key) }, LONG_PRESS_MS))
  }
  const endPress = (key: SamplerKey, token: string) => {
    setPressed(key, token, false)
    const timer = holdTimers.get(token)
    if (timer !== undefined) window.clearTimeout(timer)
    holdTimers.delete(token)
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (event.code === 'Space') { if (!event.repeat) toggleMixRecording(); event.preventDefault(); return }
    const key = CODE_TO_KEY[event.code]
    if (!key || event.repeat) return
    event.preventDefault()
    beginPress(key, `key-${key}`)
  }
  const keyup = (event: KeyboardEvent) => {
    const key = CODE_TO_KEY[event.code]
    if (key) endPress(key, `key-${key}`)
  }
  const pointerdown = (event: PointerEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sampler-key]')
    if (!button) return
    event.preventDefault()
    const key = button.dataset.samplerKey as SamplerKey
    pointerKeys.set(event.pointerId, key)
    button.setPointerCapture(event.pointerId)
    beginPress(key, `pointer-${event.pointerId}`)
  }
  const pointerup = (event: PointerEvent) => {
    const key = pointerKeys.get(event.pointerId)
    if (!key) return
    endPress(key, `pointer-${event.pointerId}`)
    pointerKeys.delete(event.pointerId)
  }
  const editorAction = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-editor-action]')
    if (!button || !editedKey) return
    const pad = pads.get(editedKey)!
    if (button.dataset.editorAction === 'pitch-down') pad.pitch = Math.max(-12, pad.pitch - 1)
    if (button.dataset.editorAction === 'pitch-up') pad.pitch = Math.min(12, pad.pitch + 1)
    if (button.dataset.editorAction === 'speed-down') pad.speed = Math.max(0.5, +(pad.speed - 0.1).toFixed(1))
    if (button.dataset.editorAction === 'speed-up') pad.speed = Math.min(2, +(pad.speed + 0.1).toFixed(1))
    renderEditor()
    playPad(editedKey)
  }
  const toggleSampling = () => {
    if (mediaRecorder?.state === 'recording') { finishMicSampling(); return }
    selectingSample = !selectingSample
    sampleButton.classList.toggle('is-armed', selectingSample)
    say(selectingSample ? '마이크로 샘플링할 패드를 눌러 주세요.' : '샘플링 선택을 취소했어요.')
  }
  const listClick = (event: Event) => {
    const target = event.target as HTMLElement
    const play = target.closest<HTMLButtonElement>('[data-recording-play]')
    if (play) {
      const recording = findRecording(Number(play.dataset.recordingPlay))
      if (recording && loopId === recording.id) {
        stopLoop()
        say(`${recording.name} 재생을 정지했어요.`)
      } else if (recording) startLoop(recording)
      return
    }
    const select = target.closest<HTMLButtonElement>('[data-recording-select]')
    if (!select) return
    selectedId = Number(select.dataset.recordingSelect)
    say(`${findRecording(selectedId)?.name} 선택됨 · 녹음하면 이 루프에 레이어가 추가됩니다.`)
    renderRecordings()
  }
  const chooseNew = () => {
    selectedId = null
    stopLoop()
    say('새 녹음 모드 · Space 또는 녹음 시작 버튼을 누르세요.')
  }
  const releaseAll = () => {
    presses.forEach((tokens, key) => { tokens.clear(); buttons.get(key)!.classList.remove('is-pressed') })
    holdTimers.forEach((timer) => window.clearTimeout(timer))
    holdTimers.clear()
    pointerKeys.clear()
  }

  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', releaseAll)
  padRoot.addEventListener('pointerdown', pointerdown)
  padRoot.addEventListener('pointerup', pointerup)
  padRoot.addEventListener('pointercancel', pointerup)
  sampleButton.addEventListener('click', toggleSampling)
  recordButton.addEventListener('click', toggleMixRecording)
  newButton.addEventListener('click', chooseNew)
  list.addEventListener('click', listClick)
  editor.addEventListener('click', editorAction)
  editorClose.addEventListener('click', closeEditor)

  return () => {
    disposed = true
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('blur', releaseAll)
    padRoot.removeEventListener('pointerdown', pointerdown)
    padRoot.removeEventListener('pointerup', pointerup)
    padRoot.removeEventListener('pointercancel', pointerup)
    sampleButton.removeEventListener('click', toggleSampling)
    recordButton.removeEventListener('click', toggleMixRecording)
    newButton.removeEventListener('click', chooseNew)
    list.removeEventListener('click', listClick)
    editor.removeEventListener('click', editorAction)
    editorClose.removeEventListener('click', closeEditor)
    stopLoop()
    releaseAll()
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
    mediaStream?.getTracks().forEach((track) => track.stop())
    sources.forEach((source) => { try { source.stop() } catch { /* 이미 종료됨 */ } })
    void context.close()
  }
}
