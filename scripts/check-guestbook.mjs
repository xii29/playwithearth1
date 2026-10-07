// Build with VITE_SUPABASE_URL=https://guestbook.supabase.co
// VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test before running.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.PAGES_BASE_PATH || '/'
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [], rows = Array.from({ length: 51 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `방문자 ${i}`, message: i === 0 ? '<img src=x onerror=alert(1)> 안녕하세요' : `메모 ${i}`, created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, 51 - i)).toISOString() }))
  let failRead = true, failWrite = false, writes = 0, socket, topic, joinRef
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://gallery.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    try {
      const file = resolve('dist', pathname === base ? 'index.html' : pathname.slice(base.length))
      await route.fulfill({ body: await readFile(file), contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream' })
    } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  await page.route('https://guestbook.supabase.co/rest/v1/**', async route => {
    if (route.request().method() === 'POST') {
      writes++
      await new Promise(resolve => setTimeout(resolve, 100))
      if (failWrite) return route.fulfill({ status: 403, json: { message: 'denied' } })
      const row = { ...route.request().postDataJSON(), id: '00000000-0000-4000-8000-999999999999', created_at: '2026-10-07T10:00:00.000Z' }
      rows.unshift(row)
      emit(row)
      return route.fulfill({ status: 201, json: row })
    }
    if (failRead) return route.fulfill({ status: 503, json: { message: 'unavailable' } })
    const older = new URL(route.request().url()).searchParams.has('or')
    await route.fulfill({ json: older ? rows.slice(50) : rows.slice(0, 50) })
  })
  function emit(row) {
    socket?.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', { ids: [1], data: { schema: 'public', table: 'guestbook_entries', commit_timestamp: row.created_at, type: 'INSERT', columns: [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'text' }, { name: 'message', type: 'text' }, { name: 'created_at', type: 'timestamptz' }], errors: null, record: row, old_record: {} } }]))
  }
  await page.routeWebSocket('wss://guestbook.supabase.co/**', ws => {
    socket = ws
    ws.onMessage(raw => {
      const [jr, ref, incomingTopic, event] = JSON.parse(String(raw))
      if (event === 'phx_join') {
        joinRef = jr; topic = incomingTopic
        ws.send(JSON.stringify([jr, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: [{ id: 1, event: 'INSERT', schema: 'public', table: 'guestbook_entries' }] } }]))
      } else if (event === 'heartbeat') ws.send(JSON.stringify([jr, ref, incomingTopic, 'phx_reply', { status: 'ok', response: {} }]))
    })
  })
  await page.goto('https://gallery.test' + base)
  await page.locator('.gallery-guestbook').click()
  if (process.env.GUESTBOOK_UNCONFIGURED === '1') {
    await page.waitForFunction(() => document.querySelector('#guestbook-load-status')?.textContent.includes('연결을 준비'))
    assert(await page.locator('button[type=submit]').isDisabled())
    await page.locator('.guestbook-header a').click()
    await page.locator('.clock-gallery').waitFor({ state: 'visible' })
    assert.deepEqual(errors, [])
    console.log('PASS guestbook: missing configuration disables writing and preserves home navigation')
  } else {
  await page.locator('.guestbook-retry').waitFor({ state: 'visible' })
  failRead = false
  await page.locator('.guestbook-retry').click()
  await page.waitForFunction(() => document.querySelectorAll('.guestbook-note').length === 50)
  assert.equal(await page.locator('.guestbook-note img').count(), 0, 'User HTML is inert')
  await page.locator('.guestbook-more').click()
  await page.waitForFunction(() => document.querySelectorAll('.guestbook-note').length === 51)
  await page.locator('#guestbook-name').fill('   ')
  await page.locator('#guestbook-message').fill('인사')
  await page.locator('button[type=submit]').click()
  assert.equal(writes, 0, 'Whitespace name rejected')
  await page.locator('#guestbook-name').fill('테스트')
  failWrite = true
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => document.querySelector('#guestbook-submit-status').textContent.includes('저장 결과'))
  assert.equal(await page.locator('#guestbook-message').inputValue(), '인사')
  assert.equal(await page.locator('.guestbook-note').count(), 51)
  failWrite = false
  await page.locator('button[type=submit]').click()
  await page.waitForFunction(() => document.querySelector('#guestbook-submit-status').textContent.includes('붙였어요'))
  assert.equal(await page.locator('.guestbook-note').count(), 52, 'INSERT event + save response deduplicated')
  assert.equal(await page.locator('.guestbook-note').first().locator('strong').textContent(), '테스트')
  assert.equal(await page.locator('#guestbook-message').inputValue(), '')
  const remote = { id: '00000000-0000-4000-8000-888888888888', name: '다른 방문자', message: '실시간 인사', created_at: '2026-10-07T11:00:00.000Z' }
  rows.unshift(remote); emit(remote)
  await page.waitForFunction(() => document.querySelectorAll('.guestbook-note').length === 53)
  await page.locator('.guestbook-page').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: '/tmp/int-guestbook-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.locator('.guestbook-page').evaluate(el => el.scrollWidth <= el.clientWidth), 'Mobile does not overflow horizontally')
  await page.locator('.guestbook-page').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: '/tmp/int-guestbook-mobile.png', fullPage: true })
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('.guestbook-note').length === 50)
  assert.equal(await page.locator('.guestbook-note').first().locator('strong').textContent(), '다른 방문자')
  await page.locator('.guestbook-header a').click()
  await page.locator('.clock-gallery').waitFor({ state: 'visible' })
  assert.deepEqual(errors, [])
  console.log('PASS guestbook: navigation, read retry, pagination, validation, failed save retention, save + realtime deduplication, remote insert, reload, mobile layout, return home')
  }
} finally { await browser.close() }
