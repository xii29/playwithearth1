import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try{
  const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://cloud.test/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>${await readFile('src/style.css','utf8')}</style><div id="app"></div>`})
    if(path==='/vision.js')return route.fulfill({contentType:'text/javascript',body:`export const FilesetResolver={forVisionTasks:async()=>({})};export class ImageSegmenter{
      static async createFromOptions(){window.created++;return new ImageSegmenter()}
      segmentForVideo(){const a=new Float32Array(10000).fill(1);if(!window.empty)for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(((x-50)**2+(y-25)**2<110)||(x>30&&x<70&&y>35&&y<88))a[y*100+x]=0;return{confidenceMasks:[{width:100,height:100,getAsFloat32Array:()=>a}],close(){}}}
      close(){window.modelsClosed++}}
      export class HandLandmarker{static async createFromOptions(){window.created++;return new HandLandmarker()}detectForVideo(){return{landmarks:window.hands||[]}}close(){window.modelsClosed++}}`})
    const code=ts.transpileModule(await readFile('src/'+path.slice(1).replace(/\.js$/,'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'@mediapipe/tasks-vision'","'/vision.js'").replaceAll('import.meta.env.BASE_URL',"'/'").replace(/from '(\.\/[\w-]+)'/g,"from '$1.js'")
    await route.fulfill({contentType:'text/javascript',body:code})
  })
  await page.addInitScript(()=>{
    window.created=window.modelsClosed=0
    navigator.mediaDevices.getUserMedia=async()=>{
      const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#aaa';x.fillRect(0,0,800,600)
      const s=c.captureStream(24),timer=setInterval(()=>x.fillRect(0,0,1,1),40),t=s.getVideoTracks()[0],stop=t.stop.bind(t)
      t.stop=()=>{clearInterval(timer);stop()};window.stream=s;return s
    }
  })
  await page.goto('https://cloud.test/')
  await page.evaluate(async()=>{
    const {bodyTemplate}=await import('/body-template.js'),{setupBodyCloud}=await import('/body-cloud-example.js')
    document.querySelector('#app').innerHTML=bodyTemplate();window.dispose=setupBodyCloud(document.querySelector('.body-example'))
  })
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('인식 중'))
  await page.waitForTimeout(300)
  const pixels=()=>page.locator('#body-canvas').evaluate(c=>{
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let bright=0,color=0,outside=0
    for(let i=0;i<a.length;i+=4){if(a[i]>30){bright++;if((i/4)%c.width<150)outside++}if(a[i]!==a[i+1]||a[i]!==a[i+2])color++}return {bright,color,outside}
  })
  const p=await pixels();assert(p.bright>1000&&p.bright<30000,'Dense small dots, not a solid silhouette');assert.equal(p.color,0);assert.equal(p.outside,0)
  assert.equal(await page.locator('#body-background,#body-separate').count(),0)
  assert.equal(await page.evaluate(()=>window.created),1,'Only segmentation model')
  await page.screenshot({path:'/tmp/body-cloud-restored.png'})
  const motion=await page.evaluate(async()=>{
    const {BodyParticles}=await import('/body-particles.js'),fx=new BodyParticles(),w=80,h=60,c=document.createElement('canvas');c.width=800;c.height=600;const ctx=c.getContext('2d'),rgba=new Uint8ClampedArray(w*h*4).fill(200)
    const m=new Float32Array(w*h);for(let y=12;y<50;y++)for(let x=15;x<35;x++)m[y*w+x]=1
    fx.update(m,rgba,w,h);m.fill(0);for(let y=12;y<50;y++)for(let x=35;x<55;x++)m[y*w+x]=1
    fx.update(m,rgba,w,h);fx.draw(ctx,800,600,1/30)
    const count=()=>{const a=ctx.getImageData(0,0,330,600).data;let n=0;for(let i=0;i<a.length;i+=4)if(a[i]>0)n++;return n}
    const trail=count();for(let i=0;i<90;i++)fx.draw(ctx,800,600,1/30);return {trail,settled:count()}
  })
  assert(motion.trail>0,'Movement leaves trails');assert.equal(motion.settled,0,'Trails decay completely')
  await page.evaluate(()=>window.empty=true);await page.waitForTimeout(3300);assert.equal((await pixels()).bright,0)
  await page.evaluate(()=>window.dispose());assert.equal(await page.evaluate(()=>window.modelsClosed),1)
  assert(await page.evaluate(()=>window.stream.getTracks().every(t=>t.readyState==='ended')))
  const occlusion=await page.evaluate(async()=>{
    const {Afterglow,fireworkTypes}=await import('/afterglow.js'),fx=new Afterglow(),c=document.createElement('canvas');c.width=800;c.height=600
    const ctx=c.getContext('2d'),mask=new Float32Array(80*60),counts=[]
    for(const type of fireworkTypes){fx.reset();fx.type=type;fx.setMask(mask,80,60);fx.burst(.5,.5,1000);for(let i=0;i<15;i++)fx.draw(ctx,800,600,1/30);const p=ctx.getImageData(0,0,800,600).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]+p[i+1]+p[i+2]>0)n++;counts.push(n)}
    mask.fill(1);fx.setMask(mask,80,60);fx.draw(ctx,800,600,1/30)
    const data=ctx.getImageData(0,0,800,600).data;let visible=0;for(let i=0;i<data.length;i+=4)visible+=data[i]+data[i+1]+data[i+2]
    return {counts,visible}
  })
  assert(occlusion.counts.every(n=>n>100),'Every firework type renders');assert.equal(occlusion.visible,0,'Person mask occludes fireworks completely')
  await page.evaluate(async()=>{
    window.empty=false
    const {afterglowTemplate}=await import('/afterglow.js'),{setupBodyCloud}=await import('/body-cloud-example.js')
    document.querySelector('#app').innerHTML=afterglowTemplate();window.dispose=setupBodyCloud(document.querySelector('.body-example'),true)
  })
  await page.waitForFunction(()=>document.querySelector('#body-status').textContent.includes('인식 중'))
  await page.locator('#firework-type').selectOption('heart')
  await page.locator('.afterglow-panel summary').click();assert.equal(await page.locator('.afterglow-panel').getAttribute('open'),null)
  await page.locator('#body-canvas').click({position:{x:160,y:170}});await page.waitForTimeout(350)
  assert((await pixels()).color>30,'Pointer creates colored firework')
  await page.screenshot({path:'/tmp/afterglow.png'})
  await page.locator('.afterglow-panel summary').click();assert.notEqual(await page.locator('.afterglow-panel').getAttribute('open'),null)
  await page.evaluate(()=>window.dispose());assert.equal(await page.evaluate(()=>window.created),await page.evaluate(()=>window.modelsClosed))
  assert.deepEqual(errors,[]);console.log('PASS small monochrome filled silhouette, motion trails/decay, no hand model, empty mask and cleanup')
}finally{await browser.close()}
