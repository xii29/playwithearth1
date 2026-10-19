import './guestbook.css'

type Point = { x: number; y: number }
type Stroke = { points: Point[]; color: string; width: number; erase: boolean }
type Decoration = { icon: string; x: number; y: number; element: HTMLButtonElement }
type Card = { element: HTMLElement; body: HTMLElement; text: HTMLTextAreaElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; color: string; ink: string; strokes: Stroke[]; stickers: Decoration[] }
type Mode = 'text' | 'pen' | 'eraser'
const palette = [['#ffffff','흰색'],['#f7e8c6','크림'],['#f3cddd','분홍'],['#d8dfed','하늘'],['#dce5cc','연두'],['#ddd3ee','라벤더']] as const

export function setupGuestbook(root: HTMLElement) {
  root.innerHTML = `<header class="card-header"><a href="#home">← 뒤로가기</a><button class="card-add" type="button">+ 빈 카드</button></header>
    <div class="card-scene" aria-label="스크롤로 회전하는 방명록 카드"><div class="card-ring"></div></div>
    <div class="card-navigation"><button type="button" data-turn="-1" aria-label="이전 카드">←</button><span class="card-count" aria-live="polite"></span><button type="button" data-turn="1" aria-label="다음 카드">→</button></div>
    <section class="card-tools" aria-label="카드 꾸미기">
      <div class="card-tool-row"><div class="card-modes" role="group" aria-label="작성 도구"><button type="button" data-mode="text" aria-pressed="true">글쓰기</button><button type="button" data-mode="pen" aria-pressed="false">펜</button><button type="button" data-mode="eraser" aria-pressed="false">지우개</button></div><label class="card-ink-label">잉크 <input class="card-ink" type="color" value="#282828" aria-label="글씨와 펜 색상"></label><label class="card-width-label">굵기 <input class="card-width" type="range" min="2" max="18" value="4" aria-label="펜 굵기"></label><button class="card-undo" type="button">획 되돌리기</button><button class="card-clear" type="button">그림 지우기</button></div>
      <div class="card-tool-row"><div class="card-colors" role="group" aria-label="카드 색상">${palette.map(([color,label])=>`<button type="button" data-color="${color}" style="--swatch:${color}" aria-label="${label} 카드" aria-pressed="${color === '#ffffff'}"></button>`).join('')}</div><div class="card-stickers" role="group" aria-label="스티커">${[['🌼','꽃'],['❤️','하트'],['⭐','별'],['🎀','리본'],['🦋','나비'],['🌈','무지개']].map(([icon,label])=>`<button type="button" data-sticker="${icon}" aria-label="${label} 스티커">${icon}</button>`).join('')}<button type="button" class="card-stickers-clear" aria-label="스티커 모두 지우기">×</button></div></div>
    </section><p class="card-hint" role="status">카드에 글을 쓰거나 펜으로 그려 보세요. 스크롤하면 카드가 돌아가요.</p>`
  const abort = new AbortController(), { signal } = abort
  const scene = root.querySelector<HTMLElement>('.card-scene')!, ring = root.querySelector<HTMLElement>('.card-ring')!
  const count = root.querySelector<HTMLElement>('.card-count')!, hint = root.querySelector<HTMLElement>('.card-hint')!
  const ink = root.querySelector<HTMLInputElement>('.card-ink')!, width = root.querySelector<HTMLInputElement>('.card-width')!
  const undo = root.querySelector<HTMLButtonElement>('.card-undo')!, clear = root.querySelector<HTMLButtonElement>('.card-clear')!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const cards: Card[] = []
  let selected = 0, target = 0, rotation = 0, frame = 0, previous = 0, mode: Mode = 'text', drawing: { card: Card; stroke: Stroke; pointer: number } | null = null
  let wheelTotal = 0, wheelAt = 0, lastTurn = -Infinity, radius = 320
  const active = () => cards[selected]!
  const mod = (n: number) => (n % cards.length + cards.length) % cards.length
  const paint = () => {
    ring.style.transform = `translateZ(${-radius}px) rotateY(${-rotation * 360 / cards.length}deg)`
    cards.forEach((card,i) => {
      const angle = ((i-rotation)*360/cards.length%360+540)%360-180
      // Turn the near cards gently toward the viewer so their faces stay legible.
      const tilt = -angle*.6*Math.max(0,1-Math.max(0,Math.abs(angle)-80)/55)
      card.element.style.transform = `translate(-50%,-50%) rotateY(${i*360/cards.length}deg) translateZ(${radius}px) rotateY(${tilt}deg)`
    })
  }
  const updateTools = () => {
    if (!cards.length) return
    root.querySelectorAll<HTMLElement>('[data-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === active().color)))
    undo.disabled = clear.disabled = active().strokes.length === 0
    ink.value = active().ink
    count.textContent = `${selected + 1} / ${cards.length}`
    cards.forEach((card,i) => {
      card.element.dataset.active = String(i === selected)
      card.body.inert = i !== selected
      card.element.querySelector<HTMLButtonElement>('.card-select')!.hidden = i === selected
      card.text.tabIndex = i === selected && mode === 'text' ? 0 : -1
    })
  }
  const renderStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = ctx.fillStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.lineCap = ctx.lineJoin = 'round'
    const first = stroke.points[0]
    if (!first) return
    ctx.beginPath(); ctx.moveTo(first.x,first.y)
    if (stroke.points.length === 1) { ctx.arc(first.x,first.y,stroke.width / 2,0,Math.PI*2); ctx.fill() }
    else { for (const p of stroke.points.slice(1)) ctx.lineTo(p.x,p.y); ctx.stroke() }
  }
  const redraw = (card: Card) => { card.context.clearRect(0,0,600,800); card.strokes.forEach(s => renderStroke(card.context,s)); card.context.globalCompositeOperation = 'source-over' }
  const finishDrawing = () => { drawing = null; updateTools() }
  const tick = (time: number) => {
    const dt = previous ? Math.min(50,time-previous) : 16; previous = time
    rotation += (target-rotation)*(1-Math.exp(-dt/95)); paint()
    if (Math.abs(target-rotation) > .001) frame = requestAnimationFrame(tick)
    else { rotation = target; paint(); frame = previous = 0; delete root.dataset.rotating }
  }
  const turn = (steps: number) => {
    if (drawing) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && scene.contains(focused)) focused.blur()
    target += steps; selected = mod(Math.round(target)); updateTools()
    if (reduced.matches) { rotation = target; paint() }
    else { root.dataset.rotating = 'true'; if (!frame) frame = requestAnimationFrame(tick) }
  }
  const layout = () => {
    radius = Math.max(scene.clientWidth < 600 ? 230 : 340, cards.length * (scene.clientWidth < 600 ? 42 : 58))
    paint()
  }
  const createCard = () => {
    const element = document.createElement('article'); element.className = 'guest-card'; element.dataset.cardIndex = String(cards.length)
    element.setAttribute('aria-label', `${cards.length+1}번 카드`)
    element.innerHTML = `<div class="card-back" aria-hidden="true"></div><div class="card-body"><textarea class="card-text" aria-label="카드 글쓰기" maxlength="800" spellcheck="false"></textarea><canvas class="card-drawing" width="600" height="800" aria-label="마우스 또는 터치로 손글씨 쓰기"></canvas><div class="card-decoration-layer"></div></div><button class="card-select" type="button" aria-label="${cards.length+1}번 카드 선택"></button>`
    const canvas = element.querySelector<HTMLCanvasElement>('canvas')!
    const card: Card = { element, body:element.querySelector('.card-body')!, text:element.querySelector('textarea')!, canvas, context:canvas.getContext('2d')!, color:'#ffffff', ink:'#282828', strokes:[], stickers:[] }
    const index = cards.length; cards.push(card); ring.append(element)
    element.querySelector('.card-select')!.addEventListener('click', () => { let delta = index-selected; if (delta>cards.length/2) delta-=cards.length; if(delta < -cards.length/2) delta+=cards.length; turn(delta) }, { signal })
    const point = (e: PointerEvent): Point => { const rect=canvas.getBoundingClientRect(); return { x:Math.max(0,Math.min(600,(e.clientX-rect.left)/rect.width*600)), y:Math.max(0,Math.min(800,(e.clientY-rect.top)/rect.height*800)) } }
    canvas.addEventListener('pointerdown', e => {
      if (mode === 'text' || index !== selected || frame || e.button !== 0) return
      e.preventDefault(); canvas.setPointerCapture(e.pointerId)
      const stroke: Stroke = { points:[point(e)], color:ink.value, width:Number(width.value)*(mode==='eraser'?4:1), erase:mode==='eraser' }
      card.strokes.push(stroke); drawing={card,stroke,pointer:e.pointerId}; redraw(card)
    }, { signal })
    canvas.addEventListener('pointermove', e => {
      if (!drawing || drawing.card!==card || drawing.pointer!==e.pointerId) return
      const events=e.getCoalescedEvents?.()
      for(const event of events?.length ? events : [e]) drawing.stroke.points.push(point(event))
      redraw(card)
    }, { signal })
    canvas.addEventListener('pointerup',finishDrawing,{signal}); canvas.addEventListener('pointercancel',finishDrawing,{signal}); canvas.addEventListener('lostpointercapture',finishDrawing,{signal})
    return card
  }
  for(let i=0;i<5;i++) createCard()
  root.dataset.mode = mode; layout(); updateTools()
  const observer = new ResizeObserver(layout); observer.observe(scene)
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    finishDrawing(); mode=button.dataset.mode as Mode; root.dataset.mode=mode
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)))
    updateTools(); if(mode==='text') active().text.focus({preventScroll:true})
  },{signal}))
  root.querySelectorAll<HTMLElement>('[data-color]').forEach(button=>button.addEventListener('click',()=>{
    active().color=button.dataset.color!; active().element.style.setProperty('--paper',active().color); updateTools()
  },{signal}))
  ink.addEventListener('input',()=>{ active().ink=ink.value; active().text.style.color=ink.value },{signal})
  undo.addEventListener('click',()=>{active().strokes.pop();redraw(active());updateTools()},{signal})
  clear.addEventListener('click',()=>{active().strokes=[];redraw(active());updateTools()},{signal})
  root.querySelector('.card-add')!.addEventListener('click',()=>{
    finishDrawing(); cancelAnimationFrame(frame);frame=previous=0;delete root.dataset.rotating
    createCard();selected=cards.length-1;target=rotation=selected;layout();updateTools()
  },{signal})
  root.querySelectorAll<HTMLElement>('[data-turn]').forEach(button=>button.addEventListener('click',()=>turn(Number(button.dataset.turn)),{signal}))
  scene.addEventListener('wheel',e=>{
    const text=(e.target as HTMLElement).closest('textarea')
    if (text && document.activeElement===text && text.scrollHeight>text.clientHeight) return
    e.preventDefault();if(drawing)return
    const now=performance.now();if(now-wheelAt>200)wheelTotal=0;wheelAt=now
    wheelTotal+=(e.deltaY||e.deltaX)*(e.deltaMode===1?16:e.deltaMode===2?scene.clientHeight:1)
    if(Math.abs(wheelTotal)>=45&&now-lastTurn>200){turn(wheelTotal>0?1:-1);wheelTotal=0;lastTurn=now}
  },{passive:false,signal})
  root.addEventListener('keydown',e=>{
    if((e.target as HTMLElement).closest('textarea,input,.card-decoration'))return
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();turn(e.key==='ArrowRight'?1:-1)}
  },{signal})
  let swipe: { x:number; id:number } | null = null
  scene.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&e.target===scene)swipe={x:e.clientX,id:e.pointerId}},{signal})
  scene.addEventListener('pointerup',e=>{if(swipe?.id===e.pointerId&&Math.abs(e.clientX-swipe.x)>40)turn(e.clientX<swipe.x?1:-1);swipe=null},{signal})
  root.querySelectorAll<HTMLElement>('[data-sticker]').forEach(button=>button.addEventListener('click',()=>{
    const card=active(); if(card.stickers.length>=16){hint.textContent='한 카드에 스티커는 16개까지 붙일 수 있어요.';return}
    const element=document.createElement('button');element.type='button';element.className='card-decoration';element.textContent=button.dataset.sticker!
    element.setAttribute('aria-label',`${button.getAttribute('aria-label')} · 방향키로 이동, Delete로 삭제`)
    const sticker:Decoration={icon:element.textContent,x:.25+(card.stickers.length%3)*.22,y:.22+Math.floor(card.stickers.length%9/3)*.25,element}
    card.stickers.push(sticker);card.element.querySelector('.card-decoration-layer')!.append(element)
    const position=()=>{element.style.left=`${sticker.x*100}%`;element.style.top=`${sticker.y*100}%`};position()
    let moving=false
    element.addEventListener('pointerdown',e=>{if(frame)return;e.preventDefault();moving=true;element.setPointerCapture(e.pointerId);element.focus({preventScroll:true})},{signal})
    element.addEventListener('pointermove',e=>{if(!moving)return;const rect=card.body.getBoundingClientRect();sticker.x=Math.max(.08,Math.min(.92,(e.clientX-rect.left)/rect.width));sticker.y=Math.max(.06,Math.min(.94,(e.clientY-rect.top)/rect.height));position()},{signal})
    element.addEventListener('pointerup',()=>{moving=false},{signal});element.addEventListener('pointercancel',()=>{moving=false},{signal})
    element.addEventListener('keydown',e=>{
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();element.remove();card.stickers=card.stickers.filter(s=>s!==sticker);return}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return
      e.preventDefault();sticker.x=Math.max(.08,Math.min(.92,sticker.x+(e.key==='ArrowLeft'?-.03:e.key==='ArrowRight'?.03:0)));sticker.y=Math.max(.06,Math.min(.94,sticker.y+(e.key==='ArrowUp'?-.03:e.key==='ArrowDown'?.03:0)));position()
    },{signal})
    hint.textContent='스티커를 끌어서 옮기고, 선택 후 Delete로 지울 수 있어요.'
  },{signal}))
  root.querySelector('.card-stickers-clear')!.addEventListener('click',()=>{active().stickers.forEach(s=>s.element.remove());active().stickers=[]},{signal})
  document.addEventListener('visibilitychange',()=>{if(document.hidden){finishDrawing();cancelAnimationFrame(frame);frame=previous=0;rotation=target;paint();delete root.dataset.rotating}},{signal})
  return()=>{abort.abort();observer.disconnect();cancelAnimationFrame(frame);cards.length=0}
}
