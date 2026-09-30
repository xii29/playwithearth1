import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const main = await readFile('src/main.ts', 'utf8'), css = await readFile('src/style.css', 'utf8')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage()
  await page.route('**/*', route => route.abort())
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const name of ['hand', 'water', 'balloon', 'lab', 'rubber', 'shampoo', 'aquarium', 'sniper']) {
      const template = main.split(`  ${name}: () => \``)[1].split('`,')[0]
      await page.setContent(`<style>${css}.example-view{animation:none}</style><div id="app" data-active-example="${name}"><div class="site-shell">${template}</div></div>`)
      const button = page.locator('button[id$="-camera-toggle"]')
      const rect = await button.boundingBox()
      assert(rect.width < 120, `${name}: compact button width`)
      const right = viewport.width - rect.x - rect.width
      assert(right >= 15 && right <= 37, `${name}: right edge fixed`)
      assert(rect.y >= 90 && rect.y <= 94, `${name}: consistent top position`)
      assert.equal(await button.evaluate(el => getComputedStyle(el).position), 'fixed')
      await button.evaluate(el => { el.textContent = '카메라 중지'; el.classList.add('is-active') })
      assert((await button.boundingBox()).width < 120)
      if (name === 'lab') assert.equal(await page.locator('#lab-hand-overlay').count(), 0)
    }
  }
  console.log('PASS: 8 compact camera controls aligned right on desktop/mobile, active-state width, lab tracking overlay removed. Layout-only test; no camera permissions requested.')
} finally { await browser.close() }
