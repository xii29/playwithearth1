import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PAGES_BASE_PATH || '/'
const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) })
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],remote=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/supabase/.test(r.url()))remote.push(r.url())})
  await page.route('https://gallery.test/**',async route=>{
    const path=new URL(route.request().url()).pathname
    try{await route.fulfill({body:await readFile(resolve('dist',path===base?'index.html':path.slice(base.length))),contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(path===base?'index.html':path)]||'application/octet-stream'})}
    catch{await route.fulfill({status:404,body:''})}
  })
  await page.addInitScript(()=>{
    window.storageAccess=0;window.cameraAccess=0
    indexedDB.open=()=>{window.storageAccess++;throw new Error('No storage')}
    Storage.prototype.setItem=()=>{window.storageAccess++;throw new Error('No storage')}
    navigator.mediaDevices.getUserMedia=async()=>{window.cameraAccess++;throw new Error('No camera')}
  })
  await page.goto('https://gallery.test'+base+'#guestbook')
  await page.locator('.guest-card').first().waitFor()
  const selected=()=>page.locator('.guest-card[data-active="true"]')
  const settled=()=>page.waitForFunction(()=>!document.querySelector('.guestbook-page').dataset.rotating)
  assert.equal(await page.locator('.guest-card').count(),5)
  assert.equal(await selected().locator('textarea').inputValue(),'')
  assert.equal(await page.locator('.guestbook-page').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(0, 0, 0)')
  assert.equal(await selected().locator('.card-body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)')
  await page.screenshot({path:'/tmp/int-cards-initial.png'})
  await selected().locator('textarea').fill('안녕!\n내가 만드는 카드')
  await page.getByRole('button',{name:'분홍 카드',exact:true}).click()
  await page.locator('[data-mode=pen]').click()
  const drawing=selected().locator('canvas'),empty=await drawing.evaluate(c=>c.toDataURL())
  const box=await drawing.boundingBox()
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.65);await page.mouse.down()
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75,{steps:12});await page.mouse.up()
  const drawn=await drawing.evaluate(c=>c.toDataURL());assert.notEqual(drawn,empty,'Mouse writes on card')
  await page.locator('.card-undo').click();assert.equal(await drawing.evaluate(c=>c.toDataURL()),empty)
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.65,{steps:12});await page.mouse.up()
  await page.getByRole('button',{name:'꽃 스티커',exact:true}).click()
  await selected().locator('.card-decoration').focus();await page.keyboard.press('ArrowRight')
  await page.screenshot({path:'/tmp/int-cards-edited.png'})
  await page.mouse.move(1200,400);await page.mouse.wheel(0,160);await settled()
  assert.equal(await page.locator('.card-count').textContent(),'2 / 5','Wheel turns the ring')
  assert.equal(await selected().locator('textarea').inputValue(),'','Cards edit independently')
  await page.locator('[data-turn="-1"]').click();await settled()
  assert.equal(await selected().locator('textarea').inputValue(),'안녕!\n내가 만드는 카드')
  assert.equal(await selected().locator('.card-body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(243, 205, 221)')
  assert.equal(await selected().locator('.card-decoration').count(),1)
  assert.notEqual(await selected().locator('canvas').evaluate(c=>c.toDataURL()),empty)
  // Every added card is in the ring, without pagination or a fixed visible-card pool.
  for(let i=0;i<7;i++)await page.locator('.card-add').click()
  assert.equal(await page.locator('.guest-card').count(),12)
  assert.equal(await page.locator('.card-count').textContent(),'12 / 12')
  const seen=new Set()
  for(let i=0;i<12;i++){seen.add(await selected().getAttribute('data-card-index'));await page.locator('[data-turn="1"]').click()}
  await settled();assert.equal(seen.size,12)
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150)
  assert(await page.locator('.guestbook-page').evaluate(e=>e.scrollWidth<=e.clientWidth),'No horizontal page overflow')
  const mobile=await selected().boundingBox();assert(mobile.x>=0&&mobile.x+mobile.width<=390,'Active card fits mobile')
  await page.screenshot({path:'/tmp/int-cards-mobile.png'})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.locator('[data-turn="1"]').click();await settled()
  assert.deepEqual(await page.evaluate(()=>[window.storageAccess,window.cameraAccess]),[0,0])
  await page.reload();await page.locator('.card-add').waitFor()
  assert.equal(await page.locator('.guest-card').count(),5)
  assert.equal(await selected().locator('textarea').inputValue(),'','Reload resets temporary cards')
  assert.deepEqual(remote,[]);assert.deepEqual(errors,[])
  await page.locator('.card-header a').click();await page.locator('.clock-gallery').waitFor()
  console.log('PASS blank card carousel: typing, drawing/undo, color, sticker, wheel, independent state, all 12 added cards reachable, mobile, reduced motion, refresh reset')
}finally{await browser.close()}
