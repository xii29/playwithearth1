import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage()
  const source = ts.transpileModule(await readFile('src/guestbook-storage.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  await page.route('https://storage.test/**', route => route.fulfill({ body: route.request().url().endsWith('.js') ? source : '<!doctype html>', contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html' }))
  await page.goto('https://storage.test/')
  const result = await page.evaluate(async () => {
    const { guestbookStorage } = await import('/storage.js')
    const row = { id: '1', name: '방문자', message: '계속 남는 기록', created_at: '2026-10-19T00:00:00Z', photo: 'data:image/jpeg;base64,YQ==' }
    const first = guestbookStorage('project-a')
    const written = await first.write([row]); first.close()
    const reopened = guestbookStorage('project-a'), other = guestbookStorage('project-b')
    const restored = await reopened.read(), isolated = await other.read()
    const sibling = guestbookStorage('project-a')
    await Promise.all([reopened.append({ ...row, id: '2' }), sibling.append({ ...row, id: '3' })])
    const concurrent = await reopened.read()
    sibling.close(); reopened.close(); other.close()
    const nativeOpen = indexedDB.open
    indexedDB.open = () => { throw new DOMException('Blocked', 'SecurityError') }
    const blocked = guestbookStorage('project-a')
    const unavailable = await blocked.read(), failedWrite = await blocked.write([row]), failedAppend = await blocked.append(row); blocked.close()
    indexedDB.open = nativeOpen
    return { written, restored, isolated, unavailable, failedWrite, failedAppend, concurrent }
  })
  assert.equal(result.written, true)
  assert.equal(result.restored[0].message, '계속 남는 기록')
  assert.equal(result.restored[0].photo, 'data:image/jpeg;base64,YQ==')
  assert.deepEqual(result.isolated, [])
  assert.deepEqual(result.unavailable, [])
  assert.equal(result.failedWrite, false)
  assert.equal(result.failedAppend, false)
  assert.deepEqual(result.concurrent.map(row => row.id).sort(), ['1','2','3'], 'Concurrent local additions preserve existing records')
  console.log('PASS durable photo/comment storage, reopen, project isolation, unavailable browser storage')
} finally { await browser.close() }
