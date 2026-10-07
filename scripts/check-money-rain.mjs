import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const code=ts.transpileModule(await readFile('src/money-rain.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {MoneyRain,MoneyRub,moneyCatchers}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
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
const joined=moneyCatchers([palm(.45),palm(.55)],['Left','Right'])
assert.deepEqual(joined.map(c=>c.id),['Left','Right'],'Joining keeps stable hand identities')
assert(moneyCatchers([palm(.4)],['Left'])[0].points.length>=2,'Curled hand has a filled catch surface')
const tilted=Array.from({length:21},(_,i)=>({x:.3+i*.02,y:.3+i*.01}))
m.reset();mask.fill(0);m.bills.push({x:50,y:2,vx:0,vy:20,angle:0,catcher:-1,offset:0,level:0})
for(let f=0;f<90;f++)m.update(1/30,mask,w,h,moneyCatchers([tilted],['Left']))
assert.equal(m.bills[0].catcherId,'Left','Tilted joint envelope catches money')
assert.equal(m.bills[0].vy,0,'Held money never bounces')
const gold=new MoneyRain();gold.boost=1
for(let i=0;i<12;i++)gold.update(1/30,mask,w,h,[],()=>.2)
assert(gold.bills.some(b=>b.gold),'Rub shower spawns gold')
gold.boost=0;for(let i=0;i<200;i++)gold.update(1/30,mask,w,h,[])
assert(gold.goldPile.some(n=>n>0),'Gold accumulates on floor')
gold.reset();assert.equal(gold.goldPile.reduce((a,b)=>a+b,0),0)
const finger=(gap,shift=0)=>{
  const h=Array.from({length:21},()=>({x:.5+shift,y:.5}))
  h[0]={x:.5+shift,y:.7};h[9]={x:.5+shift,y:.5}
  h[4]={x:.5+shift,y:.4};h[8]={x:.5+shift+gap,y:.4}
  return h
}
const rub=new MoneyRub()
for(let i=0;i<20;i++)assert.equal(rub.update([finger(.035,i*.002)],i*50,['Left']),0,'Moving a static pinch must not boost')
rub.reset()
let boosted=0
for(let i=0;i<12;i++)boosted=Math.max(boosted,rub.update([finger(i%2?.045:.015)],i*50,['Left']))
assert.equal(boosted,1,'Repeated thumb/index rubbing boosts rain')
assert.equal(rub.update([],700,[]),0,'Losing the hand clears boost')
rub.reset()
for(let i=0;i<12;i++)boosted=rub.update([finger(i%2?.045:.015),finger(i%2?.015:.045)],i*50,['Left','Right'])
assert.equal(boosted,2,'Both hands can boost independently')
const normal=new MoneyRain(),extra=new MoneyRain();mask.fill(0);mask[70*w+50]=1;extra.boost=1
for(let i=0;i<12;i++){normal.update(1/30,mask,w,h,[],()=>.5);extra.update(1/30,mask,w,h,[],()=>.5)}
assert(extra.bills.length>normal.bills.length*2,'Rubbing visibly increases emission')
for(let i=0;i<600;i++)extra.update(1/30,mask,w,h,[],()=>.5)
assert(extra.bills.length<=320,'Boost respects the particle budget')
console.log('PASS Money Rain: mask collision, floor accumulation, hand collection/movement/release, gesture surface.')
const tower=new MoneyRain(),support=[{x:.5,y:.75,width:.3,id:'Left'}]
for(let i=0;i<12;i++)tower.bills.push({x:40+i*1.7,y:20-i*2,vx:0,vy:20,angle:0,catcher:-1,offset:0,level:0})
for(let f=0;f<150;f++)tower.update(1/30,new Float32Array(w*h),w,h,support)
assert(tower.bills.every(b=>b.catcherId==='Left'),'All bills are collected on the palm')
assert(Math.max(...tower.bills.map(b=>b.x))-Math.min(...tower.bills.map(b=>b.x))<1,'Pile grows vertically without lateral spread')
assert(new Set(tower.bills.map(b=>b.level)).size===12,'Every held bill has its own vertical level')
support[0].x=.6;tower.update(1/30,new Float32Array(w*h),w,h,support)
assert(tower.bills.every(b=>Math.abs(b.x-60)<1),'Entire tower follows its palm')
const reliableGold=new MoneyRain();reliableGold.boost=1
for(let i=0;i<3;i++)reliableGold.update(1/30,new Float32Array(w*h),w,h,[],()=>.99)
assert(reliableGold.bills.some(b=>b.gold),'Every rubbing shower guarantees gold regardless of random sample')
console.log('PASS compact vertical palm tower and guaranteed rubbing gold')
