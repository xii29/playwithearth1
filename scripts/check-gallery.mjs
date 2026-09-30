import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base=process.env.PAGES_BASE_PATH || '/'
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const requests = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://gallery.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    requests.push(pathname)
    if(!pathname.startsWith(base))return route.fulfill({status:404,body:'Outside deployment base'})
    try {
      const file = resolve('dist', pathname === base ? 'index.html' : pathname.slice(base.length))
      await route.fulfill({ body: await readFile(file), contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream' })
    } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  await page.addInitScript(() => {
    window.frameRequests = 0; window.cameraRequests = 0
    const original = window.requestAnimationFrame
    window.requestAnimationFrame = callback => { window.frameRequests++; return original(callback) }
    navigator.mediaDevices.getUserMedia = () => { window.cameraRequests++; return Promise.reject(new Error('Unexpected camera')) }
  })
  const settled = () => page.waitForFunction(() => !document.querySelector('#example-stage').hasAttribute('aria-busy'))
  await page.goto('https://gallery.test'+base); await settled()
  assert.equal(await page.locator('.clock-number').count(),32)
  assert.equal(await page.locator('.clock-hands').count(),0,'Clock hands removed')
  assert.equal(await page.locator('.clock-number[data-slot="17"]').getAttribute('data-gallery-example'),'afterglow','Example 18 is AFTERGLOW')
  const mapping=await page.locator('.clock-number').evaluateAll(nodes=>nodes.map(n=>n.dataset.galleryExample))
  assert.equal(new Set(mapping).size,32,'Every example has its own number')
  assert.deepEqual(await page.locator('.clock-number span').allTextContents(),Array.from({length:32},(_,i)=>String(i+1)))
  assert.equal(await page.locator('.clock-gallery img').count(),0,'Clock contains no thumbnails')
  assert.equal(await page.locator('.gallery-open').textContent(),'마우스')
  assert(!requests.some(url=>/vision_bundle|mediapipe|body-examples|travel-/.test(url)),'Home must not load tracking engines')
  assert.equal(await page.evaluate(()=>window.cameraRequests),0)
  const scaleOf=i=>page.locator(`.clock-number[data-slot="${i}"]`).evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a)
  assert.equal(await page.locator('.gallery-number-preview').count(),0,'No detached duplicate number')
  assert(await scaleOf(0)>await scaleOf(8)&&await scaleOf(8)>await scaleOf(16),'Near numbers grow, distant numbers shrink')
  const beforeScroll=await scaleOf(1)
  await page.locator('.clock-number[data-slot="8"]').hover()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.gallery-open').textContent(),'고무 인간')
  assert(await page.locator('.clock-number[data-slot="8"] span').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a>1.05),'Hover enlarges number')
  await page.mouse.move(30,30)
  await page.mouse.wheel(0,180);await page.waitForTimeout(1100)
  assert.equal(await page.locator('.gallery-open').textContent(),'타이핑 게임')
  assert.equal(await page.locator('.clock-number[data-slot="1"]').getAttribute('aria-pressed'),'true')
  assert(await scaleOf(1)>beforeScroll,'Scrolling closer increases the actual number size')
  assert(await scaleOf(1)>await scaleOf(0),'New front number is largest')
  assert.deepEqual(await page.locator('.clock-number').evaluateAll(nodes=>nodes.map(n=>n.dataset.galleryExample)),mapping,'Scrolling does not reassign numbers')
  const names=new Set()
  for(let i=0;i<32;i++){names.add(await page.locator('.gallery-open').textContent());await page.locator('[data-turn="1"]').click()}
  assert(names.has('MONEY RAIN')&&names.has('BODY POINT CLOUD')&&names.has('동물의 숲'),'Scrolling can reach all real examples')
  await page.waitForTimeout(1400)
  const frames=await page.evaluate(()=>window.frameRequests);await page.waitForTimeout(300)
  assert((await page.evaluate(()=>window.frameRequests))-frames<3,'Gallery animation rests when idle')
  await page.goto('https://gallery.test'+base);await settled();await page.screenshot({path:'/tmp/clock-gallery.png'})
  await page.locator('.gallery-open').click()
  await page.waitForFunction(()=>document.querySelector('#app').dataset.activeExample==='space')
  await page.locator('[data-example="home"]').click();await settled()
  assert.equal(await page.locator('.clock-number').count(),32)
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200)
  assert(await page.locator('.clock-number').evaluateAll(elements=>elements.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})),'Clock fits mobile viewport')
  await page.screenshot({path:'/tmp/clock-gallery-mobile.png'})
  assert.deepEqual(errors,[])
  assert(requests.every(path=>path.startsWith(base)),'Every resource stays within deployment base')
  console.log('PASS clock gallery: all 32 fixed numbers, name-only center, hover enlargement, all examples reachable, idle scheduling, no camera on home, launch/back, mobile fit.')
}finally{await browser.close()}
