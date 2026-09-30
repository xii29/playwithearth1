import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = ts.transpileModule(await readFile('src/aquarium-fish.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } })
  await page.route('https://fish.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('.js') ? source : '<body style="margin:0;background:#051923"><canvas width="1000" height="650"></canvas></body>' }))
  await page.goto('https://fish.test/')
  const result = await page.evaluate(async () => {
    const { createLuminousFishPainter } = await import('/fish.js')
    const draw = createLuminousFishPainter(), canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d')
    let gradients = 0
    const radial = CanvasRenderingContext2D.prototype.createRadialGradient
    CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) { gradients++; return radial.apply(this, args) }
    const fish = Array.from({ length: 24 }, (_, i) => ({ x: 110 + i % 6 * 155, y: 90 + Math.floor(i / 6) * 150, vx: 40, vy: 0, size: i < 12 ? 38 : 10, hue: [180, 210, 270, 330, 30, 150][i % 6], kind: i % 4, depth: .9, phase: i, scared: 0 }))
    fish.forEach(f => draw(ctx, f, 0)); const first = gradients
    ctx.clearRect(0, 0, 1000, 650); fish.forEach(f => draw(ctx, f, 400))
    const data = ctx.getImageData(0, 0, 1000, 650).data
    let light = 0, eyes = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i + 3] < 100) light++
      if (data[i + 3] > 100 && data[i] < 30 && data[i + 1] < 60 && data[i + 2] < 65) eyes++
    }
    return { first, second: gradients, light, eyes }
  })
  assert(result.first > 0); assert.equal(result.first, result.second, 'Reuse glow sprites on subsequent frames')
  assert(result.light > 5000); assert(result.eyes > 10)
  await page.screenshot({ path: '/tmp/aquarium-luminous-fish.png' })
  console.log('PASS: large/small luminous silhouettes, eyes, translucent glow and cached sprites.', result)
} finally { await browser.close() }
