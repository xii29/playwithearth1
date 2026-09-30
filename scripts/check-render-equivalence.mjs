import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'

const baseline = process.argv[2]
if (!baseline) throw new Error('Usage: node scripts/check-render-equivalence.mjs <directory-with-original-ts-files>')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { headless: true })
const main = await readFile('src/main.ts', 'utf8')
const css = await readFile('src/style.css', 'utf8')
const cases = { space: ['space-particles', 'setupSpaceParticles'], aquarium: ['aquarium', 'setupAquarium'], claw: ['claw-machine', 'setupClawMachine'] }
try {
  for (const [name, [file, setup]] of Object.entries(cases)) {
    if (process.env.RENDER_CASE && process.env.RENDER_CASE !== name) continue
    const results = []
    for (const directory of [baseline, process.env.COMPARE_DIR || 'src']) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
      const errors = []; page.on('pageerror', (e) => errors.push(e.message))
      const raw = (await readFile(`${directory}/${file}.ts`, 'utf8')).replaceAll('import.meta.env.BASE_URL', "'/'").replace("'@mediapipe/tasks-vision'", "'/vision.js'").replace("'three'", "'/three.js'")
      const source = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
      const template = main.match(new RegExp(`  ${name}: \\(\\) => \x60([\\s\\S]*?)\x60,`))[1]
      await page.route('https://render.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/example.js') return route.fulfill({ contentType: 'text/javascript', body: source })
        if (path === '/space-particles-engine') return route.fulfill({ contentType: 'text/javascript', body: ts.transpileModule(await readFile('src/space-particles-engine.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText })
        if (path === '/vision.js') return route.fulfill({ contentType: 'text/javascript', body: 'export class FaceLandmarker{};export class HandLandmarker{};export class FilesetResolver{}' })
        if (path === '/three.js' || path === '/three.core.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile(`node_modules/three/build/${path === '/three.js' ? 'three.module.js' : 'three.core.js'}`) })
        return route.fulfill({ contentType: 'text/html', body: `<style>${css} *,*::before,*::after {animation:none!important;transition:none!important} html,body,#app,.example-stage {width:100%;height:100%;margin:0}</style><div id="app"><div class="example-stage">${template}</div></div>` })
      })
      await page.goto('https://render.test/')
      await page.evaluate(async ({ name, setup }) => {
        let seed = 12345, id = 0
        Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
        performance.now = () => 0
        window.framesPending = new Map()
        requestAnimationFrame = (fn) => { window.framesPending.set(++id, fn); return id }
        cancelAnimationFrame = (key) => window.framesPending.delete(key)
        window.ResizeObserver = class { observe() {} disconnect() {} }
        // Compare the shared renderer deterministically; worker transport is
        // exercised separately against the actual development server.
        window.Worker = undefined
        window.operations = { gradients: 0, matrices: 0 }
        for (const name of ['createLinearGradient', 'createRadialGradient']) {
          const original = CanvasRenderingContext2D.prototype[name]
          CanvasRenderingContext2D.prototype[name] = function (...args) { window.operations.gradients++; return original.apply(this, args) }
        }
        if (name === 'claw') {
          const THREE = await import('/three.js')
          const original = THREE.Object3D.prototype.updateMatrix
          THREE.Object3D.prototype.updateMatrix = function () { window.operations.matrices++; return original.call(this) }
        }
        const module = await import('/example.js')
        const query = (selector) => document.querySelector(selector)
        const args = name === 'space' ? [query('canvas')] : name === 'aquarium' ? [query('.aquarium-example')] : ['#claw-machine','#claw-status','#prize-count','.claw-controls','#claw-drop','#prize-reveal','#prize-list-button','#prize-panel','#prize-list','#prize-panel-close','#prize-viewer-label'].map(query)
        window.cleanup = module[setup](...args)
        window.operations.gradients = window.operations.matrices = 0
      }, { name, setup })
      const result = await page.evaluate(async (name) => {
        const samples = []
        for (let i = 1; i <= 12; i++) {
          if (name === 'claw' && i === 3) document.querySelector('#claw-drop').click()
          if (name === 'space' && i === 3) document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 280, pointerId: 1 }))
          if (name === 'space' && i === 6) document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { clientX: 350, clientY: 300, pointerId: 1 }))
          const queue = [...window.framesPending.values()]; window.framesPending.clear()
          queue.forEach((fn) => fn(i * 1000 / 60))
          if ([1, 2, 5, 9, 12].includes(i)) samples.push(document.querySelector('canvas').toDataURL())
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        const operations = { ...window.operations }; window.cleanup()
        return { samples, operations }
      }, name)
      // Synthetic pointer events have no actual capture target in the browser.
      assert(errors.every((message) => message.includes('setPointerCapture')))
      results.push(result)
      await page.close()
    }
    const equal = results[1].samples.map((sample, i) => sample === results[0].samples[i])
    let roundingOnly = false
    if (name === 'claw' && !equal.every(Boolean)) {
      // Independent WebGL runs of the unchanged baseline also differ by a
      // handful of one-level color rounding errors. Compare decoded pixels.
      const page = await browser.newPage()
      const differences = await page.evaluate(async (results) => {
        const decode = async (src) => {
          const image = new Image(); image.src = src; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, canvas.width, canvas.height).data
        }
        const differences = []
        for (let i = 0; i < results[0].samples.length; i++) {
          const [a, b] = await Promise.all(results.map((result) => decode(result.samples[i])))
          let changed = 0, maxError = 0
          for (let p = 0; p < a.length; p++) { const error = Math.abs(a[p] - b[p]); if (error) changed++; maxError = Math.max(maxError, error) }
          differences.push({ changed, maxError, channels: a.length })
        }
        return differences
      }, results)
      await page.close()
      roundingOnly = differences.every(({ changed, maxError, channels }) => maxError <= 1 && changed < channels * .001)
      console.log(`WebGL differences: ${JSON.stringify(differences)}`)
    }
    if (!equal.every(Boolean)) {
      for (let i = 0; i < 2; i++) await writeFile(`/tmp/${name}-equivalence-${i}.png`, Buffer.from(results[i].samples[equal.indexOf(false)].split(',')[1], 'base64'))
    }
    console.log(`Comparison ${name}: matching frames ${equal.join(',')}; operations ${JSON.stringify(results[0].operations)} → ${JSON.stringify(results[1].operations)}`)
    assert(equal.every(Boolean) || roundingOnly, `${name}: matching frames ${equal.join(',')}`)
    console.log(`PASS ${name}: ${roundingOnly ? 'within unchanged-baseline WebGL rounding tolerance' : '5 frames pixel-identical'}; operations ${JSON.stringify(results[0].operations)} → ${JSON.stringify(results[1].operations)}`)
  }
} finally { await browser.close() }
