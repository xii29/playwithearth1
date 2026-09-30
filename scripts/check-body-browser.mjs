import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const css = await readFile('src/style.css', 'utf8')
const vision = `export const FilesetResolver={forVisionTasks:async()=>({})};export class ImageSegmenter{
static async createFromOptions(){window.created++;await new Promise(r=>setTimeout(r,window.modelDelay||0));return new ImageSegmenter()}
segmentForVideo(){const width=100,height=100,a=new Float32Array(10000).fill(1);if(window.maskMode!=='empty')for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(window.maskMode==='full'||(window.maskMode==='body'?(x>30&&x<70&&y>35&&y<90):window.maskMode==='left'?x<50:x>=50))a[y*100+x]=0;return{confidenceMasks:[{width,height,getAsFloat32Array:()=>a}],close(){}}}
close(){window.modelsClosed++}}
export class HandLandmarker{static async createFromOptions(){window.created++;return new HandLandmarker()}detectForVideo(){return{landmarks:window.hands||[]}}close(){window.modelsClosed++}}
`
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://body.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><style>${css}</style><div id="app"></div>` })
    if (path === '/vision.js') return route.fulfill({ contentType: 'text/javascript', body: vision })
    const source = ts.transpileModule(await readFile(`src/${path.slice(1).replace(/\.js$/, '.ts')}`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      .replace("'@mediapipe/tasks-vision'", "'/vision.js'").replaceAll('import.meta.env.BASE_URL', "'/'").replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'")
    await route.fulfill({ contentType: 'text/javascript', body: source })
  })
  await page.addInitScript(() => {
    window.created = window.modelsClosed = window.cameraCalls = 0; window.streams = []; window.maskMode = 'left'
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraCalls++; if (window.rejectCamera) throw new Error('Denied')
      const c = document.createElement('canvas'); c.width = 800; c.height = 600; const ctx = c.getContext('2d')
      const paint = () => { ctx.fillStyle = '#778899'; ctx.fillRect(0, 0, 800, 600); if (window.moving) { ctx.fillStyle = '#d5bba2'; ctx.fillRect(70 + Math.sin(performance.now() / 130) * 45, 140, 180, 220) } }; paint()
      const stream = c.captureStream(20), pump = setInterval(paint, 50), track = stream.getVideoTracks()[0], stop = track.stop.bind(track)
      track.stop = () => { clearInterval(pump); stop() }; window.streams.push(stream); return stream
    }
  })
  await page.goto('https://body.test/')
  const mount = (money=false) => page.evaluate(async money => {
    window.disposeExample?.()
    const {bodyTemplate}=await import('/body-template.js'),{setupBodyExample}=await import('/body-examples.js')
    const {moneyTemplate}=await import('/money-template.js')
    document.querySelector('#app').innerHTML=money?moneyTemplate():bodyTemplate();window.disposeExample=setupBodyExample(document.querySelector('.body-example'),money)
  },money)
  const hand=Array.from({length:21},()=>({x:.5,y:.8,z:0}))
  for(const [i,x,y] of [[5,.4,.65],[6,.43,.52],[7,.52,.39],[8,.57,.26],[9,.6,.65],[10,.57,.52],[11,.48,.39],[12,.43,.26],[17,.7,.7]])hand[i]={x,y,z:0}
  const inspect = () => page.locator('#body-canvas').evaluate(c=>{
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data
    let left=0,right=0,color=0
    for(let y=80;y<c.height-80;y++)for(let x=20;x<c.width-20;x++){
      const i=(y*c.width+x)*4
      if(a[i]!==a[i+1]||a[i]!==a[i+2])color++
      if(a[i]>100){if(x<300)left++;if(x>500)right++}
    }
    return {left,right,color}
  })
  await mount()
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('인식 중'))
  await page.waitForTimeout(200)
  let p=await inspect();assert(p.left>1000&&p.right>1000);assert(p.color>1000,'Melt renders color')
  await page.screenshot({path:'/tmp/body-melt-full.png'})
  await page.evaluate(h=>window.hands=[h],hand)
  await page.waitForFunction(()=>document.querySelector('#body-separate').getAttribute('aria-pressed')==='true')
  await page.waitForTimeout(1000)
  p=await inspect();assert(p.left>1000,'Background retained');assert.equal(p.right,0,'Person becomes transparent over dark spectrum backdrop')
  await page.screenshot({path:'/tmp/body-melt-transparent.png'})
  await page.waitForTimeout(1100)
  assert.equal(await page.locator('#body-separate').getAttribute('aria-pressed'),'true','Holding crossed fingers maintains transparency')
  await page.evaluate(()=>window.hands=[])
  await page.waitForFunction(()=>document.querySelector('#body-separate').getAttribute('aria-pressed')==='false')
  await page.waitForTimeout(700)
  p=await inspect();assert(p.right>1000,'Releasing gesture restores person')
  await page.locator('#body-separate').click()
  await page.evaluate(()=>window.maskMode='empty');await page.waitForTimeout(350)
  p=await inspect();assert(p.left>1000&&p.right>1000,'No person means no mask hole')
  await page.evaluate(()=>window.disposeExample())
  assert.equal(await page.evaluate(()=>window.modelsClosed),2)
  assert(await page.evaluate(()=>window.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))))
  await page.evaluate(()=>window.modelDelay=300);await mount()
  await page.waitForFunction(()=>window.created===3);await page.evaluate(()=>window.disposeExample())
  await page.waitForFunction(()=>window.modelsClosed===3)
  await page.evaluate(()=>window.rejectCamera=true);await mount()
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('열지 못했어요'))
  await page.evaluate(()=>window.disposeExample());assert.deepEqual(errors,[])
  await page.evaluate(()=>{window.rejectCamera=false;window.modelDelay=0;window.maskMode='body';window.hands=[]})
  await mount(true);await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('돈을'))
  await page.waitForTimeout(2400)
  const moneyVisible=await page.locator('#body-canvas').evaluate(c=>{
    const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data
    let count=0;for(let i=0;i<p.length;i+=4)if(p[i+1]>p[i]+10&&p[i+1]>p[i+2]+10)count++
    return count
  })
  assert(moneyVisible>100,'Money example renders falling banknotes over live camera')
  await page.screenshot({path:'/tmp/money-rain.png'})
  await page.locator('#body-separate').click()
  await page.evaluate(()=>window.disposeExample())
  assert.equal(await page.evaluate(()=>window.created),await page.evaluate(()=>window.modelsClosed))
  console.log('PASS: melted color, crossed-finger transparency, hold/release, manual control, mask loss, camera/model cleanup, denied permission, money unchanged. Tracking mocked.')
} finally { await browser.close() }
