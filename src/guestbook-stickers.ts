type Sticker = { icon: string; x: number; y: number; button: HTMLButtonElement }
export function setupGuestbookStickers(root: HTMLElement, signal: AbortSignal) {
  const photo = root.querySelector<HTMLImageElement>('.booth-photo')!
  const area = root.querySelector<HTMLElement>('.booth-photo-area')!
  const layer = root.querySelector<HTMLElement>('.booth-sticker-layer')!
  const tray = root.querySelector<HTMLElement>('.booth-stickers')!
  const hint = tray.querySelector<HTMLElement>('[role=status]')!
  let stickers: Sticker[] = [], locked = false
  const position = (s: Sticker) => { s.button.style.left = `${s.x * 100}%`; s.button.style.top = `${s.y * 100}%` }
  const remove = (s: Sticker) => { s.button.remove(); stickers = stickers.filter(item => item !== s) }
  tray.querySelectorAll<HTMLButtonElement>('[data-sticker]').forEach(button => button.addEventListener('click', () => {
    if (locked || photo.hidden) return
    if (stickers.length >= 12) { hint.textContent = '스티커는 최대 12개까지 붙일 수 있어요.'; return }
    const element = document.createElement('button'); element.type = 'button'; element.className = 'photo-sticker'
    element.textContent = button.dataset.sticker!; element.setAttribute('aria-label', `${button.getAttribute('aria-label')} · 방향키로 이동, Delete로 삭제`)
    const index = stickers.length
    const s: Sticker = { icon: element.textContent, x: [.17, .8, .23, .75][index % 4], y: [.2, .22, .78, .76][index % 4], button: element }
    stickers.push(s); layer.append(element); position(s)
    let dragging = false, moved = false, startX = 0, startY = 0, originX = 0, originY = 0
    element.addEventListener('pointerdown', e => {
      if (locked) return
      e.preventDefault(); element.focus({ preventScroll: true }); dragging = true; moved = false
      startX = e.clientX; startY = e.clientY; originX = s.x; originY = s.y; element.setPointerCapture(e.pointerId)
    }, { signal })
    element.addEventListener('pointermove', e => {
      if (!dragging || locked) return
      const dx = e.clientX - startX, dy = e.clientY - startY
      moved ||= Math.hypot(dx, dy) > 4
      // The printed sheet tilts -2 degrees; convert screen motion into photo axes.
      const a = 2 * Math.PI / 180, size = Math.max(1, area.clientWidth)
      s.x = Math.max(.09, Math.min(.91, originX + (dx * Math.cos(a) - dy * Math.sin(a)) / size))
      s.y = Math.max(.09, Math.min(.91, originY + (dx * Math.sin(a) + dy * Math.cos(a)) / size)); position(s)
    }, { signal })
    element.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; if (!moved && !locked) remove(s) }, { signal })
    element.addEventListener('pointercancel', () => { dragging = false }, { signal })
    element.addEventListener('keydown', e => {
      if (locked) return
      if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); remove(s); return }
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return
      e.preventDefault()
      s.x = Math.max(.09, Math.min(.91, s.x + (e.key === 'ArrowLeft' ? -.03 : e.key === 'ArrowRight' ? .03 : 0)))
      s.y = Math.max(.09, Math.min(.91, s.y + (e.key === 'ArrowUp' ? -.03 : e.key === 'ArrowDown' ? .03 : 0))); position(s)
    }, { signal })
    hint.textContent = '끌어서 이동 · 누르면 삭제'
  }, { signal }))
  const clear = () => { stickers = []; layer.replaceChildren(); hint.textContent = '선택해서 붙이고, 끌어서 옮겨 보세요.' }
  tray.querySelector('.stickers-clear')!.addEventListener('click', () => { if (!locked) clear() }, { signal })
  return {
    clear,
    setLocked(value: boolean) { locked = value; tray.querySelectorAll('button').forEach(button => { button.disabled = value }); stickers.forEach(s => { s.button.disabled = value }) },
    compose(original: string | null) {
      if (!original || !stickers.length) return original
      if (!photo.complete || !photo.naturalWidth) throw new Error('PHOTO_NOT_READY')
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(photo, 0, 0, 640, 640)
      ctx.font = '76.8px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      for (const s of stickers) ctx.fillText(s.icon, s.x * 640, s.y * 640)
      for (const quality of [.85, .65, .45]) {
        const result = canvas.toDataURL('image/jpeg', quality)
        if (result.length <= 350000) return result
      }
      throw new Error('PHOTO_TOO_LARGE')
    },
  }
}
