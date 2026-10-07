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
      postMessage(m,...args){if(m.type==='frame'&&m.bitmap){window.workerStats.frames++;window.workerStats.inflight++;window.workerStats.maxInflight=Math.max(window.workerStats.maxInflight,window.workerStats.inflight);window.inferenceSize=[m.bitmap.width,m.bitmap.height]}super.postMessage(m,...args)}
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
  await page.goto(`http://127.0.0.1:${server.address().port}/#fireworks`)
  assert.equal(await page.locator('#global-capture-button').isVisible(),false,'Fireworks has no capture button')
  await page.waitForFunction(()=>window.workerStats.hands>=3&&window.workerStats.mask>=2,{},{timeout:60000})

  await page.waitForFunction(()=>window.workerStats.ready>=2)
  assert.equal(await page.evaluate(()=>window.cameraConstraints.video.width.ideal),1920,'Desktop requests HD camera without enlarging inference frames')
  assert(await page.evaluate(()=>window.inferenceSize[0]<=640),'Inference work remains bounded')
  assert.equal(page.workers().length,2,'Separate vision and drawing workers')
  await page.locator('#body-canvas').click({position:{x:600,y:300}})
  await page.waitForTimeout(1200)
  const lit=await page.locator('#body-canvas').evaluate(c=>{
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0
    for(let i=0;i<a.length;i+=4)if(a[i]>210&&a[i+1]>150)n++
    return n
  })
  await page.screenshot({path:'/tmp/firework-worker-preview.png'})
  console.log('Render inspection',lit,await page.evaluate(()=>window.workerStats),errors)
  assert(lit>50,'Worker draws visible fireworks over the camera')
  assert.equal(await page.locator('.afterglow-panel p,.afterglow-example .body-guide').count(),0)
  await page.locator('[data-example="home"]').click()
  await page.waitForFunction(()=>window.workerStats.closed>=2)
  assert.deepEqual(errors,[])
  console.log('PASS real vision + render workers, rendered sparks, hidden capture/copy, navigation cleanup')
}finally{await browser.close();await new Promise(r=>server.close(r))}
