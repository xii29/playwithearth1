import * as THREE from 'three'

export function defaultCharacter() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 384
  const ctx = canvas.getContext('2d')!
  const oval = (x: number, y: number, rx: number, ry: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
  }
  oval(116, 78, 39, 40, '#e6b582'); oval(268, 78, 39, 40, '#e6b582')
  oval(116, 78, 22, 24, '#b97857'); oval(268, 78, 22, 24, '#b97857')
  oval(110, 255, 35, 53, '#e6b582'); oval(274, 255, 35, 53, '#e6b582')
  oval(151, 329, 35, 36, '#d39b6a'); oval(233, 329, 35, 36, '#d39b6a')
  oval(192, 267, 79, 79, '#75afa2'); oval(192, 144, 102, 91, '#efc797')
  oval(192, 158, 68, 54, '#ffe4bd')
  oval(159, 132, 7, 9, '#493b36'); oval(225, 132, 7, 9, '#493b36')
  oval(192, 158, 12, 9, '#493b36')
  ctx.strokeStyle = '#493b36'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.arc(192, 171, 13, .1, Math.PI - .1); ctx.stroke()
  oval(140, 162, 13, 7, '#e8a48e'); oval(244, 162, 13, 7, '#e8a48e')
  oval(192, 259, 7, 7, '#fce2ad'); oval(192, 285, 7, 7, '#fce2ad')
  return canvas
}

// Remove only border-connected background, retaining white details inside the character.
export function prepareCharacter(image: ImageBitmap) {
  const source = document.createElement('canvas')
  source.width = source.height = 384
  const ctx = source.getContext('2d', { willReadFrequently: true })!
  const scale = 344 / Math.max(image.width, image.height)
  const w = Math.round(image.width * scale), h = Math.round(image.height * scale)
  const ox = Math.floor((384 - w) / 2), oy = Math.floor((384 - h) / 2)
  ctx.drawImage(image, ox, oy, w, h)
  const pixels = ctx.getImageData(0, 0, 384, 384)
  const data = pixels.data
  const corner = ((oy + 1) * 384 + ox + 1) * 4
  const red = data[corner], green = data[corner + 1], blue = data[corner + 2]
  if (data[corner + 3] > 245) {
    const seen = new Uint8Array(384 * 384)
    const queue = new Int32Array(384 * 384)
    let read = 0, write = 0
    const enqueue = (index: number) => {
      if (seen[index]) return
      seen[index] = 1
      const p = index * 4
      if (data[p + 3] > 20 && Math.max(Math.abs(data[p] - red), Math.abs(data[p + 1] - green), Math.abs(data[p + 2] - blue)) > 38) return
      queue[write++] = index
    }
    for (let i = 0; i < 384; i++) { enqueue(i); enqueue(383 * 384 + i); enqueue(i * 384); enqueue(i * 384 + 383) }
    while (read < write) {
      const p = queue[read++]
      data[p * 4 + 3] = 0
      if (p % 384 > 0) enqueue(p - 1)
      if (p % 384 < 383) enqueue(p + 1)
      if (p >= 384) enqueue(p - 384)
      if (p < 383 * 384) enqueue(p + 384)
    }
    ctx.putImageData(pixels, 0, 0)
  }
  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 64) opaque++
  if (opaque < 300) throw new Error('캐릭터의 윤곽을 찾지 못했어요. 다른 이미지를 선택해 주세요.')
  return source
}

// Trace the silhouette of the supplied image into actual extruded geometry.
export function characterGeometry(canvas: HTMLCanvasElement) {
  const size = 96
  const sample = document.createElement('canvas')
  sample.width = sample.height = size
  const ctx = sample.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && data[(y * size + x) * 4 + 3] > 80
  const stride = size + 1
  const edges = new Map<number, number[]>()
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const a = ay * stride + ax, b = by * stride + bx
    const ends = edges.get(a) ?? []; ends.push(b); edges.set(a, ends)
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!solid(x, y)) continue
    if (!solid(x, y - 1)) edge(x, y, x + 1, y)
    if (!solid(x + 1, y)) edge(x + 1, y, x + 1, y + 1)
    if (!solid(x, y + 1)) edge(x + 1, y + 1, x, y + 1)
    if (!solid(x - 1, y)) edge(x, y + 1, x, y)
  }
  const shapes: THREE.Shape[] = []
  while (edges.size) {
    const start = edges.keys().next().value!
    const points: THREE.Vector2[] = []
    let current = start
    do {
      points.push(new THREE.Vector2(current % stride / size - .5, 1 - Math.floor(current / stride) / size))
      const ends = edges.get(current)
      if (!ends?.length) break
      const next = ends.pop()!
      if (!ends.length) edges.delete(current)
      current = next
    } while (current !== start && points.length < size * size * 4)
    // Only outer boundaries. Tiny detached pixels are intentionally ignored.
    if (points.length < 8 || THREE.ShapeUtils.area(points) >= 0) continue
    const simplified = points.filter((p, i) => {
      const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length]
      return Math.abs((p.x - before.x) * (after.y - p.y) - (p.y - before.y) * (after.x - p.x)) > 1e-8
    })
    if (simplified.length >= 3) shapes.push(new THREE.Shape(simplified))
  }
  if (!shapes.length) throw new Error('캐릭터 윤곽이 너무 작아요. 더 선명한 이미지를 선택해 주세요.')
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: .16, bevelEnabled: true, bevelThickness: .015, bevelSize: .008, bevelSegments: 1, steps: 1 })
  geometry.translate(0, 0, -.08)
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) + .5, positions.getY(i))
  return geometry
}
