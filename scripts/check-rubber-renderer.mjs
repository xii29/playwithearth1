import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = ts.transpileModule(await readFile('src/rubber-renderer.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage()
  await page.route('https://rubber.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('.js') ? source : '<html><body></body></html>' }))
  await page.goto('https://rubber.test/')
  const result = await page.evaluate(async () => {
    const { createRubberRenderer } = await import('/renderer.js')
    const input = document.createElement('canvas'); input.width = 320; input.height = 240
    const ctx = input.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 320, 0)
    gradient.addColorStop(0, 'rgb(30,80,120)'); gradient.addColorStop(1, 'rgb(230,80,120)')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 320, 240)
    const video = document.createElement('video'); video.muted = true; video.playsInline = true
    const stream = input.captureStream(10); video.srcObject = stream; document.body.append(video)
    const pump = setInterval(() => ctx.fillRect(0, 0, 320, 240), 50)
    await Promise.race([video.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('Synthetic video timed out')), 5000))])
    await new Promise(resolve => setTimeout(resolve, 150))
    clearInterval(pump)
    const output = document.createElement('canvas'); output.width = 320; output.height = 240; document.body.append(output)
    const renderer = createRubberRenderer(output), gl = output.getContext('webgl')
    const pixels = () => { const data = new Uint8Array(320 * 240 * 4); gl.readPixels(0, 0, 320, 240, gl.RGBA, gl.UNSIGNED_BYTE, data); return data }
    renderer.draw(video, 320, 240, null, [])
    const empty = pixels()
    const points = Array.from({ length: 478 }, () => ({ x: 160, y: 120 }))
    const contour = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
    contour.forEach((index, i) => { const a = i / contour.length * Math.PI * 2 - Math.PI / 2; points[index] = { x: 160 + Math.cos(a) * 65, y: 120 + Math.sin(a) * 85 } })
    renderer.draw(video,320,240,points,[])
    const base=pixels()
    const pull = { anchorIndex: 0, offset: { x: 0, y: 0 }, displacement: { x: 100, y: 15 } }
    renderer.draw(video, 320, 240, points, [pull])
    const warped = pixels()
    let changed = 0, biggestJump = 0, holes = 0, changedBackground = 0, farBackground = 0
    for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
      const i = (y * 320 + x) * 4
      if (Math.abs(base[i] - warped[i]) > 4) changed++
      if (((x + .5 - 160) / 67) ** 2 + ((239 - y + .5 - 120) / 87) ** 2 > 1 && base[i] !== warped[i]) changedBackground++
      if (x < 70 && base[i] !== warped[i]) farBackground++
      if (warped[i + 3] !== 255) holes++
      if (x) biggestJump = Math.max(biggestJump, Math.abs(warped[i] - warped[i - 4]))
    }
    renderer.draw(video, 320, 240, points, [{ ...pull, displacement: { x: 0, y: 0 } }])
    const restored = pixels()
    const restoredExactly = restored.every((v, i) => v === base[i])
    renderer.draw(video, 320, 240, points, [pull, { ...pull, anchorIndex: 234, displacement: { x: -80, y: -20 } }])
    const error = gl.getError()
    renderer.dispose(); stream.getTracks().forEach(track => track.stop())
    const anchor = ((239 - 120) * 320 + 160) * 4, target = ((239 - 135) * 320 + 260) * 4
    const fingertipError = Math.abs(base[anchor] - warped[target])
    return { changed, biggestJump, holes, restoredExactly, changedBackground, farBackground, fingertipError, error,backgroundVisible:empty.some((v,i)=>i%4!==3&&v>40) }
  })
  console.log('Face warp measurements:', result)
  assert(result.changed > 1000, 'Pinch must visibly warp the source')
  assert.equal(result.holes, 0)
  assert(result.backgroundVisible,'Full camera background remains visible on the single warped surface')
  assert(result.changedBackground > 100, 'Face must extend beyond the original contour')
  assert.equal(result.farBackground, 0, 'Uncovered background must remain unchanged')
  assert(result.fingertipError < 12, 'The grabbed face point must follow the fingertip')
  assert.equal(result.restoredExactly, true)
  assert.equal(result.error, 0)
  console.log('PASS synthetic camera: shader compile, continuous single/two-hand warp, no holes, exact neutral recovery.', result)
} finally { await browser.close() }
