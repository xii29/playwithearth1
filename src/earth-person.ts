import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision'

export type BodyPoint = { x: number; y: number; visibility?: number }
export type PersonCapture = { image: HTMLCanvasElement; landmarks: BodyPoint[]; bounds: { x: number; y: number; width: number; height: number }; color: string }

export async function capturePerson(photo: HTMLCanvasElement, signal?: AbortSignal, onStage?: (stage: 'segment' | 'pose') => void): Promise<PersonCapture> {
  signal?.throwIfAborted()
  onStage?.('segment')
  const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  signal?.throwIfAborted()
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/models/selfie_multiclass.tflite` },
    runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
  })
  const image = document.createElement('canvas'); image.width = photo.width; image.height = photo.height
  const context = image.getContext('2d', { willReadFrequently: true })!
  context.drawImage(photo, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height)
  let minX = image.width, minY = image.height, maxX = 0, maxY = 0, count = 0, red = 0, green = 0, blue = 0
  try {
    signal?.throwIfAborted()
    const result = segmenter.segment(photo)
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) throw new Error('사람 영역을 찾지 못했어요. 밝은 곳에서 다시 촬영해 주세요.')
      const background = mask.getAsFloat32Array()
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const confidence = 1 - background[Math.min(mask.height - 1, Math.floor(y / image.height * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor(x / image.width * mask.width))]
        const p = (y * image.width + x) * 4
        // Keep actual HumanSeg interiors only, never the rectangular camera background.
        pixels.data[p + 3] = confidence > .65 ? 255 : confidence > .5 ? Math.round((confidence - .5) / .15 * 255) : 0
        if (confidence > .65) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
          red += pixels.data[p]; green += pixels.data[p + 1]; blue += pixels.data[p + 2]; count++
        }
      }
    } finally { result.close() }
  } finally { segmenter.close() }
  if (count < image.width * image.height * .015) throw new Error('사람이 충분히 보이지 않아요. 상반신 또는 전신이 나오도록 다시 촬영해 주세요.')
  context.putImageData(pixels, 0, 0)
  signal?.throwIfAborted()
  onStage?.('pose')
  let landmarks: BodyPoint[] = []
  // Pose is optional: objects without limbs still receive the masked person texture.
  try {
    const pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/models/pose_landmarker_lite.task` }, runningMode: 'IMAGE', numPoses: 1,
    })
    try { signal?.throwIfAborted(); const result = pose.detect(photo); landmarks = result.landmarks[0] ?? []; result.close() }
    finally { pose.close() }
  } catch { /* HumanSeg texture remains usable without a detected skeleton. */ }
  signal?.throwIfAborted()
  return { image, landmarks, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, color: `rgb(${Math.round(red / count)},${Math.round(green / count)},${Math.round(blue / count)})` }
}
