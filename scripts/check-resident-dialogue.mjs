import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const source=await readFile('src/earth-residents.ts','utf8'),css=await readFile('src/style.css','utf8')
const template=source.split('ui.innerHTML = `')[1].split('`\n')[0]
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try{
  const page=await browser.newPage({viewport:{width:1000,height:800}})
  await page.setContent('<meta charset="utf-8"><style>'+css+' .earth-example{width:100vw;height:100dvh;position:relative;background:#171d32}</style><main class="earth-example earth-space-edition"><div class="earth-resident-ui">'+template+'</div></main>')
  await page.evaluate(()=>{
    document.querySelector('.earth-conversation').hidden=false
    document.querySelector('#earth-resident-name').textContent='너굴'
    document.querySelector('#earth-dialogue').textContent='여기에서 만난 이웃들이 참 좋아. 오늘은 누구를 만났어? 천천히 같이 걸어 볼까?'
  })
  assert.equal(await page.locator('.earth-dialogue-bubble').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 251, 228)')
  assert(await page.locator('#earth-unfollow').isVisible())
  assert(await page.locator('#earth-chat input').isVisible())
  assert(await page.locator('#earth-edit-texture').isVisible())
  await page.screenshot({path:'/tmp/resident-dialogue-desktop.png'})
  await page.setViewportSize({width:390,height:844})
  const box=await page.locator('.earth-conversation').boundingBox()
  assert(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844)
  assert(await page.locator('#earth-rename').isVisible())
  await page.screenshot({path:'/tmp/resident-dialogue-mobile.png'})
  console.log('PASS resident dialogue: cream bubble, name tag, preserved controls, desktop/mobile fit.')
}finally{await browser.close()}
