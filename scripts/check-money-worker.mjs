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
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{
    window.workerStats={ready:0,hands:0,mask:0,frames:0,closed:0,inflight:0,maxInflight:0}
    const NativeWorker=window.Worker
    window.Worker=class extends NativeWorker{
      constructor(...args){super(...args);this.addEventListener('message',({data:m})=>{
        if(m.type in window.workerStats)window.workerStats[m.type]++
        if(m.type==='done')window.workerStats.inflight--
      })}
      postMessage(m,...args){if(m.type==='frame'){window.workerStats.frames++;window.workerStats.inflight++;window.workerStats.maxInflight=Math.max(window.workerStats.maxInflight,window.workerStats.inflight);window.inferenceSize=[m.bitmap.width,m.bitmap.height]}super.postMessage(m,...args)}
      terminate(){window.workerStats.closed++;super.terminate()}
    }
    navigator.mediaDevices.getUserMedia=async constraints=>{
      window.cameraConstraints=constraints
      const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d')
      const paint=()=>{ctx.fillStyle='#557799';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#fff';ctx.fillRect(80+(performance.now()/10)%600,180,100,100)}
      paint();const stream=c.captureStream(30),timer=setInterval(paint,33),track=stream.getVideoTracks()[0],stop=track.stop.bind(track)
      track.stop=()=>{clearInterval(timer);stop()};window.testStream=stream;return stream
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/#money`)
  assert.equal(await page.locator('#global-capture-button').isVisible(),false,'Money Rain has no capture button')
  await page.waitForFunction(()=>window.workerStats.hands>=3&&window.workerStats.mask>=2,{},{timeout:60000})
  const stats=await page.evaluate(()=>({stats:window.workerStats,size:window.inferenceSize,camera:window.cameraConstraints.video,canvas:[document.querySelector('#body-canvas').width,document.querySelector('#body-canvas').height]}))
  assert.equal(stats.camera.width.ideal,1920);assert.equal(stats.camera.height.ideal,1080)
  assert(Math.max(...stats.size)<=960,'Inference input stays bounded independently of camera quality')
  assert.equal(stats.stats.maxInflight,1,'Only one inference frame can be outstanding')
  assert.equal(stats.canvas[0],2560,'Retina display uses the bounded high-resolution surface')
  await page.screenshot({path:'/tmp/money-worker-hd.png'})
  await page.locator('#body-camera-toggle').click()
  assert(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')))
  const frames=await page.evaluate(()=>window.workerStats.frames)
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(()=>window.workerStats.frames),frames,'Stopped camera submits no frames')
  assert.equal(await page.evaluate(()=>window.workerStats.closed),1,'Worker is released')
  await page.locator('#body-camera-toggle').click()
  await page.waitForFunction(()=>window.workerStats.ready===2)
  await page.locator('[data-example="home"]').click()
  assert.equal(await page.evaluate(()=>window.workerStats.closed),2)
  await page.evaluate(()=>{window.Worker=undefined;location.hash='money'})
  await page.waitForFunction(()=>document.querySelector('#body-camera-toggle')?.textContent==='카메라 중지',{},{timeout:60000})
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(()=>window.workerStats.ready),2,'Unavailable worker uses compatible main-thread inference')
  await page.locator('[data-example="home"]').click()
  assert(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),'Fallback camera is released')
  assert.deepEqual(errors,[])
  console.log('PASS actual MediaPipe worker and fallback, bounded one-frame pipeline, 1080p request, Retina rendering, stop/restart/navigation cleanup',stats.stats)
}finally{await browser.close();await new Promise(r=>server.close(r))}
