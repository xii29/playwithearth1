import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import { createModelPair } from './model-lifecycle'
const scope = self as typeof self & { import?: (url: string) => Promise<void>; ModuleFactory?: unknown }
scope.import = async url => { scope.ModuleFactory = (await import(/* @vite-ignore */ url)).default }
let face: FaceLandmarker | null = null
let segmenter: ImageSegmenter | null = null
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      const base = `${import.meta.env.BASE_URL}mediapipe/`
      const vision = await FilesetResolver.forVisionTasks(`${base}wasm`, true)
      ;[face, segmenter] = await createModelPair(
        FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: `${base}models/face_landmarker.task` }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .55, minTrackingConfidence: .5 }),
        ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: `${base}models/selfie_multiclass.tflite` }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false }),
      )
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'frame') {
      try {
        const landmarks = m.face ? face!.detectForVideo(m.bitmap, m.timestamp).faceLandmarks[0] : undefined
        let mask: Float32Array | undefined, width = 0, height = 0
        if (m.segment) {
          const result = segmenter!.segmentForVideo(m.bitmap, m.timestamp)
          try {
            const primary = result.confidenceMasks?.[0]
            if (primary) {
              mask = primary.getAsFloat32Array().slice(); width = primary.width; height = primary.height
              if (result.confidenceMasks!.length > 1) for (let i = 0; i < mask.length; i++) mask[i] = 1 - mask[i]
            }
          } finally { result.close() }
        }
        self.postMessage({ type: 'result', landmarks, mask, width, height, timestamp: m.timestamp }, { transfer: mask ? [mask.buffer as ArrayBuffer] : [] })
      } finally { m.bitmap.close() }
    }
  } catch { self.postMessage({ type: 'error' }) }
}
