import { createClient } from '@supabase/supabase-js'
import './guestbook.css'

type Entry = { id: string; name: string; message: string; created_at: string }
const fields = 'id,name,message,created_at'
const pageSize = 50

export function setupGuestbook(root: HTMLElement) {
  root.innerHTML = `
    <header class="guestbook-header"><a href="#home">← 뒤로가기</a><span>GUESTBOOK</span></header>
    <div class="guestbook-content">
      <section class="guestbook-intro"><p>작은 메모, 오래 남는 마음</p><h1>다녀간 흔적을<br>남겨 주세요.</h1><p>하고 싶은 말을 한 장의 포스트잇에 담아 주세요.</p></section>
      <div class="guestbook-layout">
        <form class="guestbook-form" aria-label="방명록 작성">
          <span class="guestbook-eyebrow">LEAVE A NOTE</span>
          <label for="guestbook-name">이름</label><input id="guestbook-name" name="name" maxlength="30" required autocomplete="nickname" placeholder="어떤 이름으로 남길까요?">
          <label for="guestbook-message">하고 싶은 말</label><textarea id="guestbook-message" name="message" maxlength="500" required rows="7" placeholder="오늘의 감상, 인사, 어떤 이야기든 좋아요."></textarea>
          <div class="guestbook-form-meta"><small>누구나 볼 수 있는 공개 방명록이에요.</small><span id="guestbook-length">0 / 500</span></div>
          <button type="submit">작성하기</button><p class="guestbook-status" id="guestbook-submit-status" role="status"></p>
        </form>
        <section class="guestbook-board" aria-labelledby="guestbook-board-title">
          <div class="guestbook-board-heading"><h2 id="guestbook-board-title">남겨진 마음들</h2><span id="guestbook-live" role="status">연결 중</span></div>
          <p class="guestbook-status" id="guestbook-load-status" role="status">방명록을 불러오는 중이에요.</p>
          <button class="guestbook-retry" type="button" hidden>다시 불러오기</button>
          <div class="guestbook-notes" role="list" aria-label="방명록 목록"></div>
          <button class="guestbook-more" type="button" hidden>이전 방명록 더 보기</button>
        </section>
      </div>
    </div>`
  const form = root.querySelector<HTMLFormElement>('form')!
  const name = root.querySelector<HTMLInputElement>('#guestbook-name')!
  const message = root.querySelector<HTMLTextAreaElement>('textarea')!
  const submit = form.querySelector<HTMLButtonElement>('button')!
  const submitStatus = root.querySelector<HTMLElement>('#guestbook-submit-status')!
  const loadStatus = root.querySelector<HTMLElement>('#guestbook-load-status')!
  const live = root.querySelector<HTMLElement>('#guestbook-live')!
  const notes = root.querySelector<HTMLElement>('.guestbook-notes')!
  const retry = root.querySelector<HTMLButtonElement>('.guestbook-retry')!
  const more = root.querySelector<HTMLButtonElement>('.guestbook-more')!
  const length = root.querySelector<HTMLElement>('#guestbook-length')!
  const events = new AbortController()
  const { signal } = events
  message.addEventListener('input', () => { length.textContent = `${message.value.length} / 500` }, { signal })

  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  // Only browser-safe publishable / legacy anon keys are accepted.
  let publicKey = key?.startsWith('sb_publishable_') ?? false
  if (key?.startsWith('eyJ')) {
    try { publicKey = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon' } catch { /* invalid key */ }
  }
  let validUrl = false
  try { validUrl = new URL(url).protocol === 'https:' } catch { /* missing configuration */ }
  if (!validUrl || !publicKey) {
    submit.disabled = true
    live.textContent = '준비 중'
    loadStatus.textContent = '방명록 연결을 준비하고 있어요. 잠시 후 다시 방문해 주세요.'
    submitStatus.textContent = '연결 설정이 완료되면 작성할 수 있어요.'
    return () => events.abort()
  }
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const entries = new Map<string, Entry>()
  const cards = new Map<string, HTMLElement>()
  let disposed = false, saving = false, loading = false
  let cursor: Entry | undefined
  const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
  const sorted = () => [...entries.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))

  function add(entry: Entry, animate = false) {
    if (disposed || entries.has(entry.id)) return
    entries.set(entry.id, entry)
    const card = document.createElement('article')
    card.className = `guestbook-note${animate ? ' is-new' : ''}`
    card.setAttribute('role', 'listitem')
    const seed = [...entry.id].reduce((sum, c) => sum + c.charCodeAt(0), 0)
    card.dataset.color = String(seed % 5)
    card.style.setProperty('--note-rotation', `${(seed % 7 - 3) * 0.6}deg`)
    const body = document.createElement('p'), footer = document.createElement('footer')
    const author = document.createElement('strong'), time = document.createElement('time')
    // Visitor content is always text, never executable HTML.
    body.textContent = entry.message
    author.textContent = entry.name
    time.dateTime = entry.created_at
    time.textContent = dateFormat.format(new Date(entry.created_at))
    footer.append(author, time); card.append(body, footer)
    cards.set(entry.id, card)
    const order = sorted(), position = order.findIndex(item => item.id === entry.id)
    notes.insertBefore(card, cards.get(order[position + 1]?.id) ?? null)
    if (loadStatus.dataset.empty) { loadStatus.textContent = ''; delete loadStatus.dataset.empty }
  }

  async function load(older = false) {
    if (disposed || loading) return
    loading = true; retry.hidden = true; more.disabled = true
    try {
      let query = client.from('guestbook_entries').select(fields).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize)
      if (older && cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
      const { data, error } = await query.abortSignal(signal)
      if (disposed) return
      if (error) throw error
      for (const entry of data as Entry[]) add(entry)
      if (older || !cursor) {
        cursor = data.at(-1) as Entry | undefined
        more.hidden = data.length < pageSize
      }
      loadStatus.textContent = entries.size ? '' : '아직 남겨진 메모가 없어요. 첫 번째 포스트잇을 붙여 주세요!'
      if (!entries.size) loadStatus.dataset.empty = 'true'
      else delete loadStatus.dataset.empty
    } catch {
      if (!disposed) {
        delete loadStatus.dataset.empty
        loadStatus.textContent = '방명록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'
        retry.hidden = false
        retry.dataset.older = String(older)
      }
    } finally { loading = false; more.disabled = false }
  }
  retry.addEventListener('click', () => { void load(retry.dataset.older === 'true') }, { signal })
  more.addEventListener('click', () => { void load(true) }, { signal })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (saving) return
    const values = { name: name.value.trim(), message: message.value.trim() }
    if (!values.name || !values.message) {
      submitStatus.textContent = '이름과 하고 싶은 말을 모두 입력해 주세요.'
      ;(!values.name ? name : message).focus()
      return
    }
    saving = true; submit.disabled = true; name.readOnly = true; message.readOnly = true
    submit.textContent = '붙이는 중…'; submitStatus.textContent = ''
    try {
      // Do not abort a write on navigation: the server may already have committed it.
      const { data, error } = await client.from('guestbook_entries').insert(values).select(fields).single()
      if (disposed) return
      if (error) throw error
      add(data as Entry, true)
      message.value = ''; length.textContent = '0 / 500'
      submitStatus.textContent = '포스트잇을 붙였어요!'
      message.focus({ preventScroll: true })
      cards.get(data.id)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    } catch {
      if (!disposed) submitStatus.textContent = '저장 결과를 확인하지 못했어요. 입력 내용은 남겨 두었어요. 목록을 확인한 뒤 다시 시도해 주세요.'
    } finally {
      saving = false
      if (!disposed) { submit.disabled = false; name.readOnly = false; message.readOnly = false; submit.textContent = '작성하기' }
    }
  }, { signal })

  const channel = client.channel('guestbook')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guestbook_entries' }, payload => { add(payload.new as Entry, true) })
    .subscribe(status => {
      if (disposed) return
      if (status === 'SUBSCRIBED') { live.textContent = '● 실시간 연결'; void load() }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') live.textContent = '연결 재시도 중 · 주기적으로 새로고침'
    })
  void load()
  // Recover missed events and support networks where WebSockets are unavailable.
  const refresh = () => { if (!document.hidden) void load() }
  const interval = window.setInterval(refresh, 30_000)
  document.addEventListener('visibilitychange', refresh, { signal })
  window.addEventListener('online', refresh, { signal })
  return () => {
    disposed = true; events.abort(); window.clearInterval(interval)
    void client.removeChannel(channel)
  }
}
