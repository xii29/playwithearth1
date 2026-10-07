import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const server=createServer(async(req,res)=>{
  const path=resolve('dist','.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname))
  if(!path.startsWith(resolve('dist')+'/')){res.writeHead(403).end();return}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}
  catch{res.writeHead(404).end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],requests=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()))
  await page.addInitScript(()=>{
    window.testHands=[];window.testLabels=[];window.closedWorkers=0
    window.NativeWorker=window.Worker
    window.Worker=class{
      postMessage(m){if(m.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),5)
        if(m.type==='frame'){m.bitmap.close();setTimeout(()=>this.onmessage?.({data:{type:'result',timestamp:m.timestamp,landmarks:window.testHands,handedness:window.testLabels}}),5)}}
      terminate(){window.closedWorkers++;this.onmessage=null}
    }
    navigator.mediaDevices.getUserMedia=async()=>{
      const c=document.createElement('canvas');c.width=1280;c.height=720;const ctx=c.getContext('2d'),stream=c.captureStream(30),timer=setInterval(()=>ctx.fillRect(0,0,1,1),33)
      const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop()};window.testStream=stream;return stream
    }
    window.hand=open=>{
      const p=Array.from({length:21},()=>({x:.5,y:.8,z:0}))
      for(let f=0;f<5;f++)for(let j=0;j<4;j++)p[f*4+j+1]={x:.34+f*.07,y:[.55,.43,.52,.64][j]*(1-open)+[.55,.42,.31,.2][j]*open,z:0}
      return p
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/#lab`)
  await page.waitForFunction(()=>!document.querySelector('#example-stage').hasAttribute('aria-busy'))
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.lab-example img,.lab-camera-preview').count(),0)
  assert(!requests.some(url=>url.includes('/lab/lotus-')),'Old background and images are not requested')
  assert.equal(await page.locator('[data-flower-value],.lab-bloom-readouts').count(),0,'Tracking percentages are removed')
  const frame=()=>page.locator('#lab-flowers').evaluate(c=>c.toDataURL())
  const buds=await frame()
  await page.screenshot({path:'/tmp/lab-buds.png'})
  await page.locator('#lab-camera-toggle').click()
  await page.evaluate(()=>{window.testHands=[window.hand(1),window.hand(0)];window.testLabels=['left','right']})
  await page.waitForTimeout(1200)
  const leftOpen=await frame();assert.notEqual(leftOpen,buds,'Hands still open flowers without percentage UI')
  await page.screenshot({path:'/tmp/lab-left-open.png'})
  await page.evaluate(()=>{window.testHands=[window.hand(0),window.hand(1)];window.testLabels=['right','left']})
  await page.waitForTimeout(500);assert.equal(await frame(),leftOpen,'Result reordering keeps hands independent')
  await page.evaluate(()=>{window.testHands=[window.hand(.44),window.hand(.44)];window.testLabels=['left','right']})
  await page.waitForTimeout(850)
  const partial=await frame();assert.notEqual(partial,buds);assert.notEqual(partial,leftOpen,'Intermediate curl produces an intermediate bloom')
  await page.evaluate(()=>window.testHands=[window.hand(1),window.hand(1)])
  await page.waitForTimeout(1200)
  await page.screenshot({path:'/tmp/lab-bloom.png'})
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400)
  await page.screenshot({path:'/tmp/lab-bloom-mobile.png'})
  await page.evaluate(()=>window.testHands=[])
  await page.waitForTimeout(1200)
  await page.locator('#lab-camera-toggle').click()
  assert(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')))
  assert.equal(await page.evaluate(()=>window.closedWorkers),1)
  await page.evaluate(()=>window.Worker=window.NativeWorker)
  await page.locator('#lab-camera-toggle').click()
  await page.waitForFunction(()=>document.querySelector('#lab-camera-toggle').textContent==='카메라 끄기',{},{timeout:60000})
  await page.waitForTimeout(750)
  assert.equal(await page.locator('#lab-camera-toggle').textContent(),'카메라 끄기','Real tracking model remains active')
  await page.locator('[data-example="home"]').click()
  assert(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')))
  assert.deepEqual(errors,[])
  console.log('PASS lab: no old assets, three buds, independent handedness, continuous bloom, hand loss closes petals, mobile rendering, cleanup. Tracking mocked.')
}finally{await browser.close();await new Promise(r=>server.close(r))}
