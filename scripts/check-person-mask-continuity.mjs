import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const code=ts.transpileModule(await readFile('src/person-mask-continuity.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {PersonMaskContinuity}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const m=new PersonMaskContinuity()
assert(m.accept(false,0));assert(m.accept(true,100));assert.equal(m.accept(false,200),false);assert.equal(m.accept(false,450),false)
assert(m.accept(true,475));assert.equal(m.accept(false,500),false);assert(m.accept(false,800))
m.reset();assert(m.accept(false,900))
console.log('PASS brief dropout hold, recovery, bounded departure and reset')
