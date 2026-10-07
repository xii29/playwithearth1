import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const base=process.env.PAGES_BASE_PATH || '/'
const html=await readFile('dist/index.html','utf8')
for(const [,path] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  assert(path.startsWith(base),`Wrong deployment path: ${path}`)
  assert((await stat(join('dist',path.slice(base.length)))).isFile(),`Missing ${path}`)
}
for(const path of ['logo.webp','lemons/lemon.png','fire.jpeg',
  ...[1,2,3,4].map(n=>`balloon/${n}.png`),
  ...['a','s','d','z','x','c'].map(n=>`sounds/${n}.mp3`),
  ...['face_landmarker.task','hand_landmarker.task','pose_landmarker_lite.task','selfie_multiclass.tflite'].map(n=>`mediapipe/models/${n}`),
  ...['vision_wasm_internal','vision_wasm_nosimd_internal','vision_wasm_module_internal'].flatMap(n=>[`mediapipe/wasm/${n}.js`,`mediapipe/wasm/${n}.wasm`])]){
  assert((await stat(join('dist',path))).size>0,`Missing public asset: ${path}`)
}
async function audit(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    assert(!/^(?:\.cert|node_modules)$|\.(?:pem|key)$/i.test(entry.name),`Private/dev file in deployment: ${entry.name}`)
    if(entry.isDirectory())await audit(join(dir,entry.name))
  }
}
await audit('dist')
console.log(`PASS Pages build paths (${base}), public models/assets and certificate exclusion`)
