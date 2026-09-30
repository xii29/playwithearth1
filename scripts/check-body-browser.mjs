import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const css = await readFile('src/style.css', 'utf8')
const vision = `export const FilesetResolver={forVisionTasks:async()=>({})};export class ImageSegmenter{
static async createFromOptions(){window.created++;await new Promise(r=>setTimeout(r,window.modelDelay||0));return new ImageSegmenter()}
segmentForVideo(){const width=100,height=100,a=new Float32Array(10000).fill(1),face=new Float32Array(10000);if(window.maskMode!=='empty')for(let y=0;y<100;y++)for(let x=0;x<100;x++){if(x>40&&x<60&&y>20&&y<40)face[y*100+x]=1;if(window.maskMode==='full'||(window.maskMode==='body'?(x>30&&x<70&&y>35&&y<90):window.maskMode==='left'?x<50:x>=50))a[y*100+x]=0}return{confidenceMasks:[{width,height,getAsFloat32Array:()=>a},null,null,{width,height,getAsFloat32Array:()=>face}],close(){}}}
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
      const paint = () => { ctx.fillStyle = window.backgroundColor||'#778899'; ctx.fillRect(0, 0, 800, 600); if (window.moving) { ctx.fillStyle = '#d5bba2'; ctx.fillRect(70 + Math.sin(performance.now() / 130) * 45, 140, 180, 220) } }; paint()
      const stream = c.captureStream(20), pump = setInterval(paint, 50), track = stream.getVideoTracks()[0], stop = track.stop.bind(track)
      track.stop = () => { clearInterval(pump); stop() }; window.streams.push(stream); return stream
    }
  })
  await page.goto('https://body.test/')
  const liquid=await page.evaluate(async()=>{
    const {BodyMeltedSpectrum}=await import('/body-melt.js')
    const fx=new BodyMeltedSpectrum(),w=96,h=72,background=new Uint8ClampedArray(w*h*4),camera=new Uint8ClampedArray(w*h*4),mask=new Float32Array(w*h)
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,p=i*4,v=40+x*1.7
      background[p]=v;background[p+1]=y*2;background[p+2]=120;background[p+3]=255
      camera.set(background.subarray(p,p+4),p)
      if(x>24&&x<70&&y>10&&y<62){mask[i]=1;camera[p]=camera[p+1]=camera[p+2]=210}
    }
    fx.resize(w,h);fx.captureBackground(background);fx.render(camera,mask,w,h,1,1000)
    const result=fx.canvas.getContext('2d').getImageData(0,0,w,h).data
    const pixel=(x,y)=>Array.from(result.slice((y*w+x)*4,(y*w+x)*4+3))
    let rimChanged=0
    for(let y=16;y<56;y++)for(let x=23;x<28;x++)if(Math.abs(result[(y*w+x)*4]-background[(y*w+x)*4])>8)rimChanged++
    return {inside:pixel(45,35),expected:Array.from(background.slice((35*w+45)*4,(35*w+45)*4+3)),outside:pixel(5,35),outsideExpected:Array.from(camera.slice((35*w+5)*4,(35*w+5)*4+3)),rimChanged}
  })
  assert.deepEqual(liquid.inside,liquid.expected,'Transparent interior shows real clean plate')
  assert.deepEqual(liquid.outside,liquid.outsideExpected,'Outside remains live camera')
  assert(liquid.rimChanged>30,'Liquid contour refracts the background')
  const mount = (money=false) => page.evaluate(async money => {
    window.disposeExample?.()
    const {bodyTemplate}=await import('/body-template.js'),{setupBodyExample}=await import('/body-examples.js')
    const {moneyTemplate}=await import('/money-template.js')
    document.querySelector('#app').innerHTML=money?moneyTemplate():bodyTemplate();window.disposeExample=setupBodyExample(document.querySelector('.body-example'),money)
  },money)
  const sweep=async(xs,y=.3)=>{
    for(const x of xs){await page.evaluate(({x,y})=>window.hands=[Array.from({length:21},()=>({x,y,z:0}))],{x,y});await page.waitForTimeout(150)}
    await page.evaluate(()=>window.hands=[]);await page.waitForTimeout(300)
  }
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
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('배경 저장 대기'))
  await page.waitForTimeout(1100)
  assert((await page.locator('#body-status').textContent()).includes('배경 저장 대기'),'Never capture a person as background')
  await page.evaluate(()=>{window.maskMode='empty';window.backgroundColor='#223344'})
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('배경 저장 완료'))
  await page.evaluate(()=>{window.maskMode='left';window.backgroundColor='#778899'})
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('인식 중'))
  await page.waitForTimeout(200)
  let p=await inspect();assert(p.left>1000&&p.right>1000);assert(p.color>1000,'Melt renders color')
  await page.screenshot({path:'/tmp/body-melt-full.png'})
  await sweep([.7,.6,.5,.4,.3])
  assert.equal(await page.locator('#body-separate').getAttribute('aria-pressed'),'false','Reverse sweep ignored')
  await sweep([.3,.4,.5,.6,.7],.85)
  assert.equal(await page.locator('#body-separate').getAttribute('aria-pressed'),'false','Sweep below face ignored')
  await sweep([.3,.4,.5,.6,.7])
  await page.waitForFunction(()=>document.querySelector('#body-separate').getAttribute('aria-pressed')==='true')
  await page.waitForTimeout(1000)
  p=await inspect();assert(p.left>1000,'Live background retained');assert.equal(p.right,0,'Person reveals stored camera background')
  const restored=await page.locator('#body-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(c.width*.8,c.height*.5,1,1).data))
  assert(Math.abs(restored[0]-34)<4&&Math.abs(restored[1]-51)<4&&Math.abs(restored[2]-68)<4,'Clean plate color is preserved inside person')
  await page.screenshot({path:'/tmp/body-melt-transparent.png'})
  await page.waitForTimeout(1100)
  assert.equal(await page.locator('#body-separate').getAttribute('aria-pressed'),'true','Single sweep latches transparency')
  await page.evaluate(()=>window.hands=[])
  await page.waitForTimeout(500)
  assert.equal(await page.locator('#body-separate').getAttribute('aria-pressed'),'true','Removing hand preserves transparency')
  await page.locator('#body-separate').click()
  await page.waitForFunction(()=>document.querySelector('#body-separate').getAttribute('aria-pressed')==='false')
  await page.waitForTimeout(700)
  p=await inspect();assert(p.right>1000,'Releasing gesture restores person')
  await page.locator('#body-separate').click()
  await page.evaluate(()=>window.maskMode='empty');await page.waitForTimeout(350)
  p=await inspect();assert(p.left>1000&&p.right>1000,'No person means no mask hole')
  await page.locator('#body-background').click()
  assert((await page.locator('#body-status').textContent()).includes('배경 저장 대기'),'Background recapture control works')
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
  console.log('PASS: liquid clean plate, face-level right-to-left swipe, wrong direction/height rejection, persistent transparency, manual reset, mask loss, cleanup, money unchanged. Tracking mocked.')
} finally { await browser.close() }
