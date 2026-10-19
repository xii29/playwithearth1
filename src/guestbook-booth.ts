import { setupGuestbookStickers } from './guestbook-stickers'
// Camera capture stays local until the visitor submits the guestbook form.
export function setupGuestbookBooth(root: HTMLElement, signal: AbortSignal) {
  const stickers = setupGuestbookStickers(root, signal)
  const video = root.querySelector<HTMLVideoElement>('.booth-video')!
  const shutter = root.querySelector<HTMLButtonElement>('.booth-shutter')!
  const status = root.querySelector<HTMLElement>('.booth-status')!
  const countdown = root.querySelector<HTMLElement>('.booth-countdown')!
  const print = root.querySelector<HTMLElement>('.booth-print')!
  const photo = root.querySelector<HTMLImageElement>('.booth-photo')!
  const form = root.querySelector<HTMLFormElement>('form')!
  const retake = root.querySelector<HTMLButtonElement>('.booth-retake')!
  const skip = root.querySelector<HTMLButtonElement>('.booth-skip')!
  let stream: MediaStream | null = null
  let data: string | null = null
  let busy = false, saving = false, generation = 0
  const stop = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null }
  const pause = (ms: number) => new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = window.setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
  const showPrint = async () => {
    root.dataset.booth = 'printing'
    print.hidden = false; form.hidden = true; shutter.hidden = true; skip.hidden = true
    status.textContent = '사진이 나오는 중이에요…'
    await pause(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1800)
    if (signal.aborted) return
    root.dataset.booth = 'printed'
    print.hidden = false; form.hidden = false
    retake.hidden = false; skip.hidden = true
    shutter.hidden = true
    status.textContent = '사진 아래에 오늘의 한마디를 남겨 주세요.'
  }
  const reset = () => {
    if (saving || busy) return
    generation++; stop(); stickers.clear(); data = null; photo.removeAttribute('src'); photo.hidden = true
    print.hidden = true; form.hidden = true; retake.hidden = true; skip.hidden = true; shutter.hidden = false
    root.dataset.booth = 'idle'; shutter.textContent = '사진 촬영'; status.textContent = ''
  }
  shutter.addEventListener('click', async () => {
    if (busy || saving) return
    busy = true; shutter.disabled = true; skip.disabled = true
    const current = ++generation
    try {
      if (!stream) {
        status.textContent = '카메라를 연결하고 있어요…'
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
        if (signal.aborted || generation !== current) { acquired.getTracks().forEach(track => track.stop()); return }
        stream = acquired; video.srcObject = acquired; await video.play()
        if (signal.aborted || generation !== current) return
        root.dataset.booth = 'ready'; shutter.textContent = '촬영하기'; status.textContent = '한 장의 순간을 남겨요. 준비되면 셔터를 눌러 주세요.'
        return
      }
      root.dataset.booth = 'capturing'
      const snapshot = document.createElement('canvas'); snapshot.width = 640; snapshot.height = 640
      const ctx = snapshot.getContext('2d')!
      status.textContent = '렌즈를 바라봐 주세요.'
      for (let second = 3; second > 0; second--) {
        countdown.textContent = String(second); await pause(800)
        if (signal.aborted || generation !== current) return
      }
      if (!video.videoWidth || !stream?.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('Camera ended')
      countdown.textContent = ''
      const edge = Math.min(video.videoWidth, video.videoHeight)
      ctx.save(); ctx.translate(640, 0); ctx.scale(-1, 1)
      ctx.filter = 'saturate(0.82) contrast(0.94) sepia(0.12)'
      ctx.drawImage(video, (video.videoWidth - edge) / 2, (video.videoHeight - edge) / 2, edge, edge, 0, 0, 640, 640)
      ctx.restore()
      ctx.fillStyle = 'rgba(245, 218, 179, .06)'; ctx.fillRect(0, 0, 640, 640)
      root.classList.add('booth-flash'); await pause(160)
      if (signal.aborted || generation !== current) return
      data = snapshot.toDataURL('image/jpeg', .78)
      if (data.length > 350000) data = snapshot.toDataURL('image/jpeg', .5)
      if (data.length > 350000) throw new Error('Photo too large')
      stop(); photo.src = data; photo.hidden = false; await showPrint()
    } catch (error) {
      if (signal.aborted) return
      stop(); root.dataset.booth = 'idle'; skip.hidden = false; shutter.textContent = '카메라 다시 켜기'
      status.textContent = error instanceof DOMException && error.name === 'NotAllowedError'
        ? '카메라 권한을 허용한 뒤 다시 시도해 주세요. 사진 없이 글만 남겨도 좋아요.'
        : '카메라를 사용할 수 없어요. 연결을 확인하거나 글만 남겨 주세요.'
    } finally {
      busy = false; shutter.disabled = false; skip.disabled = false; countdown.textContent = ''; root.classList.remove('booth-flash')
    }
  }, { signal })
  skip.addEventListener('click', async () => { if (busy || saving) return; busy = true; data = null; stop(); photo.hidden = true; await showPrint(); busy = false }, { signal })
  retake.addEventListener('click', reset, { signal })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !stream) return
    generation++; stop(); root.dataset.booth = 'idle'; skip.hidden = false; shutter.textContent = '카메라 다시 켜기'
    status.textContent = '촬영이 멈췄어요. 카메라를 다시 켜 주세요.'
  }, { signal })
  signal.addEventListener('abort', () => { generation++; stop() }, { once: true })
  reset()
  return { photo: () => stickers.compose(data), setSaving: (value: boolean) => { saving = value; stickers.setLocked(value); retake.disabled = value }, reset }
}
