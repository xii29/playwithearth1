import { createSpaceParticles } from './space-particles-engine'

export function setupSpaceParticles(initialCanvas: HTMLCanvasElement) {
  let canvas = initialCanvas
  let worker: Worker | undefined
  let presenter: ImageBitmapRenderingContext | null = null
  let engine: ReturnType<typeof createSpaceParticles> | undefined
  let transferred = false, disposed = false, dragging = false
  let readyTimeout = 0
  let inputEvents = new AbortController()
  const events = new AbortController()
  // Layout size excludes the temporary entrance animation's scale.
  const size = () => ({ width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight), ratio: Math.min(devicePixelRatio || 1, 2) })
  const resize = () => {
    if (disposed) return
    const dimensions = size()
    if (worker) worker.postMessage({ type: 'resize', ...dimensions })
    else engine?.resize(dimensions.width, dimensions.height, dimensions.ratio)
  }
  const bindInput = () => {
    inputEvents.abort(); inputEvents = new AbortController()
    const pointer = (event: PointerEvent) => {
      const action = event.type === 'pointerdown' ? 'down' : event.type === 'pointermove' ? 'move' : 'up'
      if (action === 'move' && !dragging) return
      if (action === 'down') {
        dragging = true; canvas.classList.add('is-gathering')
        try { canvas.setPointerCapture(event.pointerId) } catch { /* Pointer already cancelled. */ }
      } else if (action === 'up') { dragging = false; canvas.classList.remove('is-gathering') }
      const bounds = canvas.getBoundingClientRect(), dimensions = size()
      const x = (event.clientX - bounds.left) * dimensions.width / Math.max(1, bounds.width)
      const y = (event.clientY - bounds.top) * dimensions.height / Math.max(1, bounds.height)
      if (worker) worker.postMessage({ type: 'pointer', action, x, y })
      else if (action === 'down') engine?.gather(x, y)
      else if (action === 'move') engine?.movePointer(x, y)
      else engine?.explode(x, y)
    }
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(type, pointer as EventListener, { signal: inputEvents.signal })
  }
  const fallback = () => {
    if (disposed) return
    clearTimeout(readyTimeout); worker?.terminate(); worker = undefined
    presenter = null
    if (transferred) {
      const replacement = canvas.cloneNode(false) as HTMLCanvasElement
      canvas.replaceWith(replacement); canvas = replacement; transferred = false
      dragging = false; canvas.classList.remove('is-gathering'); bindInput()
    }
    engine?.dispose(); engine = createSpaceParticles(canvas, () => { canvas.dataset.painted = 'true' })
    resize(); engine.setVisible(!document.hidden)
    canvas.dataset.renderer = 'main'
  }
  bindInput()
  if (/(?:Chrome|Chromium)\//.test(navigator.userAgent) && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      presenter = canvas.getContext('bitmaprenderer')
      if (!presenter) throw new Error('Bitmap presentation unavailable')
      transferred = true
      worker = new Worker(new URL('./space-particles.worker.ts', import.meta.url), { type: 'module' })
      const currentWorker = worker
      worker.addEventListener('error', (event) => { event.preventDefault(); fallback() })
      worker.addEventListener('message', (event) => {
        if (disposed || worker !== currentWorker) { event.data.bitmap?.close(); return }
        if (event.data.type === 'ready') canvas.dataset.renderer = 'worker'
        if (event.data.type === 'frame') {
          const bitmap: ImageBitmap = event.data.bitmap
          try {
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height
            presenter!.transferFromImageBitmap(bitmap)
            clearTimeout(readyTimeout); canvas.dataset.painted = 'true'
            worker.postMessage({ type: 'ack' })
          } catch { bitmap.close(); fallback() }
        }
        if (event.data.type === 'error') fallback()
      })
      worker.postMessage({ type: 'init', ...size(), visible: !document.hidden })
      readyTimeout = window.setTimeout(() => { if (!document.hidden) fallback() }, 8000)
    } catch { fallback() }
  } else fallback()
  const observer = new ResizeObserver(resize)
  if (canvas.parentElement) observer.observe(canvas.parentElement)
  window.addEventListener('resize', resize, { signal: events.signal })
  document.addEventListener('visibilitychange', () => {
    clearTimeout(readyTimeout)
    if (!document.hidden && worker && !canvas.dataset.painted) readyTimeout = window.setTimeout(fallback, 8000)
    if (worker) worker.postMessage({ type: 'visible', visible: !document.hidden })
    else engine?.setVisible(!document.hidden)
  }, { signal: events.signal })
  return () => {
    disposed = true; clearTimeout(readyTimeout); inputEvents.abort(); events.abort(); observer.disconnect()
    worker?.terminate(); engine?.dispose()
  }
}
