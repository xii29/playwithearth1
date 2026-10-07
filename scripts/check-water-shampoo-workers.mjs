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
    window.workerErrors=[];window.workerStats={results:0,ready:0,hands:0,mask:0,frames:0,closed:0,inflight:0,maxInflight:0}
    const NativeWorker=window.Worker
    window.Worker=class extends NativeWorker{
      constructor(...args){super(...args);this.pending=0;this.addEventListener('message',({data:m})=>{
        if(m.type in window.workerStats)window.workerStats[m.type]++
        if(m.type==='result'){window.workerStats.inflight--;this.pending--;window.workerStats.results++}if(m.type==='error')window.workerErrors.push(m)
      })}
      postMessage(m,...args){if(m.type==='frame'){this.pending++;if(this.pending>1)window.workerErrors.push('Queued frames');window.workerStats.frames++;window.workerStats.inflight++;window.workerStats.maxInflight=Math.max(window.workerStats.maxInflight,window.workerStats.inflight);window.inferenceSize=[m.bitmap.width,m.bitmap.height]}super.postMessage(m,...args)}
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
  for (const name of ['water', 'shampoo']) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?test=${name}#${name}`)
    assert.equal(await page.locator('.example-nav button').count(),1,'Only back navigation remains')
    await page.locator(`#${name}-camera-toggle`).click()
    await page.waitForFunction(n => window.workerStats.ready >= (n === 'water' ? 1 : 2) && window.workerStats.results >= 3, name, { timeout: 60000 })
    assert.equal(await page.evaluate(() => window.workerErrors.length), 0)
    const workers = await page.evaluate(() => window.workerStats.ready)
    await page.locator(`#${name}-camera-toggle`).click()
    assert(await page.evaluate(() => window.testStream.getTracks().every(t => t.readyState === 'ended')))
    assert.equal(await page.evaluate(() => window.workerStats.closed), workers)
    const frames = await page.evaluate(() => window.workerStats.frames)
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => window.workerStats.frames), frames)
    await page.locator(`#${name}-camera-toggle`).click()
    await page.waitForFunction(w => window.workerStats.ready === w * 2, workers, { timeout: 60000 })
    await page.locator('[data-example="home"]').click()
    assert.equal(await page.evaluate(() => window.workerStats.closed), workers * 2)
  }
  assert.deepEqual(errors, [])
  console.log('PASS WaterTouch/Shampoo real WASM workers, results, camera stop/restart, navigation cleanup, back-only navigation')
}finally{await browser.close();await new Promise(r=>server.close(r))}
