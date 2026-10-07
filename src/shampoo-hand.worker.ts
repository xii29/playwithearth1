import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_ROOT = `${import.meta.env.BASE_URL}mediapipe/wasm`
const HAND_MODEL = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`

type Landmark = { x: number; y: number; z: number }
type MediaPipeWorkerScope = typeof self & {
  import?: (url: string) => Promise<void>
  ModuleFactory?: unknown
}

// MediaPipe's loader falls back from importScripts() to `self.import()` inside
// a module worker, but 0.10.x does not install the imported default export on
// ModuleFactory itself. Bridge that missing step so the WASM runtime can boot
// without moving hand inference back onto the UI thread.
const workerScope = self as MediaPipeWorkerScope
workerScope.import = async (url: string) => {
  const wasmLoader = await import(/* @vite-ignore */ url) as { default?: unknown }
  workerScope.ModuleFactory = wasmLoader.default
}

let landmarker: HandLandmarker | null = null

self.addEventListener('message', async (event: MessageEvent<{ type: string; bitmap?: ImageBitmap; timestamp?: number; water?: boolean }>) => {
  const message = event.data
  if (message.type === 'init') {
    try {
      // The module WASM loader assigns ModuleFactory to the worker global.
      // The classic loader does not, which is why it fails in a module Worker.
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT, true)
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: message.water ? 0.55 : 0.58,
        minHandPresenceConfidence: message.water ? 0.5 : 0.52,
        minTrackingConfidence: 0.5,
      })
      self.postMessage({ type: 'ready' })
    } catch (error) {
      self.postMessage({ type: 'error', phase: 'init', message: error instanceof Error ? error.message : 'Hand worker could not start.' })
    }
    return
  }
  if (message.type === 'close') {
    landmarker?.close()
    landmarker = null
    self.close()
    return
  }
  if (message.type !== 'frame' || !message.bitmap || !landmarker) return

  try {
    const result = landmarker.detectForVideo(message.bitmap, message.timestamp ?? performance.now())
    const landmarks = result.landmarks.map((hand) => hand.map((point) => ({ x: point.x, y: point.y, z: point.z } satisfies Landmark)))
    const handedness = result.handedness.map((hand) => hand[0]?.categoryName?.toLowerCase() ?? 'hand')
    self.postMessage({ type: 'result', timestamp: message.timestamp, landmarks, handedness })
  } catch (error) {
    self.postMessage({ type: 'error', phase: 'frame', message: error instanceof Error ? error.message : 'Hand inference failed.' })
  } finally {
    message.bitmap.close()
  }
})
