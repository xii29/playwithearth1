import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { headless: true })
try {
  for (const failWorker of process.env.WORKER_ONLY ? [false] : [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.TEST_DPR || 1) })
    await context.route('https://chrome.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (failWorker && path.includes('space-particles.worker-')) return route.abort()
      try {
        const file = resolve('dist', `.${path === '/' ? '/index.html' : path}`)
        await route.fulfill({ body: await readFile(file), contentType: ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream' })
      } catch { await route.fulfill({ status: 404, body: '' }) }
    })
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('https://chrome.test/#space', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction((mode) => document.querySelector('#space-particles')?.dataset.renderer === mode, failWorker ? 'main' : 'worker')
    await page.waitForFunction(() => document.querySelector('#space-particles')?.dataset.painted === 'true')
    await page.waitForFunction(() => {
      const source = document.querySelector('#space-particles')
      const sample = document.createElement('canvas'); sample.width = sample.height = 64
      const ctx = sample.getContext('2d'); ctx.drawImage(source, 0, 0, 64, 64)
      const data = ctx.getImageData(0, 0, 64, 64).data
      return data.some((value, index) => index % 4 !== 3 && value > 40)
    })
    console.log('Painted:', failWorker ? 'fallback' : 'worker')
    await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(650, 400); await page.mouse.up()
    assert.equal(await page.locator('#space-particles').evaluate((canvas) => canvas.classList.contains('is-gathering')), false)
    for (const name of ['sniper', 'aquarium', 'space', 'typing', 'space']) {
      const closed = Promise.all(page.workers().map((worker) => worker.waitForEvent('close', { timeout: 15000 })))
      await page.evaluate(name => { location.hash = name; window.dispatchEvent(new HashChangeEvent('hashchange')) }, name)
      await closed
      await page.waitForFunction((name) => document.querySelector('#example-stage').dataset.activeExample === name && !document.querySelector('#example-stage').hasAttribute('aria-busy'), name)
      if (name === 'space') await page.waitForFunction(() => !!document.querySelector('#space-particles')?.dataset.renderer)
      else assert.equal(page.workers().length, 0, 'Previous space worker must terminate')
    }
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS Chrome: ${failWorker ? 'worker failure → Canvas recovery' : 'worker rendering'}, painted stars and repeated menu navigation`)
  }
} finally { await browser.close() }
