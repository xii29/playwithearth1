import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

// Supply PLAYWRIGHT_MODULE if Playwright is installed outside this project.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  const requests = [], errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://isolation.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    requests.push(pathname)
    try {
      const file = resolve('dist', `.${pathname === '/' ? '/index.html' : pathname}`)
      await route.fulfill({ body: await readFile(file), contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png' })[extname(file)] || 'application/octet-stream' })
    } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  await page.addInitScript(() => {
    window.pendingCameras = []
    window.testStreams = []
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
      window.pendingCameras.push(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
        const stream = canvas.captureStream(24)
        window.testStreams.push(stream); resolve(stream)
      })
    })
  })
  const settled = () => page.waitForFunction(() => !document.querySelector('#example-stage').hasAttribute('aria-busy'))
  const select = async (name) => {
    await page.evaluate(name => { location.hash = name; window.dispatchEvent(new HashChangeEvent('hashchange')) }, name)
    await settled(); console.log(`Selected: ${name}`)
  }
  await page.goto('https://isolation.test/#space'); await settled()
  assert(!requests.some((url) => /three\.module|vision_bundle|mediapipe|earth-village|aquarium|sniper/.test(url)), 'Inactive examples must not load on entry')
  await page.evaluate(() => { window.originalCanvas = document.querySelector('canvas') })
  await select('space')
  assert(await page.evaluate(() => window.originalCanvas === document.querySelector('canvas')), 'Active menu must not remount')
  await select('doodle'); await page.locator('#doodle-start').click()
  await page.waitForFunction(() => window.pendingCameras.length === 1)
  await select('space')
  await page.evaluate(() => window.pendingCameras.shift()())
  await page.waitForFunction(() => window.testStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))
  // A pending global camera permission must not leak into the next example.
  await page.locator('#global-capture-button').focus(); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.pendingCameras.length === 1)
  await select('sniper')
  await page.evaluate(() => window.pendingCameras.shift()())
  await page.waitForFunction(() => window.testStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))
  await page.evaluate(() => {
    for (const name of ['earth', 'aquarium', 'lab', 'rubber', 'shampoo', 'space']) {
      location.hash = name; window.dispatchEvent(new HashChangeEvent('hashchange'))
    }
  })
  await settled()
  assert.equal(await page.locator('#example-stage > main').count(), 1)
  assert.equal(await page.locator('#example-stage').getAttribute('data-active-example'), 'space')
  await page.evaluate(() => { location.hash = 'sniper' }); await page.waitForSelector('.sniper-example'); await settled()
  // Exercise the BFCache event path without starting a development server.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await settled(); assert.equal(await page.locator('.sniper-example').count(), 1)
  assert.deepEqual(errors, [])
  console.log('PASS: selected-only loading, no duplicate mount, late camera cleanup, global capture isolation, rapid switching, hash navigation and page restoration. Camera permissions were simulated; this is not a Safari speed benchmark.')
} finally { await browser.close() }
