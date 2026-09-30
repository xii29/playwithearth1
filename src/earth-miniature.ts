import * as THREE from 'three'
import { prepareCharacter } from './earth-character'
import type { PersonCapture } from './earth-person'

export function analyzeMiniature(bitmap: ImageBitmap) {
  const source = prepareCharacter(bitmap)
  const ctx = source.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, 384, 384).data
  // Select the largest connected foreground; single-subject uploads work best.
  const seen = new Uint8Array(384 * 384), queue = new Int32Array(384 * 384)
  let largest: number[] = []
  for (let p = 0; p < seen.length; p++) {
    if (seen[p] || data[p * 4 + 3] < 80) continue
    let start = 0, end = 1; queue[0] = p; seen[p] = 1
    const component: number[] = []
    while (start < end) {
      const index = queue[start++]; component.push(index)
      for (const neighbor of [index % 384 > 0 ? index - 1 : -1, index % 384 < 383 ? index + 1 : -1, index - 384, index + 384]) {
        if (neighbor < 0 || neighbor >= seen.length || seen[neighbor] || data[neighbor * 4 + 3] < 80) continue
        seen[neighbor] = 1; queue[end++] = neighbor
      }
    }
    if (component.length > largest.length) largest = component
  }
  if (largest.length < 300) throw new Error('형체를 찾기 어려워요. 단색 또는 투명 배경의 이미지로 다시 시도해 주세요.')
  let left = 384, top = 384, right = 0, bottom = 0
  const keep = new Uint8Array(seen.length)
  largest.forEach((p) => { keep[p] = 1; left = Math.min(left, p % 384); right = Math.max(right, p % 384); top = Math.min(top, Math.floor(p / 384)); bottom = Math.max(bottom, Math.floor(p / 384)) })
  const clean = ctx.getImageData(0, 0, 384, 384)
  for (let p = 0; p < keep.length; p++) if (!keep[p]) clean.data[p * 4 + 3] = 0
  ctx.putImageData(clean, 0, 0)
  const result = document.createElement('canvas'); result.width = result.height = 384
  const output = result.getContext('2d')!
  let w = right - left + 1
  const h = bottom - top + 1
  // A wide reference sheet may contain several touching characters. Find the
  // central upper silhouette and isolate its colour-connected body first.
  if (w / h > 1.4) {
    const row = Math.floor(top + h * .22), spans: [number, number][] = []
    let begin = -1
    for (let x = left; x <= right + 1; x++) {
      const solid = x <= right && clean.data[(row * 384 + x) * 4 + 3] > 80
      if (solid && begin < 0) begin = x
      if (!solid && begin >= 0) { if (x - begin > w * .08) spans.push([begin, x - 1]); begin = -1 }
    }
    if (spans.length > 1) {
      const center = (left + right) / 2
      spans.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - center) - Math.abs((b[0] + b[1]) / 2 - center))
      const selected = spans[0], centerX = Math.round((selected[0] + selected[1]) / 2)
      const c = (row * 384 + centerX) * 4
      const sr = clean.data[c], sg = clean.data[c + 1], sb = clean.data[c + 2]
      const limitLeft = Math.max(left, selected[0] - 12), limitRight = Math.min(right, selected[1] + 12)
      const isolated = document.createElement('canvas'); isolated.width = isolated.height = 384
      const ic = isolated.getContext('2d')!
      const out = ic.createImageData(384, 384)
      let foundLeft = right, foundRight = left
      const edges: Array<[number, number] | undefined> = []
      for (let y = top; y <= bottom; y++) {
        let first = 384, last = -1
        for (let x = limitLeft; x <= limitRight; x++) {
          const i = (y * 384 + x) * 4
          if (clean.data[i + 3] > 80 && Math.max(Math.abs(clean.data[i] - sr), Math.abs(clean.data[i + 1] - sg), Math.abs(clean.data[i + 2] - sb)) < 65) { first = Math.min(first, x); last = x }
        }
        if (last < first) continue
        edges[y] = [first, last]
      }
      for (let y = top; y <= bottom; y++) {
        if (edges[y]) continue
        let before = y - 1, after = y + 1
        while (before >= top && !edges[before]) before--
        while (after <= bottom && !edges[after]) after++
        if (before >= top && after <= bottom) {
          const t = (y - before) / (after - before), a = edges[before]!, b = edges[after]!
          edges[y] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        }
      }
      for (let y = top; y <= bottom; y++) {
        if (!edges[y]) continue
        const nearby = edges.slice(Math.max(top, y - 4), Math.min(bottom + 1, y + 5)).filter((e): e is [number, number] => !!e)
        const first = Math.round(nearby.reduce((sum, e) => sum + e[0], 0) / nearby.length)
        const last = Math.round(nearby.reduce((sum, e) => sum + e[1], 0) / nearby.length)
        foundLeft = Math.min(foundLeft, first); foundRight = Math.max(foundRight, last)
        for (let x = first; x <= last; x++) { const i = (y * 384 + x) * 4; out.data.set([sr, sg, sb, 255], i) }
      }
      if (foundRight > foundLeft) { ic.putImageData(out, 0, 0); ctx.clearRect(0, 0, 384, 384); ctx.drawImage(isolated, 0, 0); left = foundLeft; right = foundRight; w = right - left + 1 }
    }
  }
  // Consistent big upper-body / short lower-body proportions, preserving the
  // uploaded subject's ears, horns, silhouette, and asymmetric features.
  output.drawImage(source, left, top, w, h * .5, 42, 20, 300, 220)
  output.drawImage(source, left, top + h * .5, w, h * .5, 42, 240, 300, 124)
  return result
}

export function buildMiniature(shape: HTMLCanvasElement, person: PersonCapture) {
  const size = 128, stride = size + 1
  const sample = document.createElement('canvas'); sample.width = sample.height = stride
  const ctx = sample.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(shape, 0, 0, stride, stride)
  const pixels = ctx.getImageData(0, 0, stride, stride).data
  const distances = new Float32Array(stride * stride)
  for (let i = 0; i < distances.length; i++) distances[i] = pixels[i * 4 + 3] > 80 ? 999 : 0
  for (let y = 1; y < size; y++) for (let x = 1; x < size; x++) {
    const i = y * stride + x
    distances[i] = Math.min(distances[i], distances[i - 1] + 1, distances[i - stride] + 1, distances[i - stride - 1] + Math.SQRT2, distances[i - stride + 1] + Math.SQRT2)
  }
  for (let y = size - 1; y > 0; y--) for (let x = size - 1; x > 0; x--) {
    const i = y * stride + x
    distances[i] = Math.min(distances[i], distances[i + 1] + 1, distances[i + stride] + 1, distances[i + stride - 1] + Math.SQRT2, distances[i + stride + 1] + Math.SQRT2)
  }
  let runs = 0, previous = false
  for (let x = 0; x < stride; x++) {
    const active = distances[Math.floor(size * .82) * stride + x] > 0
    if (active && !previous) runs++; previous = active
  }
  const articulated = runs >= 2 && runs <= 4
  const atlas = document.createElement('canvas'); atlas.width = atlas.height = 512
  const paint = atlas.getContext('2d')!
  paint.fillStyle = person.color; paint.fillRect(0, 0, 512, 512)
  const b = person.bounds
  paint.drawImage(person.image, b.x, b.y, b.width, b.height, 0, 0, 512, 512)
  const points = person.landmarks
  let mapped = false
  const patch = (indices: number[], target: [number, number, number, number], padding: number) => {
    const valid = indices.map((i) => points[i]).filter((p) => p && (p.visibility ?? 1) > .45 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    if (valid.length < 2) return
    const xs = valid.map((p) => p.x * person.image.width), ys = valid.map((p) => p.y * person.image.height)
    const x = Math.max(0, Math.min(...xs) - padding), y = Math.max(0, Math.min(...ys) - padding)
    const width = Math.min(person.image.width - x, Math.max(...xs) - x + padding)
    const height = Math.min(person.image.height - y, Math.max(...ys) - y + padding)
    if (width < 1 || height < 1) return
    // Feather each anatomical crop into the atlas instead of leaving visible
    // rectangular seams. Transparent HumanSeg pixels never bring back a room.
    const tile = document.createElement('canvas'); tile.width = target[2]; tile.height = target[3]
    const brush = tile.getContext('2d')!
    brush.fillStyle = person.color; brush.fillRect(0, 0, tile.width, tile.height)
    brush.drawImage(person.image, x, y, width, height, 0, 0, tile.width, tile.height)
    brush.globalCompositeOperation = 'destination-in'
    const feather = (horizontal: boolean) => {
      const gradient = brush.createLinearGradient(0, 0, horizontal ? tile.width : 0, horizontal ? 0 : tile.height)
      gradient.addColorStop(0, 'transparent'); gradient.addColorStop(.12, '#000'); gradient.addColorStop(.88, '#000'); gradient.addColorStop(1, 'transparent')
      brush.fillStyle = gradient; brush.fillRect(0, 0, tile.width, tile.height)
    }
    feather(true); feather(false)
    paint.drawImage(tile, target[0], target[1]); mapped = true
  }
  if (points.length && articulated) {
    patch([0, 2, 5, 7, 8, 9, 10], [60, 25, 392, 260], person.bounds.width * .09)
    patch([11, 12, 23, 24], [145, 280, 222, 110], 10)
    patch([12, 14, 16, 20], [0, 278, 145, 134], 16)
    patch([11, 13, 15, 19], [357, 278, 155, 134], 16)
    patch([24, 26, 28, 32], [30, 390, 226, 122], 16)
    patch([23, 25, 27, 31], [256, 390, 226, 122], 16)
  }
  const rounded = distances.slice()
  for (let pass = 0; pass < 16; pass++) {
    for (let y = 1; y < size; y++) for (let x = 1; x < size; x++) {
      const i = y * stride + x
      if (distances[i] > 0) rounded[i] = (distances[i] * 4 + distances[i - 1] + distances[i + 1] + distances[i - stride] + distances[i + stride]) / 8
    }
    distances.set(rounded)
  }
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (const side of [1, -1]) for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
    const d = distances[y * stride + x]
    // No hard depth cap: a cap creates a flat disk in the middle of round heads.
    const depth = Math.sqrt(d / 30) * .24
    positions.push((x / size - .5) * .95, (1 - y / size), side * depth)
    uvs.push(x / size, 1 - y / size)
  }
  const layer = stride * stride
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = y * stride + x, b = a + 1, c = a + stride, d = c + 1
    if (!distances[a] && !distances[b] && !distances[c] && !distances[d]) continue
    indices.push(a, c, b, b, c, d, a + layer, b + layer, c + layer, b + layer, d + layer, c + layer)
  }
  // Keep only referenced silhouette vertices; weld the zero-depth perimeter so
  // front and back share a smooth normal rather than a sharp cardboard seam.
  const compactPositions: number[] = [], compactUvs: number[] = [], compactIndices: number[] = []
  const remap = new Map<number, number>()
  for (const index of indices) {
    const key = positions[index * 3 + 2] === 0 ? index % layer : index
    let vertex = remap.get(key)
    if (vertex === undefined) {
      vertex = compactPositions.length / 3; remap.set(key, vertex)
      compactPositions.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
      compactUvs.push(uvs[index * 2], uvs[index * 2 + 1])
    }
    compactIndices.push(vertex)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(compactPositions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(compactUvs, 2))
  geometry.setIndex(compactIndices); geometry.computeVertexNormals(); geometry.computeBoundingBox()
  geometry.translate(0, -geometry.boundingBox!.min.y, 0); geometry.computeBoundingSphere()
  const texture = new THREE.CanvasTexture(atlas); texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .78, metalness: 0, side: THREE.DoubleSide })
  const walkTime = { value: 0 }
  if (articulated) material.onBeforeCompile = (shader) => {
    shader.uniforms.walkTime = walkTime
    shader.vertexShader = 'uniform float walkTime;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float sidePhase = position.x < 0. ? 0. : 3.14159265;
      float leg = 1. - smoothstep(.18, .4, position.y);
      float arm = smoothstep(.18, .35, abs(position.x)) * smoothstep(.3,.45,position.y) * (1.-smoothstep(.5,.65,position.y));
      float stride = sin(walkTime * 7. + sidePhase);
      transformed.z += stride * (leg * .07 - arm * .045);
      transformed.y += max(0.,stride) * leg * .025;
    `)
  }
  const body = new THREE.Mesh(geometry, material)
  const actor = new THREE.Group(); actor.add(body)
  actor.userData.shape = shape
  actor.userData.mapped = mapped; actor.userData.articulated = articulated; actor.userData.walkTime = walkTime
  return { actor, body, mapped }
}
