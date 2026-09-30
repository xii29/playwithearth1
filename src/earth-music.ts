// Original pentatonic music, synthesized locally; no copyrighted recordings.
export function setupVillageMusic(button: HTMLButtonElement) {
  let audio: AudioContext | null = null, master: GainNode | null = null, timer = 0, playing = false, disposed = false, note = 0, next = 0
  const events = new AbortController(), step = 60 / 78 / 2
  const melody = [0, 4, 7, 9, 7, 4, 2, -1, 4, 7, 12, 9, 7, 2, 0, -1, 2, 4, 7, 4, 0, 2, 4, -1, 9, 7, 4, 2, 4, 2, 0, -1]
  const pluck = (midi: number, time: number, duration: number, volume: number, type: OscillatorType) => {
    const oscillator = audio!.createOscillator(), gain = audio!.createGain()
    oscillator.type = type; oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    gain.gain.setValueAtTime(.0001, time); gain.gain.exponentialRampToValueAtTime(volume, time + .025); gain.gain.exponentialRampToValueAtTime(.0001, time + duration)
    oscillator.connect(gain); gain.connect(master!); oscillator.start(time); oscillator.stop(time + duration + .03)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  }
  const schedule = () => {
    if (!audio || !playing || audio.state !== 'running') return
    while (next < audio.currentTime + .2) {
      const value = melody[note % melody.length], chord = [48, 53, 55, 48][Math.floor(note / 16) % 4]
      if (value >= 0) pluck(72 + value, next, .75, .18, 'sine')
      if (note % 4 === 0) pluck(chord, next, 1.2, .17, 'triangle')
      if (note % 8 === 0) [0, 7, 12].forEach(offset => pluck(chord + 12 + offset, next, 2.2, .055, 'sine'))
      next += step; note++
    }
  }
  const stopTimer = () => { clearInterval(timer); timer = 0 }
  const resume = async () => {
    if (!audio || !playing || disposed || document.hidden) return
    try { await audio.resume(); if (!playing || disposed || document.hidden) return; next = audio.currentTime + .08; stopTimer(); schedule(); timer = window.setInterval(schedule, 100) }
    catch { playing = false; button.textContent = '♫ 음악 켜기'; button.setAttribute('aria-pressed', 'false') }
  }
  button.addEventListener('click', async () => {
    playing = !playing; button.textContent = playing ? '♫ 음악 끄기' : '♫ 음악 켜기'; button.setAttribute('aria-pressed', String(playing))
    if (playing) {
      try { if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.gain.value = .32; master.connect(audio.destination) } await resume() }
      catch { playing = false; button.textContent = '음악을 재생할 수 없어요'; button.setAttribute('aria-pressed', 'false') }
    } else { stopTimer(); void audio?.suspend() }
  }, { signal: events.signal })
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimer(); void audio?.suspend() } else void resume() }, { signal: events.signal })
  return () => { disposed = true; playing = false; stopTimer(); events.abort(); void audio?.close() }
}
