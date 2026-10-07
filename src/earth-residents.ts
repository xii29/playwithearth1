import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { VILLAGE_CLEARING, VILLAGE_HOLE, type createEarthGarden } from './earth-garden'
import { buildMiniature } from './earth-miniature'
import { loadResidents, saveResidents, type SavedResident } from './earth-storage'
import { ANIMAL_NAMES, createAnimal, gyaruTexture } from './earth-animals'

export type Resident = { id: string; name: string; root: THREE.Group; body: THREE.Mesh; normal: THREE.Vector3; direction: THREE.Vector3; phase: number; turnAt: number; radius: number }
type Options = { root: HTMLElement; canvas: HTMLCanvasElement; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; garden: ReturnType<typeof createEarthGarden>; residents: Resident[]; orient: (r: Resident) => void; busy: () => boolean; changed: () => void }
type Trip = { from: THREE.Vector3; to: THREE.Vector3; age: number; duration: number }
export function setupResidentLife({ root, canvas, scene, camera, controls, garden, residents, orient, busy, changed }: Options) {
  const events = new AbortController(), assets = new Map<string, SavedResident>()
  const status = root.querySelector<HTMLElement>('#earth-status')!
  const meetingButton = root.querySelector<HTMLButtonElement>('#earth-meeting')!
  const ui = document.createElement('div'); ui.className = 'earth-resident-ui'
  ui.innerHTML = `<label class="earth-roster-label">주민 <select id="earth-roster" aria-label="주민 선택"><option value="">주민 만나기</option></select></label>
    <section class="earth-conversation" hidden aria-label="주민 대화">
      <div class="earth-dialogue-bubble">
      <header><strong id="earth-resident-name"></strong><button id="earth-unfollow" type="button">전체 보기</button></header>
      <p id="earth-dialogue" role="status"></p>
      <i class="earth-dialogue-marker" aria-hidden="true"></i>
      </div>
      <details class="earth-conversation-controls"><summary>대화 · 꾸미기</summary>
      <button id="earth-random-chat" type="button">친구와 랜덤 수다 ♡</button>
      <form id="earth-chat"><input aria-label="주민에게 할 말" maxlength="120" placeholder="주민에게 말을 걸어 보세요"><button>보내기</button></form>
      <small>이 기기에서 응답하는 주민 대화 · AI 연결 없음</small>
      <div class="earth-resident-tools"><button id="earth-edit-texture" type="button">텍스처 문지르기</button><button id="earth-rename" type="button">이름 변경</button></div>
      <label id="earth-rename-row" hidden>새 이름 <input id="earth-new-name" maxlength="20"><button id="earth-save-name" type="button">저장</button></label>
      </details>
    </section>
    <dialog id="earth-texture-dialog" class="earth-texture-dialog">
      <form method="dialog"><strong>텍스처 문지르기</strong><button aria-label="텍스처 편집 닫기">닫기</button></form>
      <p>사진을 문질러 색을 칠하거나 원본 사진을 복원하세요. 캐릭터에 바로 반영됩니다.</p>
      <canvas id="earth-texture-canvas" width="512" height="512" aria-label="문질러 수정하는 캐릭터 텍스처"></canvas>
      <div><label>색상 <input id="earth-brush-color" type="color" value="#a7d6ca"></label><label>크기 <input id="earth-brush-size" type="range" min="4" max="70" value="24"></label></div>
      <div><button id="earth-brush-mode" type="button" aria-pressed="false">원본 복원 브러시</button><button id="earth-brush-undo" type="button">되돌리기</button><button id="earth-brush-reset" type="button">전체 원본 복원</button></div>
      <small>편집은 자동 저장됩니다. 사진은 외부로 전송되지 않습니다.</small>
    </dialog>`
  root.append(ui)
  const $ = <T extends HTMLElement>(id: string) => ui.querySelector<T>(`#earth-${id}`)!
  const roster = $<HTMLSelectElement>('roster'), panel = ui.querySelector<HTMLElement>('.earth-conversation')!
  const textureDialog = $<HTMLDialogElement>('texture-dialog'), editor = $<HTMLCanvasElement>('texture-canvas')
  const paint = editor.getContext('2d')!, scratch = document.createElement('canvas'); scratch.width = scratch.height = 512
  const brush = scratch.getContext('2d')!
  let disposed = false, loaded = false, selected: Resident | null = null, meeting = false, saveTime = 0
  let drag: { resident: Resident; id: number; x: number; y: number; moved: boolean; valid: boolean; original: THREE.Vector3 } | null = null
  const trips = new Map<Resident, Trip>(), falling = new Map<Resident, number>()
  const originalTextures = new Map<string, HTMLCanvasElement>()
  const topics=[
    ['오늘 코디 포인트는 핑크 레오파드야!','완전 찰떡! 난 금빛 귀걸이로 반짝임 추가했어.','우리 꽃길에서 같이 사진 찍자!','좋아, 오늘도 우리다운 스타일로 ♡'],
    ['딸기 파르페 먹으러 갈래?','좋아! 위에 체리도 꼭 올리자.','산책하고 먹으면 더 맛있겠지?','그럼 꽃길 한 바퀴 돌고 카페로 출발!'],
    ['오늘 플레이리스트 추천해 줘!','걸을 때 신나는 노래는 어때?','좋아, 나뭇잎도 박자 맞춰 흔들리네.','우리 마을이 작은 무대 같아!'],
    ['우주인이 놀러 오면 뭐부터 보여 줄까?','우리 꽃밭! 반짝이는 네일도 자랑할래.','같이 셀카 찍으면 대박이겠다.','그럼 내가 제일 귀여운 포즈 알려 줄게 ♡'],
    ['다음에는 무슨 색 꽃을 심을까?','분홍이랑 노랑! 같이 있으면 기분 좋아져.','그 옆에 작은 피크닉 자리도 만들자.','완전 좋아. 간식은 내가 챙길게!']
  ]
  let conversation:{pair:Resident[];lines:string[];line:number;age:number}|null=null,lastTopic=-1
  const speak=()=>{if(!conversation)return;const speaker=conversation.pair[conversation.line%conversation.pair.length];$('resident-name').textContent=speaker.name;$('dialogue').textContent=conversation.lines[conversation.line]}
  const startConversation=()=>{
    if(!selected)return
    const friends=residents.filter(r=>r!==selected&&!falling.has(r)).sort((a,b)=>a.normal.distanceToSquared(selected!.normal)-b.normal.distanceToSquared(selected!.normal))
    if(!friends.length){$('dialogue').textContent='친구가 입주하면 같이 수다 떨자 ♡';return}
    let topic=Math.floor(Math.random()*(topics.length-1));if(topic>=lastTopic)topic++;topic%=topics.length;lastTopic=topic
    conversation={pair:[selected,friends[0]],lines:topics[topic],line:0,age:0};conversation.pair.forEach(r=>trips.delete(r));speak()
  }
  let edited: Resident | null = null, painting = false, restoreBrush = false, lastBrush: THREE.Vector2 | null = null
  const undo: ImageData[] = []
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), target = new THREE.Vector3(), desired = new THREE.Vector3()
  const on = (target: EventTarget, type: string, callback: EventListener) => target.addEventListener(type, callback, { signal: events.signal })
  on($('random-chat'),'click',startConversation)
  const texture = (resident: Resident) => (resident.body.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture
  const textureCanvas = (resident: Resident) => texture(resident).image as HTMLCanvasElement
  const cloneCanvas = (source: HTMLCanvasElement) => {
    const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height
    copy.getContext('2d')!.drawImage(source, 0, 0); return copy
  }
  const refresh = () => {
    roster.replaceChildren(new Option('주민 만나기', ''))
    for (const resident of residents) roster.add(new Option(resident.name, resident.id))
    roster.value = selected?.id ?? ''; meetingButton.disabled = !residents.length; changed()
  }
  const cache = (resident: Resident) => {
    const record = assets.get(resident.id)
    const shape = resident.root.userData.shape as HTMLCanvasElement
    const image = textureCanvas(resident).toDataURL('image/png')
    assets.set(resident.id, { id: resident.id, name: resident.name, normal: resident.normal.toArray(), shape: record?.shape ?? shape.toDataURL('image/png'), texture: image, original: record?.original ?? originalTextures.get(resident.id)?.toDataURL('image/png') ?? image,gyaru:!!resident.root.userData.gyaru })
  }
  const persist = () => {
    if (!loaded) return
    const records = residents.filter(r => !falling.has(r)).map(resident => {
      if (!assets.has(resident.id)) cache(resident)
      return { ...assets.get(resident.id)!, name: resident.name, normal: resident.normal.toArray() }
    })
    void saveResidents(records).catch(() => { if (!disposed) status.textContent = '저장 공간을 사용할 수 없어요. 브라우저 저장 설정을 확인해 주세요.' })
  }
  const leave = () => {
    conversation=null
    selected = null; panel.hidden = true; roster.value = ''; camera.up.set(0, 1, 0)
    controls.target.set(0, 0, 0); controls.minDistance = 5.2; controls.enabled = !busy()
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const fullView = 4.2 / Math.sin(Math.atan(Math.min(Math.tan(halfFov) * .72, Math.tan(halfFov) * camera.aspect * .82)))
    camera.position.setLength(Math.max(fullView, camera.position.length()))
  }
  const focus = (resident: Resident) => {
    if (busy() || falling.has(resident)) return
    selected = resident; panel.hidden = false; roster.value = resident.id
    ui.querySelector<HTMLDetailsElement>('.earth-conversation-controls')!.open=false
    $('resident-name').textContent = resident.name
    $('dialogue').textContent = `안녕! 나는 ${resident.name}이야. 같이 이 작은 지구를 둘러볼래?`
    $('rename-row').hidden = true; controls.enabled = false; controls.minDistance = .35
    startConversation()
  }
  on($('unfollow'), 'click', leave)
  on(roster, 'change', () => { const resident = residents.find(r => r.id === roster.value); if (resident) focus(resident) })
  let replyIndex = 0
  on($('chat'), 'submit', event => {
    event.preventDefault(); if (!selected) return
    conversation=null
    const input = $('chat').querySelector('input')!, message = input.value.trim(); if (!message) return
    const replies = ['꽃이 피는 길을 찾아 걷고 있었어. 너도 같이 갈래?', '여기서 만난 이웃들이 좋아. 오늘은 누구를 만났어?', '가끔은 천천히 걸으며 하늘을 보고 싶어.', '네가 꾸며 준 모습이 마음에 들어. 또 이야기해 줘!']
    const response = /안녕|반가/.test(message) ? `반가워! 내 이름은 ${selected.name}이야.` : /이름/.test(message) ? `나는 ${selected.name}! 네가 지어 준 이름이야.` : /회의|모이/.test(message) ? '주민 회의 버튼을 누르면 공터에서 모두 만날 수 있어!' : /고마|좋아|사랑/.test(message) ? '그렇게 말해 줘서 기뻐. 나도 네가 와서 좋아!' : replies[(replyIndex++ + Math.floor(selected.phase)) % replies.length]
    $('dialogue').textContent = response; input.value = ''
  })
  on($('rename'), 'click', () => { if (selected) { $('rename-row').hidden = false; $<HTMLInputElement>('new-name').value = selected.name; $('new-name').focus() } })
  on($('save-name'), 'click', () => {
    const name = $<HTMLInputElement>('new-name').value.trim().slice(0, 20)
    if (selected && name) { selected.name = name; $('resident-name').textContent = name; $('rename-row').hidden = true; refresh(); persist() }
  })

  const hole = new THREE.Group(); hole.name = 'Resident release pit'
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.265, .027, 8, 48), new THREE.MeshStandardMaterial({ color: '#a57c56', roughness: .9 }))
  const opening = new THREE.Mesh(new THREE.CircleGeometry(.24, 48), new THREE.MeshBasicMaterial({ color: '#080c12', side: THREE.DoubleSide }))
  opening.position.z = -.035; hole.add(rim, opening)
  hole.position.copy(VILLAGE_HOLE).multiplyScalar(3.275); hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), VILLAGE_HOLE); scene.add(hole)
  const labelCanvas = document.createElement('canvas'); labelCanvas.width = 256; labelCanvas.height = 64
  const lc = labelCanvas.getContext('2d')!; lc.fillStyle = '#14252be6'; lc.fillRect(0, 0, 256, 64); lc.fillStyle = '#fff0d5'; lc.font = '24px sans-serif'; lc.textAlign = 'center'; lc.fillText('방출 구덩이', 128, 42)
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), depthTest: true }))
  label.position.copy(VILLAGE_HOLE).multiplyScalar(3.7); label.scale.set(.7, .175, 1); scene.add(label)
  const setRay = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(); ray.setFromCamera(pointer, camera)
  }
  const hitGround = () => ray.intersectObject(garden.ground, false)[0]
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag || busy() || textureDialog.open) return
    setRay(event)
    const hit = ray.intersectObjects(residents.filter(r => !falling.has(r)).map(r => r.body), false)[0], ground = hitGround()
    if (!hit || (ground && hit.distance > ground.distance + .02)) return
    const resident = residents.find(r => r.body === hit.object)!
    event.preventDefault(); event.stopImmediatePropagation(); controls.enabled = false; canvas.setPointerCapture(event.pointerId)
    drag = { resident, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, valid: false, original: resident.normal.clone() }
  }
  canvas.addEventListener('pointerdown', pointerDown, { capture: true, signal: events.signal })
  on(canvas, 'pointermove', event => {
    const e = event as PointerEvent; if (!drag || drag.id !== e.pointerId) return
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
    drag.moved = true; conversation=null;trips.delete(drag.resident); setRay(e)
    const hit = hitGround(); drag.valid = false
    if (hit) {
      const normal = hit.point.clone().normalize(), inHole = normal.distanceTo(VILLAGE_HOLE) < .087
      drag.valid = inHole || garden.walkable(normal)
      if (drag.valid) { drag.resident.normal.copy(normal); drag.resident.radius = garden.radiusAt(normal); orient(drag.resident); drag.resident.root.position.addScaledVector(normal, .15) }
      ;(rim.material as THREE.MeshStandardMaterial).color.set(inHole ? '#ff8a7c' : '#a57c56')
      status.textContent = inHole ? '여기에 놓으면 주민이 방출됩니다. 취소하려면 구덩이 밖으로 옮기세요.' : drag.valid ? '이곳에 주민을 내려놓을 수 있어요.' : '나무와 물을 피해 땅 위에 놓아 주세요.'
    }
  })
  const endDrag = (event: Event) => {
    const e = event as PointerEvent; if (!drag || e.pointerId !== drag.id) return
    const item = drag; drag = null
    if (canvas.hasPointerCapture(item.id)) canvas.releasePointerCapture(item.id)
    ;(rim.material as THREE.MeshStandardMaterial).color.set('#a57c56')
    if (e.type === 'pointercancel' || e.type === 'lostpointercapture' || !item.valid) { item.resident.normal.copy(item.original); item.resident.radius = garden.radiusAt(item.original); orient(item.resident) }
    if (item.moved && item.valid && e.type === 'pointerup') {
      if (item.resident.normal.distanceTo(VILLAGE_HOLE) < .087) {
        if (selected === item.resident) leave()
        falling.set(item.resident, 0); persist(); status.textContent = `${item.resident.name} 주민이 지구를 떠나요.`
      } else { orient(item.resident); persist() }
    } else if (!item.moved && e.type === 'pointerup') focus(item.resident)
    controls.enabled = !selected && !busy()
  }
  on(canvas, 'pointerup', endDrag); on(canvas, 'pointercancel', endDrag); on(canvas, 'lostpointercapture', endDrag)
  on(meetingButton, 'click', () => {
    if (busy() || !residents.length) return
    leave(); meeting = !meeting; meetingButton.textContent = meeting ? '회의 해산' : '주민 회의'; trips.clear()
    if (!meeting) { persist(); return }
    const east = new THREE.Vector3().crossVectors(VILLAGE_CLEARING, new THREE.Vector3(0, 1, 0)).normalize(), north = new THREE.Vector3().crossVectors(east, VILLAGE_CLEARING)
    residents.filter(r => !falling.has(r)).forEach((resident, i) => {
      const radius = .071 * Math.sqrt(i + 1)
      const to = VILLAGE_CLEARING.clone()
      for (let attempt = 0; attempt < 20; attempt++) {
        const angle = i * 2.39996 + attempt * .4
        to.copy(VILLAGE_CLEARING).addScaledVector(east, Math.cos(angle) * radius).addScaledVector(north, Math.sin(angle) * radius).normalize()
        if (garden.walkable(to) && [...trips.values()].every(trip => trip.to.distanceTo(to) > .11)) break
      }
      trips.set(resident, { from: resident.normal.clone(), to, age: 0, duration: 3 + resident.normal.angleTo(to) })
    })
    const distance = camera.position.length(); camera.position.copy(VILLAGE_CLEARING).multiplyScalar(distance); controls.target.set(0, 0, 0)
    status.textContent = '주민들이 공터로 모이고 있어요. 회의 해산을 누르면 다시 산책합니다.'
  })

  const applyPaint = () => { if (edited) { const target = textureCanvas(edited); target.getContext('2d')!.clearRect(0, 0, 512, 512); target.getContext('2d')!.drawImage(editor, 0, 0); texture(edited).needsUpdate = true } }
  const commitPaint = () => { if (edited) { cache(edited); persist() } }
  const remember = () => { undo.push(paint.getImageData(0, 0, 512, 512)); if (undo.length > 10) undo.shift() }
  const mark = (e: PointerEvent) => {
    if (!edited) return
    const rect = editor.getBoundingClientRect(), p = new THREE.Vector2((e.clientX - rect.left) / rect.width * 512, (e.clientY - rect.top) / rect.height * 512)
    const start = lastBrush ?? p, radius = Number($<HTMLInputElement>('brush-size').value), steps = Math.max(1, Math.ceil(start.distanceTo(p) / (radius * .25)))
    brush.clearRect(0, 0, 512, 512); brush.globalCompositeOperation = 'source-over'
    for (let i = 0; i <= steps; i++) {
      const x = THREE.MathUtils.lerp(start.x, p.x, i / steps), y = THREE.MathUtils.lerp(start.y, p.y, i / steps)
      const gradient = brush.createRadialGradient(x, y, radius * .2, x, y, radius)
      gradient.addColorStop(0, $<HTMLInputElement>('brush-color').value); gradient.addColorStop(1, 'transparent')
      brush.fillStyle = gradient; brush.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }
    if (restoreBrush) { brush.globalCompositeOperation = 'source-in'; brush.drawImage(originalTextures.get(edited.id)!, 0, 0); brush.globalCompositeOperation = 'source-over' }
    paint.drawImage(scratch, 0, 0); lastBrush = p; applyPaint()
  }
  on($('edit-texture'), 'click', () => {
    if (!selected) return
    edited = selected; undo.length = 0; paint.clearRect(0, 0, 512, 512); paint.drawImage(textureCanvas(edited), 0, 0)
    if (!originalTextures.has(edited.id)) originalTextures.set(edited.id, cloneCanvas(textureCanvas(edited)))
    textureDialog.showModal()
  })
  on(editor, 'pointerdown', event => { const e = event as PointerEvent; if (e.button !== 0) return; painting = true; lastBrush = null; remember(); editor.setPointerCapture(e.pointerId); mark(e) })
  on(editor, 'pointermove', event => { if (painting) mark(event as PointerEvent) })
  const finishPaint = () => { if (painting) { painting = false; lastBrush = null; commitPaint() } }
  on(editor, 'pointerup', finishPaint); on(editor, 'pointercancel', finishPaint); on(editor, 'lostpointercapture', finishPaint)
  on(textureDialog, 'close', () => { finishPaint(); commitPaint(); edited = null })
  on($('brush-mode'), 'click', () => { restoreBrush = !restoreBrush; $('brush-mode').setAttribute('aria-pressed', String(restoreBrush)) })
  on($('brush-undo'), 'click', () => { const previous = undo.pop(); if (previous) { paint.putImageData(previous, 0, 0); applyPaint(); commitPaint() } })
  on($('brush-reset'), 'click', () => { if (edited) { remember(); paint.clearRect(0, 0, 512, 512); paint.drawImage(originalTextures.get(edited.id)!, 0, 0); applyPaint(); commitPaint() } })
  on(window, 'pagehide', persist)
  on(document, 'visibilitychange', () => { if (document.hidden) persist() })
  const decode = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0); return c }
  const ready = loadResidents().then(async records => {
    if (records === null && !disposed) {
      for (let i = 0; i < ANIMAL_NAMES.length; i++) {
        const model = createAnimal(i), normal = VILLAGE_CLEARING.clone()
        for (let attempt = 0; attempt < 2000; attempt++) {
          const spread = .55 + attempt / 2000
          normal.set(Math.cos(i * 2.4 + attempt * .7) * spread + VILLAGE_CLEARING.x, VILLAGE_CLEARING.y + Math.sin(i * 2.4 + attempt * .7) * spread, VILLAGE_CLEARING.z).normalize()
          if (garden.walkable(normal) && residents.every(r => r.normal.distanceTo(normal) > .23)) break
        }
        const direction = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize()
        const resident: Resident = { id: crypto.randomUUID(), name: ANIMAL_NAMES[i], root: model.actor, body: model.body, normal, direction, radius: garden.radiusAt(normal), phase: i, turnAt: 0 }
        model.actor.scale.setScalar(.7); orient(resident); scene.add(model.actor); residents.push(resident); cache(resident)
      }
      loaded = true; persist()
    }
    for (const record of records ?? []) {
      if (disposed) break
      try {
        const [shape, image, original] = await Promise.all([decode(record.shape), decode(record.texture), decode(record.original ?? record.texture)])
        if (disposed) break
        const model = buildMiniature(shape, { image, landmarks: [], bounds: { x: 0, y: 0, width: image.width, height: image.height }, color: '#d5c8b5' })
        model.actor.userData.gyaru=!!record.gyaru
        if(!record.gyaru){const map=(model.body.material as THREE.MeshStandardMaterial).map!;gyaruTexture(map.image as HTMLCanvasElement,residents.length);map.needsUpdate=true;model.actor.userData.gyaru=true}
        const normal = new THREE.Vector3().fromArray(record.normal).normalize()
        if (normal.lengthSq() < .5) normal.copy(VILLAGE_CLEARING)
        if (!garden.walkable(normal) || residents.some(r => r.normal.distanceTo(normal) < .18)) {
          const base = normal.clone()
          for (let attempt = 0; attempt < 2000; attempt++) {
            const angle = attempt * 2.39996, spread = .03 + attempt * .0007
            normal.copy(base).add(new THREE.Vector3(Math.cos(angle) * spread, Math.sin(angle) * spread, Math.sin(angle * .7) * spread)).normalize()
            if (garden.walkable(normal) && residents.every(r => r.normal.distanceTo(normal) > .18)) break
          }
        }
        const direction = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
        const resident: Resident = { id: record.id, name: record.name.slice(0, 20), root: model.actor, body: model.body, normal, direction, radius: garden.radiusAt(normal), phase: Math.random() * 6, turnAt: 0 }
        model.actor.scale.setScalar(.7); orient(resident); scene.add(model.actor); residents.push(resident); assets.set(resident.id, record); originalTextures.set(resident.id, original);cache(resident)
      } catch { if (!disposed) status.textContent = '읽을 수 없는 주민 데이터가 있어 해당 주민을 건너뛰었어요.' }
    }
  }).catch(() => { if (!disposed) status.textContent = '저장소를 열 수 없어요. 이번 주민은 저장되지 않을 수 있습니다.' }).finally(() => { loaded = true; if (!disposed) refresh() })
  return {
    ready,
    interacting: () => !!drag || textureDialog.open || meeting || !!conversation,
    added: (resident: Resident) => { if(!resident.root.userData.gyaru){originalTextures.set(resident.id,cloneCanvas(textureCanvas(resident)));gyaruTexture(textureCanvas(resident),residents.length);texture(resident).needsUpdate=true;resident.root.userData.gyaru=true}cache(resident); refresh(); persist() },
    suspend: () => { if (selected) leave() },
    ownsMovement: (resident: Resident) => meeting || !!conversation?.pair.includes(resident) || drag?.resident === resident || falling.has(resident) || textureDialog.open,
    update: (delta: number) => {
      if (busy() || textureDialog.open) return
      if(conversation){
        conversation.age+=delta
        const [a,b]=conversation.pair
        for(const [r,other] of [[a,b],[b,a]]){r.direction.copy(other.normal).projectOnPlane(r.normal).normalize();if(r.direction.lengthSq()>.01)orient(r)}
        if(conversation.age>=3.4){conversation.age=0;conversation.line++;if(conversation.line>=conversation.lines.length)conversation=null;else speak()}
      }
      for (const [resident, trip] of trips) {
        trip.age += delta; const t = Math.min(1, trip.age / trip.duration), eased = t * t * (3 - 2 * t)
        const rotation = new THREE.Quaternion().setFromUnitVectors(trip.from, trip.to)
        resident.normal.copy(trip.from).applyQuaternion(new THREE.Quaternion().slerp(rotation, eased)).normalize()
        resident.radius = garden.radiusAt(resident.normal) + Math.sin(Math.PI * t) * 1.15
        resident.direction.copy(VILLAGE_CLEARING).addScaledVector(resident.normal, -VILLAGE_CLEARING.dot(resident.normal)).normalize()
        if (resident.direction.lengthSq() < .01) resident.direction.set(1, 0, 0).projectOnPlane(resident.normal).normalize()
        orient(resident)
        if (t === 1) { trips.delete(resident); if (!trips.size) { status.textContent = '주민들이 공터에 모두 모였어요.'; persist() } }
      }
      for (const [resident, age] of falling) {
        const time = age + delta; falling.set(resident, time)
        resident.root.position.copy(VILLAGE_HOLE).multiplyScalar(3.28 - time * .7); resident.root.scale.setScalar(.7 * Math.max(0, 1 - time / 1.1))
        if (time >= 1.1) { falling.delete(resident); trips.delete(resident); scene.remove(resident.root); resident.body.geometry.dispose(); texture(resident).dispose(); (resident.body.material as THREE.Material).dispose(); residents.splice(residents.indexOf(resident), 1); assets.delete(resident.id); originalTextures.delete(resident.id); refresh(); persist() }
      }
      if (selected && !drag) {
        const r = selected, damping = 1 - Math.exp(-delta * 4)
        target.copy(r.root.position).addScaledVector(r.normal, .32)
        desired.copy(r.root.position).addScaledVector(r.normal, 2.1).addScaledVector(r.direction, 1.6)
        camera.position.lerp(desired, damping); controls.target.lerp(target, damping); camera.up.lerp(r.normal, damping).normalize(); controls.enabled = false
      }
      saveTime += delta; if (saveTime > 15) { saveTime = 0; persist() }
    },
    dispose: () => { finishPaint(); persist(); disposed = true; events.abort(); ui.remove(); scene.remove(hole, label); rim.geometry.dispose(); rim.material.dispose(); opening.geometry.dispose(); opening.material.dispose(); label.material.map?.dispose(); label.material.dispose() },
  }
}
