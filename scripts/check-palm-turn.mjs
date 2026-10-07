import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const code=ts.transpileModule(await readFile('src/palm-turn.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {PalmTurn}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const hand=(front)=>{const p=Array.from({length:21},()=>({x:.5,y:.8,z:0}));p[5]={x:front?.4:.6,y:.5,z:0};p[17]={x:front?.6:.4,y:.5,z:0};return p}
const g=new PalmTurn()
for(let t=0;t<600;t+=100)assert.equal(g.update([hand(true)],['Right'],t),false,'Showing a new front-facing hand is not a turn')
for(let t=600;t<1000;t+=100)assert.equal(g.update([hand(false)],['Right'],t),false)
let changed=0;for(let t=1000;t<1500;t+=100)changed+=g.update([hand(true)],['Right'],t)?1:0
assert.equal(changed,1,'One stable back-to-front rotation changes once')
for(let t=1500;t<2000;t+=100)assert.equal(g.update([hand(true)],['Right'],t),false)
g.update([hand(false)],['Right'],2000);g.update([hand(false)],['Right'],2250)
assert.equal(g.update([hand(false)],['Left'],2350),false,'Replacing the hand never inherits its armed gesture')
assert.equal(g.update([],2400),false)
console.log('PASS front-facing entry, hand replacement and sustained palm do not switch; deliberate turn switches once')
