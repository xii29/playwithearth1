import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const compile=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const current=await compile('src/afterglow.ts'),mask=await compile('src/firework-person-mask.ts')
const baseline=process.env.FIREWORK_BASELINE?await compile(process.env.FIREWORK_BASELINE):current
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})})
try{
  const page=await browser.newPage()
  const result=await page.evaluate(async({current,baseline,mask})=>{
    const load=async code=>{const u=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));try{return await import(u)}finally{URL.revokeObjectURL(u)}}
    const render=async code=>{
      const {Afterglow}=await load(code),fx=new Afterglow(),canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d')
      let seed=91;const random=Math.random;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
      fx.setMask(new Float32Array(800*600),800,600);fx.type='willow'
      for(let i=0;i<8;i++)fx.burst(.1+i*.12,.2+i%2*.2,1000,String(i))
      Math.random=random;let ms=0;const frames=[]
      for(let i=0;i<100;i++){const t=performance.now();fx.draw(ctx,800,600,1/30);ms+=performance.now()-t;if(i===20||i===60||i===99)frames.push(ctx.getImageData(0,0,800,600).data)}
      return {frames,ms}
    }
    const before=await render(baseline),after=await render(current);let diff=0,total=0
    for(let f=0;f<before.frames.length;f++)for(let i=0;i<before.frames[f].length;i++){diff+=Math.abs(before.frames[f][i]-after.frames[f][i]);total++}
    const {corePersonMask}=await load(mask),p=Array.from({length:33},()=>({x:0,y:0,visibility:0}))
    for(const [i,x,y] of [[0,.5,.2],[7,.43,.2],[8,.57,.2],[11,.3,.4],[12,.7,.4],[23,.35,.9],[24,.65,.9],[13,.4,.55],[15,.6,.65],[19,.63,.65]])p[i]={x,y,visibility:1}
    const c=document.createElement('canvas'),m=corePersonMask(new Float32Array(10000),100,100,[p],c)
    const at=(x,y)=>m[y*100+x]
    const core={face:at(50,20),trunk:at(50,80),crossedArm:at(50,60),outside:at(10,50)}
    p[23].visibility=p[24].visibility=0
    const closeup=corePersonMask(new Float32Array(10000),100,100,[p],c)[20*100+50]
    return {meanDifference:diff/total,beforeMs:before.ms,afterMs:after.ms,core,closeup}
  },{current,baseline,mask})
  assert(result.meanDifference<.1,'Same resolution, trails, colors and sparkle appearance')
  assert(result.core.face<.1&&result.core.trunk<.1&&result.core.crossedArm>.9&&result.core.outside>.9)
  assert(result.closeup<.1,'Face survives missing hip landmarks')
  console.log('PASS firework visual comparison and head/trunk-only mask',result)
}finally{await browser.close()}
