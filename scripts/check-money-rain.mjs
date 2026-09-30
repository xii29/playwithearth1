import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const code=ts.transpileModule(await readFile('src/money-rain.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {MoneyRain,moneyCatchers}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const m=new MoneyRain(),w=100,h=80,mask=new Float32Array(w*h)
for(let y=30;y<65;y++)for(let x=30;x<70;x++)mask[y*w+x]=1
for(let frame=0;frame<400;frame++){
  m.update(1/30,mask,w,h,[])
  for(const b of m.bills)if(b.y>=0&&b.y<h)assert(mask[Math.floor(b.y)*w+Math.floor(b.x)]===0,'Bills cannot penetrate person mask')
}
assert(m.bills.length>0)
mask.fill(0)
for(let frame=0;frame<300;frame++)m.update(1/30,mask,w,h,[])
assert(m.collected>0&&m.pile.some(v=>v>0),'Bills accumulate at screen floor')
m.reset();m.bills.push({x:50,y:8,vx:0,vy:20,angle:0,catcher:-1,offset:0,level:0})
const catchers=[{x:.5,y:.45,width:.2}]
for(let f=0;f<60;f++)m.update(1/30,mask,w,h,catchers)
assert.equal(m.bills[0].catcher,0,'Hand platform catches bill')
catchers[0].x=.6;m.update(1/30,mask,w,h,catchers);assert.equal(m.bills[0].x,60,'Held money follows hand')
for(let f=0;f<100;f++)m.update(1/30,mask,w,h,[])
assert(m.collected>0,'Opening gesture releases collected money')
const palm=x=>Array.from({length:21},()=>({x,y:.5}))
assert(moneyCatchers([palm(.45),palm(.55)]).length>0,'Joined hands create a catch surface')
assert.equal(moneyCatchers([]).length,0)
console.log('PASS Money Rain: mask collision, floor accumulation, hand collection/movement/release, gesture surface.')
