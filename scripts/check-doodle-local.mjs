import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const main=await readFile('src/main.ts','utf8'),template=main.split('doodle: () => `')[1].split('`,')[0],css=await readFile('src/style.css','utf8')
const code=ts.transpileModule(await readFile('src/doodle-face.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll('import.meta.env.BASE_URL',"'/'").replace("'@mediapipe/tasks-vision'","'/vision.js'")
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try{
  const page=await browser.newPage({viewport:process.env.MOBILE?{width:390,height:844}:{width:1100,height:850}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://doodle.test/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>${css}html,body,#app{height:100%;margin:0}.doodle-example{height:100vh}</style><div id="app">${template}</div>`})
    if(path==='/game.js')return route.fulfill({contentType:'text/javascript',body:code})
    if(path==='/vision.js')return route.fulfill({contentType:'text/javascript',body:`export const FilesetResolver={forVisionTasks:async path=>{window.wasm=path;return {}}};
    export class FaceLandmarker{static async createFromOptions(v,o){window.options.push(o);if(o.baseOptions.delegate==='GPU'&&window.failGPU)throw Error('GPU');return new FaceLandmarker()}detectForVideo(){window.inferred.push(['face',window.clock]);return{faceLandmarks:window.testFaces}}close(){window.modelsClosed++}}
    export class HandLandmarker{static async createFromOptions(v,o){window.options.push(o);return new HandLandmarker()}detectForVideo(){window.inferred.push(['hand',window.clock]);return{landmarks:window.testHands}}close(){window.modelsClosed++}}`})
    throw Error('Unexpected request '+path)
  })
  await page.goto('https://doodle.test/')
  await page.evaluate(async()=>{
    window.clock=0;window.options=[];window.inferred=[];window.modelsClosed=0;window.opens=0;window.failGPU=true;window.testHands=[];window.testFaces=[]
    const callbacks=new Map();let sequence=0
    window.requestAnimationFrame=f=>{callbacks.set(++sequence,f);return sequence};window.cancelAnimationFrame=id=>callbacks.delete(id)
    performance.now=()=>window.clock
    window.step=ms=>{window.clock+=ms;const list=[...callbacks.values()];callbacks.clear();list.forEach(f=>f(window.clock))}
    window.advance=(ms)=>{for(let i=0;i<ms;i+=50)window.step(50)}
    const source=document.createElement('canvas');source.width=960;source.height=720;const ctx=source.getContext('2d');ctx.fillStyle='#f00000';ctx.fillRect(0,0,480,720);ctx.fillStyle='#0000f0';ctx.fillRect(480,0,480,720)
    navigator.mediaDevices.getUserMedia=async c=>{window.opens++;window.constraints=c;window.stream=source.captureStream(30);const timer=setInterval(()=>{ctx.fillStyle='#f00000';ctx.fillRect(0,0,1,1)},33),track=window.stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop()};return window.stream}
    const video=document.querySelector('video');Object.defineProperty(video,'currentTime',{get:()=>window.clock/1000})
    window.face=x=>{const p=Array.from({length:478},()=>({x,y:.5,z:0}));p[234]={x:x-.08,y:.5,z:0};p[454]={x:x+.08,y:.5,z:0};p[10]={x,y:.32,z:0};p[152]={x,y:.68,z:0};return p}
    window.hand=(x,gap=.015)=>{const p=Array.from({length:21},()=>({x,y:.5,z:0}));p[0]={x,y:.68,z:0};p[5]={x:x-.06,y:.55,z:0};p[17]={x:x+.06,y:.55,z:0};p[4]={x:x-gap/2,y:.5,z:0};p[8]={x:x+gap/2,y:.5,z:0};return p}
    window.cleanup=(await import('/game.js')).setupDoodleFace(document.querySelector('.doodle-example'))
  })
  await page.locator('#doodle-start').evaluate(e=>e.click());await page.waitForFunction(()=>!document.querySelector('#doodle-game').hidden,{},{polling:100,timeout:10000}).catch(async e=>{console.log(await page.evaluate(()=>({message:document.querySelector('#doodle-lobby-status').textContent,ready:document.querySelector('video').readyState,options:window.options})),errors);throw e})
  await page.evaluate(()=>window.advance(100))
  const sample=()=>page.evaluate(()=>[...document.querySelectorAll('.doodle-panel canvas')].map(c=>[...c.getContext('2d').getImageData(c.width*.5,c.height*.75,1,1).data].slice(0,3)))
  assert.deepEqual(await sample(),[[0,0,240],[240,0,0]],'Mirrored half-camera assignment before swap, even without faces')
  assert.equal(await page.evaluate(()=>window.opens),1)
  assert.equal(await page.evaluate(()=>window.constraints.audio),false)
  await page.evaluate(()=>{window.testFaces=[window.face(.75),window.face(.25)];window.advance(800)})
  assert((await page.locator('#doodle-timer').textContent()).startsWith('READY'))
  await page.evaluate(()=>window.advance(5100));assert(await page.locator('#doodle-transition-layer').evaluate(e=>e.classList.contains('is-active')))
  const direction=await page.locator('#doodle-transition-layer').evaluate(e=>({x:parseFloat(e.style.getPropertyValue('--swap-x')),y:parseFloat(e.style.getPropertyValue('--swap-y'))}))
  assert(process.env.MOBILE?direction.y>100&&Math.abs(direction.x)<1:direction.x>100&&Math.abs(direction.y)<1,'Swap follows desktop/mobile panel direction')
  await page.evaluate(()=>window.advance(900));assert.equal(await page.locator('#doodle-label-one').textContent(),'PLAYER 2')
  assert.equal(await page.locator('#doodle-transition-layer').evaluate(e=>e.classList.contains('is-active')),false)
  assert.deepEqual(await sample(),[[240,0,0],[0,0,240]],'Camera halves really exchange')
  await page.locator('[data-doodle-player="1"][data-doodle-color="#ffd85b"]').click()
  assert(await page.locator('[data-doodle-player="2"][data-doodle-color="#30d7c5"]').evaluate(e=>e.classList.contains('is-selected')))
  await page.evaluate(()=>{window.testHands=[window.hand(.95)];window.advance(250);window.testHands=[window.hand(.75)];window.advance(250)})
  assert.equal(await page.locator('#doodle-score-one').textContent(),'0','Pinch begun outside cannot start later by entering the face')
  await page.evaluate(()=>{window.testHands=[window.hand(.75,.15)];window.advance(250);window.testHands=[window.hand(.75)];window.advance(200)})
  assert.equal(await page.locator('#doodle-score-one').textContent(),'1','PLAYER 1 starts a stroke on opponent face')
  await page.evaluate(()=>{window.testHands=[];window.advance(150);window.testHands=[window.hand(.75)];window.advance(150)})
  assert.equal(await page.locator('#doodle-score-one').textContent(),'1','Short hand loss preserves the current stroke')
  await page.evaluate(()=>window.advance(60500));assert(await page.locator('#doodle-toast').isVisible())
  await page.evaluate(()=>window.advance(2500));assert.equal(await page.locator('#doodle-toast').isVisible(),false);assert(await page.locator('#doodle-game').isVisible())
  await page.evaluate(()=>window.advance(10500));assert(await page.locator('#doodle-lobby').isVisible())
  const stats=await page.evaluate(()=>({closed:window.modelsClosed,ended:window.stream.getTracks().every(t=>t.readyState==='ended'),max:Math.max(...Object.values(window.inferred.reduce((a,[,t])=>(a[t]=(a[t]||0)+1,a),{}))),options:window.options}))
  assert(stats.ended);assert(stats.closed>=2);assert.equal(stats.max,1,'Only one inference per frame')
  assert(stats.options.some(o=>o.numFaces===2&&o.baseOptions.delegate==='CPU'));assert(stats.options.some(o=>o.numHands===2))
  await page.evaluate(()=>window.cleanup());assert.deepEqual(errors,[])
  await page.evaluate(async()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')};window.cleanup=(await import('/game.js')).setupDoodleFace(document.querySelector('.doodle-example'));document.querySelector('#doodle-start').click()})
  await page.waitForFunction(()=>document.querySelector('#doodle-lobby-status').textContent.includes('권한'),{},{polling:100})
  assert.equal(await page.locator('#doodle-start').isDisabled(),false,'Camera denial allows retry')
  await page.evaluate(()=>window.cleanup())
  console.log('PASS local DoodleFace camera halves, GPU fallback, readiness/countdown/sliding swap, owner palette, pinch/grace, timed showcase and cleanup')
}finally{await browser.close()}
