import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const helperSource = transpile(await readFile('src/travel-effects.ts', 'utf8'))
const { randomWindowEffect } = await import(`data:text/javascript,${encodeURIComponent(helperSource)}`)
let previous = 'pixel'
const seen = new Set()
for (let i = 0; i < 100; i++) {
  const next = randomWindowEffect(previous, () => (i % 10) / 10)
  assert.notEqual(next.mode, previous)
  assert(next.recolorAmount >= 3 && next.recolorAmount <= 6)
  seen.add(next.mode); previous = next.mode
}
assert.equal(seen.size, 6)

const main = await readFile('src/main.ts', 'utf8')
const template = main.split('  travel: () => `')[1].split('`,')[0]
const moduleSource = transpile((await readFile('src/travel.ts', 'utf8')).replaceAll('import.meta.env.BASE_URL', "'/'"))
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.route('https://effects.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}.travel-stage{width:960px;height:540px}#effect-output{position:absolute;pointer-events:none}aside{position:relative;z-index:2;background:white;width:240px}video{display:none}</style><script type="importmap">{"imports":{"@mediapipe/tasks-vision":"/vision.js"}}</script>${template}<script type="module">import {setupTravel} from '/travel.js'; window.cleanup = setupTravel(document.querySelector('main'));</script>` })
    if (path === '/travel.js' || path === '/travel-effects') return route.fulfill({ contentType: 'text/javascript', body: path === '/travel.js' ? moduleSource : helperSource })
    if (path === '/vision.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const FilesetResolver={forVisionTasks:async()=>({})}; export const HandLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:window.fakeHands||[]}),close(){}})};' })
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="320" height="540" fill="#101010"/><rect x="320" width="320" height="540" fill="#888888"/><rect x="640" width="320" height="540" fill="#f8f8f8"/></svg>' })
  })
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540
      const ctx = canvas.getContext('2d')
      const paint = () => { ['#101010', '#888888', '#f8f8f8'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 320, 0, 320, 540) }) }
      paint(); window.pump = setInterval(paint, 50)
      window.fakeStream = canvas.captureStream(20)
      return window.fakeStream
    }
    window.fakeHands = []
  })
  await page.goto('https://effects.test/')
  await page.waitForSelector('.is-camera-active')
  const setHands = async present => page.evaluate(present => {
    const hand = x => {
      const points = Array.from({ length: 21 }, () => ({ x, y: .5, z: 0 }))
      points[4] = { x, y: .18, z: 0 }; points[8] = { x, y: .82, z: 0 }
      points[5].x -= .04; points[17].x += .04; points[0].y = .6; points[9].y = .4
      return points
    }
    window.fakeHands = present ? [hand(.1), hand(.9)] : []
  }, present)
  await setHands(true)
  await page.waitForFunction(() => document.querySelector('#travel-effect-mode-name').textContent !== 'PIXEL')
  await page.waitForTimeout(180)
  const jointVisible = await page.locator('#effect-output').evaluate(canvas => {
    const pixel = canvas.getContext('2d').getImageData(Math.round(canvas.width * .9), Math.round(canvas.height * .18), 1, 1).data
    return pixel[0] > 230 && pixel[1] > 245 && pixel[2] > 220
  })
  assert(jointVisible, 'Effect must show the mirrored tracked fingertip')
  const firstRandom = await page.locator('#travel-effect-mode-name').textContent()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('#travel-effect-mode-name').textContent(), firstRandom, 'Holding a frame must not re-randomize')
  await setHands(false); await page.waitForTimeout(650); await setHands(true)
  await page.waitForFunction(previous => document.querySelector('#travel-effect-mode-name').textContent !== previous, firstRandom)
  await page.locator('[data-effect-mode="thermal"]').click()
  await page.waitForTimeout(200)
  const samples = () => page.locator('#effect-output').evaluate(canvas => {
    const ctx = canvas.getContext('2d')
    return [.22, .5, .78].map(x => [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * .5), 1, 1).data].slice(0, 3))
  })
  const heat=await samples();assert(heat[0][0]>heat[2][0]+100,'Mirrored bright regions become warm while dark regions stay cold')
  await page.locator('[data-color-mode="mono"]').click(); await page.waitForTimeout(180)
  assert((await samples()).every(([r, g, b]) => Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1), 'Canvas pixels, not just CSS, must be grayscale')
  await page.locator('#effect-toolbar-toggle').click()
  assert.equal(await page.locator('#effect-toolbar-toggle').getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('#effect-toolbar-content').isVisible(), false)
  await page.locator('#effect-toolbar-toggle').click()
  assert.equal(await page.locator('#effect-toolbar-content').isVisible(), true)
  assert.equal(await page.locator('[data-color-mode="mono"]').getAttribute('aria-pressed'), 'true')
  await page.locator('[data-color-mode="color"]').click()
  await page.locator('[data-effect-mode="melt"]').click(); await page.waitForTimeout(200)
  assert.equal(await page.locator('[data-effect-mode="ascii"],[data-effect-mode="lighttiles"]').count(),0)
  assert.equal(await page.locator('#travel-effect-mode-name').textContent(),'MELTED SPECTRUM')
  await page.screenshot({path:'/tmp/effect-melted-spectrum.png'})
  await page.evaluate(() => { window.cleanup(); clearInterval(window.pump) })
  assert(await page.evaluate(() => window.fakeStream.getTracks().every(track => track.readyState === 'ended')))
  assert.deepEqual(errors, [])
  console.log('PASS: six effects, new-gesture random selection without two-tone, stable held gesture, thermal palette, actual grayscale pixels, toolbar state, Melted Spectrum replacement and cleanup. Camera/hands simulated.')
} finally { await browser.close() }
