import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createEarthGarden } from './earth-garden'
import { analyzeMiniature, buildMiniature } from './earth-miniature'
import { setupResidentLife, type Resident } from './earth-residents'
import { setupSpaceEdition } from './earth-space'
import { setupVillageMusic } from './earth-music'

type Arrival = { resident: Resident; started: number; from: THREE.Vector3; rotation: THREE.Quaternion; scale: number }
const LIMIT = 24

export function setupEarthVillage(root: HTMLElement) {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#earth-${id}`)!
  const canvas = $<HTMLCanvasElement>('canvas'), status = $('status'), count = $('count')
  const join = $<HTMLButtonElement>('join'), dialog = $<HTMLDialogElement>('dialog'), editorStatus = $('editor-status')
  const video = $<HTMLVideoElement>('camera'), preview = $<HTMLCanvasElement>('preview'), dropzone = $('dropzone')
  const photo = $<HTMLCanvasElement>('photo')
  const upload = $<HTMLInputElement>('upload'), startButton = $<HTMLButtonElement>('camera-start'), retry = $<HTMLButtonElement>('retry')
  const countdown = $('countdown'), hint = $('upload-hint'), revealText = $('reveal-status')
  let renderer: THREE.WebGLRenderer
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }) }
  catch { status.textContent = 'WebGL을 지원하는 브라우저에서 열어주세요.'; join.disabled = true; return () => {} }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 60)
  const home = new THREE.Vector3(8, 6, -10).setLength(17); camera.position.copy(home)
  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .075
  controls.minDistance = 5.2; controls.maxDistance = 26; controls.rotateSpeed = .6
  scene.add(new THREE.HemisphereLight(0xd4d8ff, 0x393266, 1.7))
  const sunlight = new THREE.DirectionalLight(0xe2d7ff, 2.1); sunlight.position.set(-3, 8, -6); scene.add(sunlight)
  const fill = new THREE.DirectionalLight(0x85eee7, .9); fill.position.set(5, 1, 6); scene.add(fill)
  const garden = createEarthGarden(scene), residents: Resident[] = [], events = new AbortController()
  const space = setupSpaceEdition(scene, root, residents, garden)
  const stopMusic = setupVillageMusic($<HTMLButtonElement>('music'))
  let disposed = false, animation = 0, lastTime = performance.now(), elapsed = 0
  let stream: MediaStream | null = null, artwork: HTMLCanvasElement | null = null
  let session = 0, imageRequest = 0, timer = 0, deadline = 0, processing = false, cameraLoading = false
  let arrival: Arrival | null = null
  let captureTask: AbortController | null = null
  let residentsReady = false
  const nameInput = $<HTMLInputElement>('name')
  const next = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4(), targetRotation = new THREE.Quaternion()
  const cameraDirection = new THREE.Vector3(), cameraUp = new THREE.Vector3(), destination = new THREE.Vector3()
  const stopCountdown = () => { clearTimeout(timer); timer = 0; countdown.hidden = true }
  const stopCamera = () => { stream?.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null; startButton.textContent = '카메라 다시 켜기' }
  const showArrival = (model: ReturnType<typeof buildMiniature>, name: string) => {
    const preferred = camera.position.clone().normalize().addScaledVector(camera.up, .9).normalize()
    const normal = preferred.clone(), candidate = new THREE.Vector3()
    let best = -Infinity
    for (let i = 0; i < 3000; i++) {
      candidate.randomDirection(); const dot = candidate.dot(preferred)
      if (dot > best && garden.walkable(candidate) && residents.every(r => r.normal.distanceTo(candidate) > .18)) { normal.copy(candidate); best = dot }
    }
    const direction = camera.position.clone().addScaledVector(normal, -camera.position.dot(normal)).normalize()
    if (direction.lengthSq() < .01) direction.set(1, 0, 0)
    const resident: Resident = { id: crypto.randomUUID(), name, root: model.actor, body: model.body, normal, direction, phase: Math.random() * Math.PI * 2, turnAt: elapsed + 8, radius: garden.radiusAt(normal) }
    scene.add(model.actor)
    camera.getWorldDirection(cameraDirection); cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const bounds = new THREE.Box3().setFromObject(model.actor), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
    // Keep the reveal in front of the planet even when the user has zoomed in.
    const revealDistance = Math.min(4, Math.max(.6, camera.position.length() - garden.boundsRadius - .8))
    const viewHeight = 2 * revealDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const scale = Math.min(viewHeight * .53 / size.y, viewHeight * camera.aspect * .62 / size.x)
    const from = camera.position.clone().addScaledVector(cameraDirection, revealDistance).addScaledVector(cameraUp, -center.y * scale)
    arrival = { resident, started: elapsed, from, rotation: camera.quaternion.clone(), scale }
    model.actor.position.copy(from); model.actor.quaternion.copy(camera.quaternion); model.actor.scale.setScalar(scale)
    root.classList.add('is-revealing'); revealText.textContent = `${name} 주민이 태어났어요! 잠시 후 지구로 입주합니다.`
    dialog.close(); controls.enabled = false
  }
  const capture = async () => {
    if (!artwork || !stream || video.readyState < 2 || processing) return
    const request = session, shape = artwork, name = nameInput.value.trim().slice(0, 20) || `주민 ${residents.length + 1}`
    processing = true; stopCountdown(); retry.disabled = true; startButton.disabled = true; upload.disabled = true
    root.classList.add('is-creating'); editorStatus.textContent = '찰칵! 사람의 배경을 지우고, 미니어처에 옷을 입히고 있어요…'
    const shot = document.createElement('canvas'); shot.width = video.videoWidth; shot.height = video.videoHeight
    const ctx = shot.getContext('2d')!; ctx.translate(shot.width, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0)
    photo.width = shot.width; photo.height = shot.height; photo.getContext('2d')!.drawImage(shot, 0, 0); photo.hidden = false
    const task = new AbortController(); captureTask = task
    stopCamera()
    try {
      const { capturePerson } = await import('./earth-person')
      const person = await capturePerson(shot, task.signal, (stage) => {
        if (disposed || session !== request) return
        editorStatus.textContent = stage === 'segment' ? '촬영 완료 · 사람의 경계 안쪽만 잘라내고 있어요…' : '얼굴과 팔다리 위치를 찾아 미니어처에 입히고 있어요…'
      })
      if (disposed || session !== request) return
      editorStatus.textContent = '입체 미니어처를 완성하고 있어요…'
      showArrival(buildMiniature(shape, person), name)
    } catch (error) {
      if (!disposed && session === request) editorStatus.textContent = error instanceof Error ? error.message : '캐릭터를 만들지 못했어요. 다시 촬영해 주세요.'
    } finally {
      if (captureTask === task) captureTask = null
      if (!disposed && session === request) { processing = false; retry.disabled = false; startButton.disabled = false; upload.disabled = false; root.classList.remove('is-creating') }
    }
  }
  const beginCountdown = () => {
    stopCountdown()
    if (!artwork || !stream || video.readyState < 2 || processing || !dialog.open) return
    deadline = performance.now() + 5000
    const request = session
    countdown.hidden = false; editorStatus.textContent = '5초 후 사진을 촬영합니다. 얼굴과 팔다리가 잘 보이도록 자세를 잡아주세요.'
    const update = () => {
      if (disposed || request !== session || !dialog.open) return
      if (document.hidden) { stopCountdown(); editorStatus.textContent = '촬영이 일시 중지됐어요. 돌아오면 다시 5초를 셉니다.'; return }
      const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000)); countdown.textContent = String(seconds)
      if (!seconds) { void capture(); return }
      timer = window.setTimeout(update, Math.min(250, deadline - performance.now()))
    }
    update()
  }
  const startCamera = async () => {
    if (cameraLoading || processing || disposed) return
    if (stream) { beginCountdown(); return }
    if (!navigator.mediaDevices?.getUserMedia) { editorStatus.textContent = 'HTTPS 또는 localhost에서 카메라를 사용할 수 있어요.'; return }
    const request = session; cameraLoading = true; startButton.disabled = true
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: false })
      if (disposed || request !== session || !dialog.open) { opened.getTracks().forEach((track) => track.stop()); return }
      stream = opened; video.srcObject = opened; await video.play()
      if (disposed || request !== session) return
      photo.hidden = true
      startButton.textContent = '카메라 준비 완료'; editorStatus.textContent = '오른쪽에 이미지를 넣으면 5초 후 자동으로 촬영합니다.'; beginCountdown()
    } catch { if (!disposed && request === session) { stopCamera(); editorStatus.textContent = '카메라를 열지 못했어요. 권한을 허용한 뒤 카메라 다시 켜기를 눌러주세요.' } }
    finally { if (!disposed && request === session) { cameraLoading = false; startButton.disabled = false } }
  }
  const loadImage = async (file: File) => {
    if (processing) return
    if (file.size > 12 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) { editorStatus.textContent = '12MB 이하의 PNG, JPG, WebP 이미지를 넣어주세요.'; return }
    const request = ++imageRequest, current = session
    stopCountdown(); artwork = null; dropzone.classList.remove('has-image'); editorStatus.textContent = '이미지의 형체와 윤곽을 살펴보고 있어요…'
    try {
      const bitmap = await createImageBitmap(file)
      try { if (disposed || request !== imageRequest || current !== session) return; artwork = analyzeMiniature(bitmap) }
      finally { bitmap.close() }
      const ctx = preview.getContext('2d')!; ctx.clearRect(0, 0, 384, 384); ctx.drawImage(artwork, 0, 0)
      dropzone.classList.add('has-image'); hint.textContent = '이미지 변경하기 · 한 형체가 크게 나온 사진을 권장해요'
      if (stream) beginCountdown(); else { editorStatus.textContent = '이미지 준비 완료. 카메라가 켜지면 5초 카운트가 시작됩니다.'; void startCamera() }
    } catch (error) { if (!disposed && current === session && request === imageRequest) editorStatus.textContent = error instanceof Error ? error.message : '이미지를 읽지 못했어요.' }
  }
  const on = (target: EventTarget, type: string, callback: EventListener) => target.addEventListener(type, callback, { signal: events.signal })
  on(join, 'click', () => {
    if (!residentsReady || residents.length >= LIMIT || arrival) return
    life.suspend(); nameInput.value = ''
    session++; artwork = null; processing = false; photo.hidden = true; upload.value = ''; upload.disabled = false; retry.disabled = false; startButton.disabled = false
    dropzone.classList.remove('has-image'); hint.textContent = '이미지를 드래그하거나 클릭해서 추가해 주세요'; preview.getContext('2d')!.clearRect(0, 0, 384, 384)
    dialog.showModal(); controls.enabled = false; editorStatus.textContent = '카메라를 준비하고 있어요…'; void startCamera()
  })
  on(dialog, 'close', () => {
    session++; imageRequest++; captureTask?.abort(); captureTask = null; stopCountdown(); stopCamera(); processing = false; cameraLoading = false
    root.classList.remove('is-creating'); controls.enabled = !arrival; if (!arrival) join.focus()
  })
  on(startButton, 'click', () => { void startCamera() })
  on(retry, 'click', () => { if (stream) beginCountdown(); else void startCamera() })
  on(upload, 'change', () => { const file = upload.files?.[0]; if (file) void loadImage(file) })
  on(dropzone, 'dragover', (event) => { event.preventDefault(); if (!processing) dropzone.classList.add('is-dragging') })
  on(dropzone, 'dragleave', () => dropzone.classList.remove('is-dragging'))
  on(dropzone, 'drop', (event) => { event.preventDefault(); dropzone.classList.remove('is-dragging'); const file = (event as DragEvent).dataTransfer?.files[0]; if (file) void loadImage(file) })
  on($('zoom-in'), 'click', () => { controls.dollyIn(1 / 1.22); controls.update() })
  on($('zoom-out'), 'click', () => { controls.dollyOut(1 / 1.22); controls.update() })
  on($('reset'), 'click', () => { if (!arrival) { life.suspend(); camera.position.copy(home); controls.target.set(0, 0, 0); controls.update() } })
  const resize = () => {
    const bounds = root.getBoundingClientRect()
    renderer.setSize(bounds.width, bounds.height, false); camera.aspect = bounds.width / Math.max(1, bounds.height)
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / Math.min(1, camera.aspect)))
    const verticalSpace = THREE.MathUtils.clamp((bounds.height - 240) / bounds.height, .3, .76), halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const fitDistance = garden.boundsRadius / Math.sin(Math.atan(Math.min(Math.tan(halfFov) * verticalSpace, Math.tan(halfFov) * camera.aspect * .85)))
    const zoomRatio = camera.position.length() / home.length(); home.setLength(fitDistance)
    controls.maxDistance = fitDistance * 1.65; camera.far = Math.max(60, controls.maxDistance + garden.boundsRadius + 10)
    camera.position.setLength(THREE.MathUtils.clamp(fitDistance * zoomRatio, controls.minDistance, controls.maxDistance)); camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize); observer.observe(root); resize()
  const orient = (resident: Resident) => {
    resident.direction.projectOnPlane(resident.normal).normalize()
    if (resident.direction.lengthSq() < .01) resident.direction.set(Math.abs(resident.normal.x) < .9 ? 1 : 0, Math.abs(resident.normal.x) < .9 ? 0 : 1, 0).projectOnPlane(resident.normal).normalize()
    right.crossVectors(resident.normal, resident.direction).normalize(); basis.makeBasis(right, resident.normal, resident.direction)
    resident.root.quaternion.setFromRotationMatrix(basis); resident.root.position.copy(resident.normal).multiplyScalar(resident.radius + .008)
  }
  join.disabled = true
  const life = setupResidentLife({ root, canvas, scene, camera, controls, garden, residents, orient,
    busy: () => !!arrival || dialog.open || !residentsReady,
    changed: () => { count.textContent = String(residents.length); join.disabled = !residentsReady || residents.length >= LIMIT },
  })
  void life.ready.then(() => { if (!disposed) { residentsReady = true; join.disabled = residents.length >= LIMIT } })
  const tick = (time: number) => {
    if (disposed || document.hidden) { animation = 0; return }
    animation = requestAnimationFrame(tick)
    const delta = Math.min(.05, (time - lastTime) / 1000); lastTime = time; elapsed += delta
    if (!dialog.open) residents.forEach((resident) => {
      if (life.ownsMovement(resident)) return
      const frightened = space.frightened(resident)
      if (!frightened && elapsed > resident.turnAt) { resident.direction.applyAxisAngle(resident.normal, (Math.random() - .5) * 1.6); resident.turnAt = elapsed + 3 + Math.random() * 5 }
      for (const other of residents) {
        if (other === resident || resident.normal.distanceToSquared(other.normal) > .04) continue
        next.copy(resident.normal).sub(other.normal).projectOnPlane(resident.normal).normalize()
        resident.direction.addScaledVector(next, delta * 8).normalize()
      }
      next.copy(resident.normal).addScaledVector(resident.direction, delta * (frightened ? .115 : .026)).normalize()
      const blocked = residents.some(other => other !== resident && next.distanceToSquared(other.normal) < .018 && next.distanceToSquared(other.normal) < resident.normal.distanceToSquared(other.normal))
      const radius = blocked ? null : garden.stepRadius(next)
      if (radius !== null) { resident.normal.copy(next); resident.radius = radius } else resident.direction.applyAxisAngle(resident.normal, 1.4)
      resident.direction.addScaledVector(resident.normal, -resident.direction.dot(resident.normal)).normalize(); orient(resident)
      const step = elapsed * (frightened ? 14 : 7) + resident.phase
      resident.root.userData.walkTime.value = elapsed * (frightened ? 2 : 1) + resident.phase / 7
      resident.body.position.y = Math.abs(Math.sin(step)) * .024; resident.body.rotation.z = Math.sin(step) * .055; resident.body.rotation.x = Math.sin(step * .5) * .035
    })
    if (arrival) {
      const { resident, started, from, rotation, scale } = arrival
      const age = elapsed - started, progress = THREE.MathUtils.clamp((age - 2.8) / 2.8, 0, 1), ease = progress * progress * (3 - 2 * progress)
      right.crossVectors(resident.normal, resident.direction).normalize(); basis.makeBasis(right, resident.normal, resident.direction); targetRotation.setFromRotationMatrix(basis)
      destination.copy(resident.normal).multiplyScalar(resident.radius + .008)
      resident.root.position.lerpVectors(from, destination, ease); resident.root.scale.setScalar(THREE.MathUtils.lerp(scale, .7, ease)); resident.root.quaternion.copy(rotation).slerp(targetRotation, ease)
      if (!progress) resident.body.rotation.y = Math.sin(age * 1.2) * .22; else resident.body.rotation.y *= .9
      if (progress === 1) {
        residents.push(resident); arrival = null; root.classList.remove('is-revealing'); controls.enabled = true
        life.added(resident)
        count.textContent = String(residents.length); status.textContent = `${residents.length}번째 주민이 입주했어요. 지구를 돌려 만나보세요!`; join.disabled = residents.length >= LIMIT; join.focus()
      }
    }
    life.update(delta); space.update(delta, !!arrival || dialog.open || !residentsReady || life.interacting()); controls.update(delta); garden.update(elapsed, camera.position); renderer.render(scene, camera)
  }
  on(document, 'visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(animation); animation = 0; stopCountdown() }
    else if (!disposed) { lastTime = performance.now(); if (!animation) animation = requestAnimationFrame(tick); if (dialog.open) beginCountdown() }
  })
  animation = requestAnimationFrame(tick)
  return () => {
    disposed = true; session++; imageRequest++; captureTask?.abort(); events.abort(); stopCountdown(); cancelAnimationFrame(animation); observer.disconnect(); stopCamera()
    life.dispose(); space.dispose(); stopMusic(); if (dialog.open) dialog.close(); controls.dispose()
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
      if (object instanceof THREE.InstancedMesh) object.dispose(); geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(material); if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map) }
    })
    geometries.forEach((item) => item.dispose()); materials.forEach((item) => item.dispose()); textures.forEach((item) => item.dispose()); renderer.dispose(); renderer.forceContextLoss()
  }
}
