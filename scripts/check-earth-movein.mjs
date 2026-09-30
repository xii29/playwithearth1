import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://earth.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (/\/assets\/earth-person-/.test(path)) {
      return route.fulfill({ contentType: 'text/javascript', body: `export async function capturePerson(photo, signal, stage) {
        window.captures = (window.captures || 0) + 1; stage?.('segment');
        await new Promise(resolve => setTimeout(resolve, 350)); signal?.throwIfAborted(); stage?.('pose');
        const image = document.createElement('canvas'); image.width = image.height = 256;
        const ctx = image.getContext('2d'); ctx.fillStyle = '#d9b48c'; ctx.fillRect(48, 10, 160, 236);
        return { image, landmarks: [], bounds: { x: 48, y: 10, width: 160, height: 236 }, color: '#d9b48c' };
      }` })
    }
    try {
      if (path.startsWith('/source/')) {
        const file = path.split('/').pop().replace(/\.js$/, '.ts')
        const source = ts.transpileModule(await readFile(resolve('src', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
          .replace(/from 'three'/g, "from '/three/three.module.js'").replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'")
        return route.fulfill({ contentType: 'text/javascript', body: source })
      }
      const file = path.startsWith('/three/') ? resolve('node_modules/three/build', path.split('/').pop()) : resolve('dist', `.${path === '/' ? '/index.html' : path}`)
      await route.fulfill({ body: await readFile(file), contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' })[extname(file)] || 'application/octet-stream' })
    } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  await page.addInitScript(() => {
    window.cameraStreams = []
    window.musicContexts = []
    const NativeAudio = window.AudioContext
    window.AudioContext = class extends NativeAudio { constructor(...args) { super(...args); window.musicContexts.push(this) } }
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
      const ctx = canvas.getContext('2d')
      const draw = () => { ctx.fillStyle = '#385865'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#dbb78f'; ctx.fillRect(200, 50, 240, 430) }
      draw(); const stream = canvas.captureStream(24), pump = setInterval(draw, 40)
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track)
      track.stop = () => { clearInterval(pump); stop() }
      window.cameraStreams.push(stream); return stream
    }
  })
  await page.goto('https://earth.test/#earth')
  await page.waitForFunction(() => !document.querySelector('#example-stage').hasAttribute('aria-busy'))
  await page.waitForFunction(() => !document.querySelector('#earth-join').disabled)
  const initialCount = Number(await page.locator('#earth-count').textContent())
  assert.equal(initialCount, 6, 'A fresh village starts with six animal residents')
  await page.locator('#earth-roster').selectOption({ label: '루나' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/earth-space-animal.png' })
  await page.locator('#earth-unfollow').click()
  // Real geometry code, two different silhouettes, synthetic already-segmented person.
  const geometry = await page.evaluate(async () => {
    const { analyzeMiniature, buildMiniature } = await import('/source/earth-miniature.js')
    const personImage = document.createElement('canvas'); personImage.width = personImage.height = 128
    const p = personImage.getContext('2d'); p.fillStyle = '#d2ab87'; p.fillRect(0, 0, 128, 128)
    const person = { image: personImage, landmarks: [], bounds: { x: 0, y: 0, width: 128, height: 128 }, color: '#d2ab87' }
    const results = []
    for (const ears of [false, true]) {
      const shape = document.createElement('canvas'); shape.width = shape.height = 384
      const c = shape.getContext('2d'); c.fillStyle = '#95b486'; c.beginPath(); c.ellipse(192, 210, 100, 125, 0, 0, Math.PI * 2); c.fill()
      if (ears) { c.fillRect(102, 35, 45, 100); c.fillRect(237, 35, 45, 100) }
      const bitmap = await createImageBitmap(shape), normalized = analyzeMiniature(bitmap); bitmap.close()
      const model = buildMiniature(normalized, person), geometry = model.body.geometry
      geometry.computeBoundingBox()
      results.push({ vertices: geometry.attributes.position.count, depth: geometry.boundingBox.max.z - geometry.boundingBox.min.z, bottom: geometry.boundingBox.min.y, finite: Array.from(geometry.attributes.normal.array).every(Number.isFinite) })
      geometry.dispose(); model.body.material.map.dispose(); model.body.material.dispose()
      window.testShape = shape.toDataURL('image/png')
    }
    const figure = document.createElement('canvas'); figure.width = figure.height = 384
    const brush = figure.getContext('2d'); brush.fillStyle = '#95b486'
    brush.fillRect(100, 20, 184, 145); brush.fillRect(120, 140, 144, 140)
    brush.fillRect(72, 160, 48, 110); brush.fillRect(264, 160, 48, 110)
    brush.fillRect(120, 280, 50, 85); brush.fillRect(214, 280, 50, 85)
    const bitmap = await createImageBitmap(figure), outline = analyzeMiniature(bitmap); bitmap.close()
    person.landmarks = Array.from({ length: 33 }, (_, index) => ({ x: .3 + (index % 2) * .4, y: .1 + index / 40, visibility: 1 }))
    const articulated = buildMiniature(outline, person)
    if (!articulated.actor.userData.articulated || !articulated.mapped) throw new Error('Visible legs and pose landmarks must enable anatomical texture mapping')
    articulated.body.geometry.dispose(); articulated.body.material.map.dispose(); articulated.body.material.dispose()
    return results
  })
  assert.notEqual(geometry[0].vertices, geometry[1].vertices, 'Different outlines produce different geometry')
  for (const result of geometry) { assert(result.vertices < 33282); assert(result.depth > .2); assert.equal(result.bottom, 0); assert(result.finite) }
  const png = Buffer.from((await page.evaluate(() => window.testShape)).split(',')[1], 'base64')
  await page.locator('#earth-join').click()
  await page.locator('#earth-name').fill('별손님')
  await page.waitForFunction(() => document.querySelector('#earth-camera').readyState >= 2)
  const left = await page.locator('.earth-movein-camera').boundingBox(), right = await page.locator('.earth-movein-image').boundingBox()
  assert(left.x + left.width <= right.x && Math.abs(left.width - right.width) < 2)
  const started = Date.now()
  await page.locator('#earth-upload').setInputFiles({ name: 'rabbit.png', mimeType: 'image/png', buffer: png })
  await page.waitForFunction(() => document.querySelector('#earth-countdown').textContent === '5' && !document.querySelector('#earth-countdown').hidden)
  await page.screenshot({ path: '/tmp/earth-movein-countdown.png' })
  await page.waitForFunction(() => !document.querySelector('#earth-photo').hidden)
  assert(Date.now() - started >= 4900, 'No capture before the full five seconds')
  assert(await page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))))
  await page.waitForSelector('.earth-example.is-revealing')
  assert.equal(await page.locator('#earth-dialog').evaluate(el => el.open), false)
  await page.screenshot({ path: '/tmp/earth-movein-reveal.png' })
  await page.waitForFunction(expected => document.querySelector('#earth-count').textContent === String(expected), initialCount + 1, { timeout: 30000 })
  assert.equal(await page.evaluate(() => window.captures), 1)
  await page.locator('#earth-roster').selectOption({ label: '별손님' })
  await page.waitForSelector('.earth-conversation:not([hidden])')
  await page.locator('#earth-chat input').fill('안녕')
  await page.locator('#earth-chat button').click()
  assert((await page.locator('#earth-dialogue').textContent()).includes('별손님'))
  await page.locator('#earth-rename').click(); await page.locator('#earth-new-name').fill('우주 토끼'); await page.locator('#earth-save-name').click()
  await page.locator('#earth-edit-texture').click()
  const beforeTexture = await page.locator('#earth-texture-canvas').evaluate(c => c.toDataURL())
  const textureBox = await page.locator('#earth-texture-canvas').boundingBox()
  await page.mouse.move(textureBox.x + textureBox.width * .5, textureBox.y + textureBox.height * .5)
  await page.mouse.down(); await page.mouse.move(textureBox.x + textureBox.width * .6, textureBox.y + textureBox.height * .5, { steps: 6 }); await page.mouse.up()
  assert.notEqual(await page.locator('#earth-texture-canvas').evaluate(c => c.toDataURL()), beforeTexture)
  await page.locator('#earth-brush-undo').click()
  assert.equal(await page.locator('#earth-texture-canvas').evaluate(c => c.toDataURL()), beforeTexture)
  await page.mouse.move(textureBox.x + textureBox.width * .5, textureBox.y + textureBox.height * .5)
  await page.mouse.down(); await page.mouse.move(textureBox.x + textureBox.width * .6, textureBox.y + textureBox.height * .5, { steps: 6 }); await page.mouse.up()
  const editedTexture = await page.locator('#earth-texture-canvas').evaluate(c => c.toDataURL())
  await page.locator('[aria-label="텍스처 편집 닫기"]').click(); await page.locator('#earth-unfollow').click()
  await page.locator('#earth-join').click()
  await page.waitForFunction(() => document.querySelector('#earth-camera').readyState >= 2)
  // Exercise a dropped file and cancellation; it must not create a second resident.
  await page.evaluate(async () => {
    const file = new File([await (await fetch(window.testShape)).blob()], 'drop.png', { type: 'image/png' })
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(file)
    document.querySelector('#earth-dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
  await page.waitForFunction(() => !document.querySelector('#earth-countdown').hidden)
  await page.locator('#earth-dialog [aria-label="닫기"]').click()
  await page.waitForTimeout(5200)
  assert.equal(await page.evaluate(() => window.captures), 1)
  assert(await page.evaluate(() => window.cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))))
  await page.locator('[data-example="home"]').click()
  await page.waitForSelector('.example-gallery')
  await page.evaluate(() => { location.hash = 'earth' })
  await page.waitForFunction(expected => document.querySelector('#earth-count')?.textContent === String(expected), initialCount + 1)
  assert.equal(await page.locator('#earth-roster option').filter({ hasText: '우주 토끼' }).count(), 1)
  await page.reload()
  await page.waitForFunction(expected => document.querySelector('#earth-count')?.textContent === String(expected), initialCount + 1)
  await page.locator('#earth-roster').selectOption({ label: '우주 토끼' }); await page.locator('#earth-edit-texture').click()
  assert.equal(await page.locator('#earth-texture-canvas').evaluate(c => c.toDataURL()), editedTexture, 'Edited texture survives a full reload')
  await page.locator('#earth-brush-reset').click()
  assert.equal(await page.locator('#earth-texture-canvas').evaluate(c => c.toDataURL()), beforeTexture, 'Original texture survives a full reload')
  await page.locator('[aria-label="텍스처 편집 닫기"]').click(); await page.locator('#earth-unfollow').click()
  await page.locator('#earth-meeting').click()
  await page.waitForFunction(() => document.querySelector('#earth-status').textContent.includes('모두 모였어요'), null, { timeout: 30000 })
  await page.screenshot({ path: '/tmp/earth-space-meeting.png' })
  await page.locator('#earth-meeting').click()
  await page.locator('#earth-music').click(); assert.equal(await page.locator('#earth-music').getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => window.musicContexts.some(context => context.state === 'running'))
  await page.locator('#earth-music').click(); assert.equal(await page.locator('#earth-music').getAttribute('aria-pressed'), 'false')
  await page.waitForFunction(() => window.musicContexts.every(context => context.state === 'suspended'))
  await page.locator('[data-example="home"]').click(); await page.waitForSelector('.example-gallery')
  await page.waitForFunction(() => window.musicContexts.every(context => context.state === 'closed'))
  assert.deepEqual(errors, [])
  console.log('PASS Earth: six default animals, named arrival, five-second capture, stopped camera, chat/rename, brush+undo, navigation/reload persistence including original+edited textures, meeting and music controls. HumanSeg/Pose mocked; real-person quality not tested.', geometry)
} finally { await browser.close() }
