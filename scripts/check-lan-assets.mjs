import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { assetMiddleware } from './lan-assets.mjs'

let serve = assetMiddleware(new URL('../public/', import.meta.url).pathname)
async function request(url, headers = {}, method = 'GET') {
  const result = { headers: {}, body: undefined, statusCode: 200, next: false }
  const response = {
    setHeader(key, value) { result.headers[key] = value },
    set statusCode(value) { result.statusCode = value },
    end(body) { result.body = body },
  }
  await serve({ url, headers, method }, response, () => { result.next = true })
  return result
}
const path = '/mediapipe/wasm/vision_wasm_internal.wasm'
const original = await readFile(new URL(`../public${path}`, import.meta.url))
const zipped = await request(path, { 'accept-encoding': 'gzip, deflate, br' })
assert.equal(zipped.next, false)
assert.equal(zipped.headers['Content-Type'], 'application/wasm')
assert.equal(zipped.headers['Content-Encoding'], 'gzip')
assert.deepEqual(gunzipSync(zipped.body), original)
assert(zipped.body.length < original.length)
const cached = await request(path, { 'accept-encoding': 'gzip', 'if-none-match': zipped.headers.ETag })
assert.equal(cached.statusCode, 304)
assert.equal(cached.body, undefined)
const head = await request(path, { 'accept-encoding': 'gzip' }, 'HEAD')
assert.equal(head.body, undefined)
assert.equal(head.headers['Content-Length'], zipped.body.length)
assert.equal((await request(path, { 'accept-encoding': 'gzip;q=0' })).next, true)
assert.equal((await request(path, { range: 'bytes=0-10' })).next, true)
assert.equal((await request('/mediapipe/../../.cert/dev-key.pem')).next, true)
assert.equal((await request('/assets/app.js')).next, true)
serve = assetMiddleware(new URL('../dist/', import.meta.url).pathname, true)
const asset = (await readdir(new URL('../dist/assets/', import.meta.url))).find((name) => /^index-.*\.js$/.test(name))
const built = await request(`/assets/${asset}`, { 'accept-encoding': 'gzip' })
assert.equal(built.headers['Cache-Control'], 'public, max-age=31536000, immutable')
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
assert(html.slice(0, 1024).includes('charset="UTF-8"'), 'Keep charset before the preload script')
console.log(`PASS: lossless WASM gzip ${original.length} → ${zipped.body.length} bytes; ETag/304, HEAD, identity, range and path restrictions.`)
