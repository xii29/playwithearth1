import './example-gallery.css'
import { galleryPlaceholders } from './gallery-placeholders.ts'

// Static, code-drawn previews: the gallery never imports an example renderer.
const examples = [
  ['space', '마우스', '움직임을 따라 모이고 흩어지는 별빛', '#14142c'],
  ['typing', '타이핑 게임', '단어를 입력하고 쏟아지는 글자를 피하세요', '#ece9ff'],
  ['claw', '인형뽑기', '작은 인형을 향해, 조심스러운 한 번의 도전', '#f8dce9'],
  ['sampler', '샘플러', '목소리와 소리로 만드는 나만의 리듬', '#29283b'],
  ['hand', 'Lemonade', '손으로 레몬을 짜서 채우는 상큼한 한 잔', '#f4efbc'],
  ['water', 'WaterTouch', '손끝에서 번지는 물결', '#badce9'],
  ['balloon', 'Balloon', '잡고, 터뜨리고, 불어 보는 둥실둥실 풍선', '#e6eafb'],
  ['lab', 'lab', '손가락을 펼치면 피어나는 연꽃', '#173f3c'],
  ['rubber', '고무 인간', '당기면 늘어나고 놓으면 돌아오는 얼굴', '#e5d8f3'],
  ['shampoo', 'Shampoo', '거품을 만들고 샤워기로 씻어 보세요', '#d6edf2'],
  ['doodle', 'DoodleFace', '서로의 얼굴 위에 그리는 장난스러운 낙서', '#fff0d8'],
  ['travel', 'Effect', '픽셀과 빛, 색으로 새롭게 보는 화면', '#e0c8ee'],
  ['aquarium', 'Aquarium', '시선과 손끝에 반응하는 작은 수족관', '#102d55'],
  ['sniper', 'Sniper', '한쪽 눈을 감아 조준하고 눈을 떠서 발사', '#192c29'],
  ['earth', '동물의 숲', '별 사이 행성에서 함께 사는 동물 친구들', '#b4acd9'],
  ['money', 'MONEY RAIN', '몸과 손 위로 떨어지고 쌓이는 돈', '#355d43'],
  ['body-fx', 'BODY POINT CLOUD', 'Melted Spectrum FX · 검지와 중지 교차로 인물 투명화', '#281240'],
] as const

export function setupExampleGallery(root:HTMLElement,open:(name:string)=>void) {
  const items=[...examples.map(([id,title])=>({id,title,available:true})),...galleryPlaceholders.map(p=>({id:p.id,title:p.title,available:false}))]
  root.innerHTML=`<header class="gallery-heading"><p>Scroll up/down</p></header><div class="clock-gallery" aria-label="전체 예제 번호 메뉴">${items.map((item,i)=>`<button class="clock-number" data-slot="${i}" data-gallery-example="${item.id}" aria-label="${item.title} ${item.available ? '예제 열기' : '준비 중'}" aria-pressed="false"><span>${i+1}</span></button>`).join('')}<button class="gallery-open" aria-label="선택한 예제 열기"></button></div><footer class="gallery-footer"><span class="gallery-count"></span><button data-turn="-1" aria-label="이전 예제">←</button><button data-turn="1" aria-label="다음 예제">→</button></footer>`
  const numbers=[...root.querySelectorAll<HTMLButtonElement>('.clock-number')],launch=root.querySelector<HTMLButtonElement>('.gallery-open')!,count=root.querySelector<HTMLElement>('.gallery-count')!,abort=new AbortController(),{signal}=abort,reduced=matchMedia('(prefers-reduced-motion: reduce)')
  let value=0,target=0,selected=0,raf=0,previous=0,disposed=false,exiting=false,timer=0,touch:number|null=null,dragged=false
  let radiusX=1,radiusY=1
  let width=1,height=1
  const sizes=numbers.map(()=>({width:32,height:32,maxScale:1}))
  const orbit=root.querySelector<HTMLElement>('.clock-gallery')!
  const mod=(n:number)=>((n%items.length)+items.length)%items.length
  const select=(i:number)=>{numbers[selected]?.setAttribute('aria-pressed','false');selected=mod(i);numbers[selected]?.setAttribute('aria-pressed','true');launch.textContent=items[selected].title;launch.disabled=!items[selected].available;launch.setAttribute('aria-label',items[selected].title+' 예제 열기');count.textContent=(selected+1)+' / '+items.length}
  const paint=(spread=1)=>{
    numbers.forEach((button,i)=>{
      const angle=(i-value)/items.length*Math.PI*2
      // Perspective spacing opens the near arc and compresses the distant arc.
      const a=2*Math.atan2(3*Math.sin(angle*.5),Math.cos(angle*.5))
      // Continuous orbital depth: right is near, left is far. No duplicate glyph.
      const depth=(Math.cos(a)+1)*.5,size=sizes[i]
      const scale=.45+.55*depth+(size.maxScale-1)*Math.pow(depth,20)
      const limitX=Math.max(0,width*.5-size.width*scale*.6-10)
      const limitY=Math.max(0,height*.5-size.height*scale*.6-10)
      const x=Math.max(-limitX,Math.min(limitX,Math.cos(a)*radiusX))
      const y=Math.max(-limitY,Math.min(limitY,Math.sin(a)*radiusY))
      button.style.transform=`translate(-50%,-50%) translate3d(${x*spread}px,${y*spread}px,0) scale(${scale})`
      button.style.zIndex=String(1+Math.round(depth*100))
      button.style.setProperty('--outline',`${1.2/scale}px`)
    })
  }
  const resize=new ResizeObserver(()=>{
    width=orbit.clientWidth;height=orbit.clientHeight
    radiusX=Math.min(width*.38,520);radiusY=height*.39
    const perimeter=Math.PI*(3*(radiusX+radiusY)-Math.sqrt((3*radiusX+radiusY)*(radiusX+3*radiusY)))
    orbit.style.setProperty('--number-size',Math.max(16,Math.min(56,perimeter/items.length*.48))+'px')
    numbers.forEach((button,i)=>{
      const span=button.firstElementChild as HTMLElement
      const w=span.offsetWidth||1,h=span.offsetHeight||1
      sizes[i]={width:w,height:h,maxScale:Math.min(width*.46/w,height*.72/h)}
    })
    if(!exiting)paint()
  })
  resize.observe(orbit)
  const tick=(stamp:number)=>{
    raf=0;if(disposed||document.hidden)return
    const dt=previous?Math.min(50,stamp-previous):16;previous=stamp;value+=(target-value)*(1-Math.exp(-dt/140))
    if(Math.abs(target-value)<.001){value=target;previous=0;delete root.dataset.moving}else{raf=requestAnimationFrame(tick);root.dataset.moving='true'}
    paint()
  }
  const turn=(d:number)=>{if(exiting)return;target+=d;select(Math.round(target));if(reduced.matches){value=target;paint()}else if(!raf)raf=requestAnimationFrame(tick)}
  const enter=(i:number)=>{
    if(disposed||exiting)return;select(i);if(!items[selected].available)return
    exiting=true;root.dataset.exiting='true';cancelAnimationFrame(raf);delete root.dataset.moving
    paint(1.5)
    const id=items[selected].id
    if(reduced.matches){open(id);return}
    timer=window.setTimeout(()=>{if(!disposed)open(id)},420)
  }
  numbers.forEach((button,i)=>{
    button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')select(i)},{signal})
    button.addEventListener('focus',()=>select(i),{signal})
    button.addEventListener('click',e=>{if(!dragged||e.detail===0)enter(i)},{signal})
  })
  launch.addEventListener('click',()=>enter(selected),{signal})
  root.addEventListener('wheel',e=>{e.preventDefault();turn(Math.max(-2,Math.min(2,(e.deltaY||e.deltaX)*(e.deltaMode===1?16:1)/180)))},{passive:false,signal})
  root.querySelectorAll<HTMLButtonElement>('[data-turn]').forEach(b=>b.addEventListener('click',()=>turn(Number(b.dataset.turn)),{signal}))
  root.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();turn(1)}if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();turn(-1)}},{signal})
  root.addEventListener('pointerdown',e=>{dragged=false;if(e.pointerType==='touch')touch=e.clientY},{signal})
  root.addEventListener('pointermove',e=>{if(touch===null)return;const delta=touch-e.clientY;if(Math.abs(delta)<6&&!dragged)return;dragged=true;touch=e.clientY;turn(delta/70)},{signal})
  window.addEventListener('pointerup',()=>{touch=null},{signal});window.addEventListener('pointercancel',()=>{touch=null},{signal})
  document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);raf=0;previous=0;value=target;paint()},{signal})
  select(0);paint()
  return()=>{disposed=true;abort.abort();resize.disconnect();cancelAnimationFrame(raf);clearTimeout(timer);delete root.dataset.exiting;delete root.dataset.moving}
}
