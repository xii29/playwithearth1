import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://residents.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#101328;color:white}canvas{touch-action:none}.earth-conversation{position:absolute;right:0;top:0;background:#253a50;padding:10px}.earth-roster-label{position:absolute;left:0;top:0}</style><main id="root"><canvas id="canvas" width="1000" height="700"></canvas><p id="earth-status"></p><button id="earth-meeting">주민 회의</button><p id="earth-event-status"></p></main>' })
    if (path.startsWith('/three/')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve('node_modules/three/build', path.split('/').pop())) })
    const source = ts.transpileModule(await readFile(resolve('src', path.split('/').pop().replace(/\.js$/, '.ts')), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      .replace(/from 'three'/g, "from '/three/three.module.js'").replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'")
    await route.fulfill({ contentType: 'text/javascript', body: source })
  })
  await page.goto('https://residents.test/')
  await page.evaluate(async () => {
    const T = await import('/three/three.module.js'), { setupResidentLife } = await import('/earth-residents.js'), { setupSpaceEdition } = await import('/earth-space.js'), { VILLAGE_CLEARING, VILLAGE_HOLE } = await import('/earth-garden.js')
    const canvas = document.querySelector('#canvas'), scene = new T.Scene(), camera = new T.PerspectiveCamera(38, 1000 / 700, .1, 60)
    camera.position.copy(VILLAGE_CLEARING).multiplyScalar(13)
    const controls = { target: new T.Vector3(), enabled: true, minDistance: 5.2 }, residents = []
    const ground = new T.Mesh(new T.SphereGeometry(3.28, 48, 32), new T.MeshStandardMaterial({ color: '#687da5' })); scene.add(ground)
    scene.add(new T.HemisphereLight(0xffffff, 0x687899, 3))
    const garden = { ground, radiusAt: () => 3.28, walkable: n => n.distanceTo(VILLAGE_HOLE) > .1 }
    const orient = r => { r.direction.projectOnPlane(r.normal).normalize(); r.root.position.copy(r.normal).multiplyScalar(r.radius); const side = new T.Vector3().crossVectors(r.normal, r.direction).normalize(); r.root.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(side, r.normal, r.direction)) }
    const life = setupResidentLife({ root: document.querySelector('#root'), canvas, scene, camera, controls, garden, residents, orient, busy: () => false, changed: () => {} })
    await life.ready
    const renderer = new T.WebGLRenderer({ canvas, antialias: true }); renderer.setSize(1000, 700)
    let running = true
    const frame = () => { if (!running) return; life.update(.016); camera.lookAt(controls.target); renderer.render(scene, camera); requestAnimationFrame(frame) }; frame()
    const screen = point => { const p = point.clone().project(camera); return { x: (p.x + 1) * 500, y: (1 - p.y) * 350 } }
    window.fixture = { T, residents, scene, life, camera, controls, orient, garden, VILLAGE_HOLE, VILLAGE_CLEARING, screen,
      locate: () => { const r = residents[0]; r.body.geometry.computeBoundingBox(); const p = r.body.geometry.boundingBox.getCenter(new T.Vector3()); r.body.localToWorld(p); return screen(p) },
      end: () => { running = false; life.dispose(); renderer.dispose() },
      space: setupSpaceEdition(scene, document.querySelector('#root'), residents, garden),
    }
  })
  assert.equal(await page.evaluate(() => window.fixture.residents.length), 6)
  assert(await page.evaluate(()=>window.fixture.residents.every(r=>r.root.userData.gyaru)))
  const activities=await page.evaluate(async()=>{
    const {setupVillageActivities}=await import('/earth-activities.js'),f=window.fixture,a=setupVillageActivities(f.scene,f.garden,f.residents),seen=new Set()
    const houses=f.scene.getObjectByName('Village homes and hobbies').children.length
    for(let i=0;i<400;i++){a.update(.1,false,()=>false);f.residents.forEach(r=>{if(r.root.userData.activity)seen.add(r.root.userData.activity)})}
    a.dispose();return {houses,seen:[...seen],clean:!f.scene.getObjectByName('Village homes and hobbies')&&f.residents.every(r=>!r.root.userData.activity)}
  })
  assert.equal(activities.houses,3);assert.equal(activities.seen.length,3);assert(activities.clean)
  const times=await page.evaluate(async()=>{const {koreanVillageTime}=await import('/earth-time.js');return ['2026-10-01T00:00:00Z','2026-10-01T12:00:00Z'].map(t=>koreanVillageTime(new Date(t)))})
  assert.equal(times[0].hour,9);assert.equal(times[0].daylight,1);assert(times[0].label.includes('오전'))
  assert.equal(times[1].hour,21);assert.equal(times[1].daylight,0);assert(times[1].label.includes('오후'))
  const original = await page.evaluate(() => window.fixture.residents[0].normal.toArray())
  let point = await page.evaluate(() => window.fixture.locate())
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction(() => !document.querySelector('.earth-conversation').hidden)
  const speaker=await page.locator('#earth-resident-name').textContent()
  await page.evaluate(()=>{for(let i=0;i<35;i++)window.fixture.life.update(.1)})
  assert.notEqual(await page.locator('#earth-resident-name').textContent(),speaker,'One click automatically alternates speakers')
  const line=await page.locator('#earth-dialogue').textContent()
  await page.locator('.earth-conversation-controls summary').click()
  await page.locator('#earth-random-chat').click()
  assert.notEqual(await page.locator('#earth-dialogue').textContent(),line,'Button starts another random topic')
  const before = await page.evaluate(() => window.fixture.camera.position.toArray())
  await page.waitForTimeout(500)
  assert.notDeepEqual(await page.evaluate(() => window.fixture.camera.position.toArray()), before, 'Click starts a following-camera transition')
  await page.locator('#earth-unfollow').click()
  // Put the selected animal and planet front-and-centre for a real pointer drag.
  await page.evaluate(() => { const f = window.fixture; f.camera.position.copy(f.residents[0].normal).multiplyScalar(12); f.controls.target.set(0, 0, 0) })
  await page.waitForTimeout(100)
  point = await page.evaluate(() => window.fixture.locate())
  const target = await page.evaluate(() => { const f = window.fixture; return f.screen(f.residents[0].normal.clone().add(new f.T.Vector3(.13, 0, 0)).normalize().multiplyScalar(3.28)) })
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 10 }); await page.mouse.up()
  assert.notDeepEqual(await page.evaluate(() => window.fixture.residents[0].normal.toArray()), original, 'Dragging repositions a resident on the planet')
  await page.evaluate(() => { const f = window.fixture; f.camera.position.copy(f.VILLAGE_HOLE).multiplyScalar(12); f.controls.target.set(0, 0, 0); const r = f.residents[0]; r.normal.copy(f.VILLAGE_HOLE).add(new f.T.Vector3(.15, 0, 0)).normalize(); f.orient(r) })
  await page.waitForTimeout(100)
  point = await page.evaluate(() => window.fixture.locate())
  const hole = await page.evaluate(() => window.fixture.screen(window.fixture.VILLAGE_HOLE.clone().multiplyScalar(3.28)))
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(hole.x, hole.y, { steps: 10 }); await page.mouse.up()
  await page.waitForFunction(() => window.fixture.residents.length === 5)
  const stored = await page.evaluate(async () => { const { loadResidents } = await import('/earth-storage.js'); return (await loadResidents()).length })
  assert.equal(stored, 5, 'Released resident is removed from persistent storage')
  const event = await page.evaluate(() => {
    const f = window.fixture, count = f.residents.length; f.space.encounter()
    for (let i = 0; i < 90; i++) f.space.update(.1, false)
    const visitors = f.scene.getObjectByName('Space edition').children.filter(child => child.name.startsWith('Visitor') && child.visible).length
    const frightened = f.residents.some(r => f.space.frightened(r))
    const text = document.querySelector('#earth-event-status').textContent
    for (let i = 0; i < 100; i++) f.space.update(.1, false)
    return { visitors, frightened, text, count, after: f.residents.length, shipGone: !f.scene.getObjectByName('Visiting UFO').visible }
  })
  assert.equal(event.visitors, 3); assert(event.frightened); assert(event.text.includes('광선')); assert(event.shipGone); assert.equal(event.count, event.after)
  await page.evaluate(() => { window.fixture.space.dispose(); window.fixture.end() })
  assert.deepEqual(errors, [])
  console.log('PASS actual pointer selection/follow, surface drag, release pit + persisted removal; UFO approach, 3 aliens, harmless attack/flee, departure and cleanup.')
} finally { await browser.close() }
