import { FilesetResolver, ImageSegmenter, HandLandmarker } from '@mediapipe/tasks-vision'
import { BodyMeltedSpectrum } from './body-melt'
import { CrossedFingers } from './body-cross'
import { MoneyRain, moneyCatchers, type Catcher } from './money-rain'

export function setupBodyExample(root: HTMLElement, moneyMode = false) {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#body-${id}`)!
  const video = $<HTMLVideoElement>('camera'), canvas = $<HTMLCanvasElement>('canvas'), toggle = $<HTMLButtonElement>('camera-toggle'), status = $('status')
  const ctx = canvas.getContext('2d', { alpha: false })!, events = new AbortController()
  const sample = document.createElement('canvas'), sc = sample.getContext('2d', { willReadFrequently: true })!
  const money = moneyMode ? new MoneyRain() : null
  let catchers: Catcher[] = [], lastStep = 0
  const pattern = moneyMode ? null : new BodyMeltedSpectrum(), crossed = new CrossedFingers()
  let pixels:Uint8ClampedArray=new Uint8ClampedArray(0), transparency=0
  let width = 1, height = 1, dpr = 1, gw = 256, gh = 192
  let person = new Float32Array(0), hasBody = false
  let separated = false, hands: HandLandmarker | null = null, handAt = -Infinity, patternAt = -Infinity
  const split = $<HTMLButtonElement>('separate')
  const separate = () => { if(money){money.reset();return} separated = !separated }
  let model: ImageSegmenter | null = null, stream: MediaStream | null = null, disposed = false, loading = false, request = 0, frame = 0
  let renderAt = 0, inferenceAt = -Infinity, videoTime = -1, seenAt = -Infinity, failures = 0
  const lowPower = matchMedia('(pointer: coarse)').matches || navigator.hardwareConcurrency <= 4
  const clear = () => { person.fill(0); hasBody = false; crossed.reset(); transparency=0; ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height) }
  const resize = () => {
    const box = root.getBoundingClientRect(); width = Math.max(1, box.width); height = Math.max(1, box.height); dpr = Math.min(devicePixelRatio, 1.5)
    canvas.width = Math.round(width*dpr);canvas.height=Math.round(height*dpr)
    gw=lowPower?192:256;gh=Math.max(48,Math.min(384,Math.round(gw*height/width)))
    sample.width=gw;sample.height=gh
    person=new Float32Array(gw*gh);pixels=new Uint8ClampedArray(0)
    const pw=lowPower?256:384;pattern?.resize(pw,Math.max(80,Math.min(576,Math.round(pw*height/width))));clear()
  }
  const observer = new ResizeObserver(resize); observer.observe(root); resize()
  const stop = () => {
    request++; stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; model?.close(); model = null; hands?.close(); hands = null; loading = false
    clear(); money?.reset(); catchers=[]; toggle.disabled = false; toggle.textContent = '카메라 켜기'; toggle.classList.remove('is-active'); inferenceAt = seenAt = handAt = patternAt = -Infinity; videoTime = -1
  }
  const start = async () => {
    if (loading || stream || disposed) return
    if (!navigator.mediaDevices?.getUserMedia) { status.textContent = 'HTTPS 또는 localhost에서 카메라를 열어 주세요.'; return }
    const id = ++request; loading = true; toggle.disabled = true
    try {
      status.textContent = '카메라 권한을 허용해 주세요…'
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: false })
      if (disposed || id !== request) { camera.getTracks().forEach(t => t.stop()); return }
      stream = camera; video.srcObject = camera; await video.play()
      if (disposed || id !== request) return
      status.textContent = '전신 Body Mask를 준비하고 있어요…'
      const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
      if (disposed || id !== request) return
      const ready = await ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/models/selfie_multiclass.tflite` }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false })
      if (disposed || id !== request) { ready.close(); return }
      model = ready
      const handModel = await HandLandmarker.createFromOptions(vision, {baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minTrackingConfidence:.5})
      if(disposed || id !== request){handModel.close();return}
      hands=handModel; failures = 0; toggle.textContent = '카메라 중지'; toggle.classList.add('is-active')
    } catch { if (!disposed && id === request) { stop(); status.textContent = '카메라 또는 모델을 열지 못했어요. 권한과 연결을 확인한 뒤 다시 켜 주세요.' } }
    finally { if (!disposed && id === request) { loading = false; toggle.disabled = false } }
  }
  const segment = (stamp: number) => {
    if (!model || video.readyState < 2 || stamp - inferenceAt < (lowPower ? 110 : 75)) return
    inferenceAt = stamp
    try {
      const result = model.segmentForVideo(video, stamp)
      try {
        const mask = result.confidenceMasks?.[0]
        if (!mask) { clear(); return }
        const data = mask.getAsFloat32Array()
        const scale = Math.max(width / video.videoWidth, height / video.videoHeight), vw = video.videoWidth * scale, vh = video.videoHeight * scale
        let count = 0
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
          const u = 1 - ((x + .5) / gw * width - (width - vw) / 2) / vw, v = ((y + .5) / gh * height - (height - vh) / 2) / vh
          const mx = Math.max(0, Math.min(mask.width - 1, Math.floor(u * mask.width))), my = Math.max(0, Math.min(mask.height - 1, Math.floor(v * mask.height)))
          const i = y * gw + x, confidence = u >= 0 && u < 1 && v >= 0 && v < 1 ? 1 - data[my * mask.width + mx] : 0
          person[i] = Math.max(0, Math.min(1, (confidence - .45) / .3)); count += person[i] > .5 ? 1 : 0
        }
        hasBody = count > 12; seenAt = stamp
        drawCamera(sc, gw, gh)
        if(pattern)pixels = sc.getImageData(0, 0, gw, gh).data
        const message = hasBody ? (moneyMode ? '사람 인식 중 · V 또는 양손을 모아 돈을 받으세요.' : separated||crossed.active ? '투명화 중 · 손가락을 풀거나 투명화 버튼을 해제해 주세요.' : '사람 인식 중 · 검지와 중지를 교차해 보세요.') : '카메라에 얼굴과 몸이 보이도록 서 주세요.'
        if (status.textContent !== message) status.textContent = message
      } finally { result.close() }
      failures = 0
    } catch { if (++failures >= 4) { stop(); status.textContent = 'Body Mask 인식이 중단됐어요. 카메라를 다시 켜 주세요.' } }
  }
  // Match the contain-fit mask even when the analysis grid aspect ratio is capped.
  const drawCamera = (c: CanvasRenderingContext2D, w: number, h: number) => {
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const vw = video.videoWidth * scale / width * w, vh = video.videoHeight * scale / height * h
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h)
    c.save(); c.translate(w, 0); c.scale(-1, 1)
    c.drawImage(video, (w - vw) / 2, (h - vh) / 2, vw, vh); c.restore()
  }
  const draw = (stamp: number) => {
    if (disposed || document.hidden) { frame = 0; return }
    frame = requestAnimationFrame(draw); if (stamp - renderAt < 1000 / 30) return
    renderAt = stamp; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (video.readyState < 2 || !stream) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); return }
    if (video.currentTime !== videoTime) {
      videoTime = video.currentTime
      // Alternate inference tasks: never run both expensive models in one frame.
      if(hands && stamp-handAt>(lowPower?110:75)) {
        try {
          const landmarks=hands.detectForVideo(video,stamp).landmarks
          if(money){
            const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
            catchers=moneyCatchers(landmarks).map(c=>({x:((width-vw)/2+(1-c.x)*vw)/width,y:((height-vh)/2+c.y*vh)/height,width:c.width*vw/width}))
          }else crossed.update(landmarks,stamp)
          handAt=stamp
        }
        catch { crossed.reset();catchers=[];handAt=stamp }
      } else segment(stamp)
    }
    if (!stream || video.readyState < 2) return
    if (hasBody && stamp - seenAt > 450) clear()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if(money){
      if(stamp-handAt>350)catchers=[]
      drawCamera(ctx,width,height)
      const dt=lastStep?Math.min(.05,(stamp-lastStep)/1000):1/30;lastStep=stamp
      money.update(dt,person,gw,gh,catchers);money.draw(ctx,width,height,gw,gh,catchers)
      return
    }
    if(pattern){
      if(stamp-handAt>350)crossed.reset()
      const transparent=separated||crossed.active
      split.setAttribute('aria-pressed',String(transparent));split.textContent=separated?'투명화 해제':'사람 투명화'
      if(stamp-patternAt>(lowPower?80:50)){
        const dt=Number.isFinite(patternAt)?Math.min(100,stamp-patternAt):50
        transparency+=((transparent&&hasBody?1:0)-transparency)*(1-Math.exp(-dt/180))
        pattern.render(pixels,person,gw,gh,transparency,stamp);patternAt=stamp
      }
      ctx.drawImage(pattern.canvas,0,0,width,height)
    }
  }
  toggle.addEventListener('click', () => { if (stream) { stop(); status.textContent = '카메라 중지 · 효과를 중지했어요.' } else void start() }, { signal: events.signal })
  split.addEventListener('click',separate,{signal:events.signal})
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; stream?.getVideoTracks().forEach(t => { t.enabled = false }); clear() }
    else if (!disposed) { stream?.getVideoTracks().forEach(t => { t.enabled = true }); if (!frame) frame = requestAnimationFrame(draw) }
  }, { signal: events.signal })
  frame = requestAnimationFrame(draw); void start()
  return () => { disposed = true; stop(); events.abort(); observer.disconnect(); cancelAnimationFrame(frame); }
}
