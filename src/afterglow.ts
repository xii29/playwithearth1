type Spark={x:number;y:number;vx:number;vy:number;life:number;max:number;color:number;gravity:number;tail:number;seed:number;silver:boolean}
type Joint={x:number;y:number}
const colors=['#ffce66','#ff6aab','#76eaff','#b299ff','#9bffa0','#ffffff']
const tapSin=Float64Array.from({length:25},(_,i)=>Math.sin(i*1.9)),tapCos=Float64Array.from({length:25},(_,i)=>Math.cos(i*1.9))
const effectCanvas=()=>typeof document==='undefined'?new OffscreenCanvas(1,1) as unknown as HTMLCanvasElement:document.createElement('canvas')
export const fireworkTypes=['random','peony','ring','willow','heart','spiral'] as const
export class Afterglow {
  private sparks:Spark[]=[]
  private flashes:{x:number;y:number;life:number}[]=[]
  private aspect=1
  private layer=effectCanvas()
  private ctx=this.layer.getContext('2d')!
  private maskCanvas=effectCanvas()
  private mc=this.maskCanvas.getContext('2d')!
  private maskImage:ImageData|null=null
  private lastFire=new Map<string,number>()
  private handStates=new Map<string,{x:number;y:number;since:number;pinched:boolean}>()
  private trailX=new Float64Array(25)
  private trailY=new Float64Array(25)
  private glows=colors.map(color=>{
    const canvas=effectCanvas();canvas.width=canvas.height=32
    const c=canvas.getContext('2d')!,gradient=c.createRadialGradient(16,16,0,16,16,16)
    gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.12,color);gradient.addColorStop(.4,color+'70');gradient.addColorStop(1,color+'00')
    c.fillStyle=gradient;c.fillRect(0,0,32,32);return canvas
  })
  type:string='random'
  reset(){this.sparks.length=0;this.flashes.length=0;this.handStates.clear();this.lastFire.clear()}
  setMask(mask:Float32Array,w:number,h:number){
    this.aspect=w/Math.max(1,h)
    if(this.maskCanvas.width!==w||this.maskCanvas.height!==h||!this.maskImage){this.maskCanvas.width=w;this.maskCanvas.height=h;this.maskImage=this.mc.createImageData(w,h)}
    const p=this.maskImage.data
    for(let i=0;i<mask.length;i++){p[i*4+3]=Math.round(mask[i]*255)}
    this.mc.putImageData(this.maskImage,0,0)
  }
  burst(x:number,y:number,stamp:number,source='pointer'){
    if(stamp-(this.lastFire.get(source)??-Infinity)<300)return
    this.lastFire.set(source,stamp)
    const choices=['peony','peony','peony','willow','willow','ring','heart','spiral']
    const type=this.type==='random'?choices[Math.floor(Math.random()*choices.length)]:this.type
    const color=type==='willow'?0:Math.floor(Math.random()*colors.length),count=type==='willow'?240:type==='peony'?210:150
    if(this.flashes.length>=12)this.flashes.shift()
    this.flashes.push({x,y,life:.22})
    // Fixed upper bound; discard oldest sparks before accepting a new burst.
    if(this.sparks.length+count>2000)this.sparks.splice(0,this.sparks.length+count-2000)
    for(let i=0;i<count;i++){
      const a=i/count*Math.PI*2+(Math.random()-.5)*.015,r=type==='ring'?1:Math.sqrt(Math.random()),speed=.07+r*.24
      let vx=Math.cos(a)*speed,vy=Math.sin(a)*speed
      if(type==='heart'){vx=16*Math.sin(a)**3*.016;vy=-(13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a))*.016}
      if(type==='spiral'){vx=Math.cos(a*3)*(.04+i/count*.3);vy=Math.sin(a*3)*(.04+i/count*.3)}
      if(type==='willow'){vx*=.85;vy=vy*.6-.12}
      const axis=Math.min(1,this.aspect);vx*=axis/this.aspect;vy*=axis
      const silver=type==='willow'&&Math.random()<.75
      const tint=silver?5:type==='spiral'||(type==='peony'&&Math.random()<.7)?i%colors.length:color
      const life=type==='willow'?3.4+Math.random()*1.1:2.6+Math.random()
      this.sparks.push({x,y,vx,vy,life,max:life,color:tint,gravity:(type==='willow'?.12:.17)*axis,tail:type==='willow'?1.65:1.1+Math.random()*.3,seed:Math.random()*100,silver})
    }
  }
  hands(hands:Joint[][],stamp:number,ids:string[]=[]){
    const seen=new Set<string>()
    hands.slice(0,6).forEach((h,i)=>{
      if(h.length<21)return
      const label=ids[i]||String(i),id=ids.filter(v=>v===label).length>1?`${label}-${i}`:label,tip=h[8],pinch=Math.hypot(tip.x-h[4].x,tip.y-h[4].y)<.045
      seen.add(id)
      let state=this.handStates.get(id)
      if(pinch&&!state?.pinched)this.burst(tip.x,tip.y,stamp,id)
      if(!state||Math.hypot(tip.x-state.x,tip.y-state.y)>.035){
        state={...tip,since:stamp,pinched:pinch};this.handStates.set(id,state)
      }else if(stamp-state.since>650){this.burst(tip.x,tip.y,stamp,id);state.since=stamp+250}
      state.pinched=pinch
    })
    for(const id of this.handStates.keys())if(!seen.has(id))this.handStates.delete(id)
  }
  draw(target:CanvasRenderingContext2D,w:number,h:number,dt:number,clearBackground=true){
    const scale=Math.min(1,1280/w,1280/h),rw=Math.max(1,Math.round(w*scale)),rh=Math.max(1,Math.round(h*scale))
    if(this.layer.width!==rw||this.layer.height!==rh){this.layer.width=rw;this.layer.height=rh}
    const c=this.ctx;c.clearRect(0,0,rw,rh);c.lineWidth=1.4;c.globalCompositeOperation='lighter'
    for(let i=this.sparks.length-1;i>=0;i--){
      const s=this.sparks[i];s.life-=dt;if(s.life<=0){this.sparks[i]=this.sparks[this.sparks.length-1];this.sparks.pop();continue}
      // Reconstruct a time-based parabola rather than a frame-count trail:
      // tail length and curvature remain stable at different rendering rates.
      s.x+=s.vx*dt;s.y+=s.vy*dt+.5*s.gravity*dt*dt;s.vy+=s.gravity*dt
      const age=s.max-s.life,fade=Math.min(1,s.life/.95)**1.5
      const tail=Math.min(age,s.tail),dissolve=Math.max(0,Math.min(1,(age/s.max-.48)/.38))
      const segments=24
      const xs=this.trailX,ys=this.trailY
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
      for(let tap=0;tap<=segments;tap++){
        const back=tail*tap/segments
        const x=(s.x-s.vx*back)*rw,y=(s.y-s.vy*back+.5*s.gravity*back*back)*rh
        xs[tap]=x;ys[tap]=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)
      }
      // Advance all sparks, but skip draw calls for fully offscreen trails.
      if(maxX< -16||minX>rw+16||maxY< -16||minY>rh+16)continue
      c.strokeStyle=colors[s.color]
      // Three tapered bands keep a soft, dim origin and a bright leading edge.
      for(let band=0;band<3;band++){
        c.beginPath()
        for(let j=0;j<=8;j++){
          const tap=segments-band*8-j,x=xs[tap],y=ys[tap]
          if(j===0)c.moveTo(x,y);else c.lineTo(x,y)
        }
        const strength=fade*(.16+band*.27)*(1-dissolve*.92)
        c.globalAlpha=strength*.24;c.lineWidth=2.6*scale;c.stroke()
        c.globalAlpha=strength;c.lineWidth=.7*scale;c.stroke()
      }
      // Silver willows and aging sparks break into dotted, twinkling cascades.
      const dotMix=s.silver?.75+.25*dissolve:dissolve
      if(dotMix>0){
        const phase=s.seed+age*8,sin=Math.sin(phase),cos=Math.cos(phase)
        c.fillStyle=s.silver?'#fff9df':colors[s.color]
        for(let tap=1;tap<=segments;tap++){
          const glint=.25+.75*(sin*tapCos[tap]-cos*tapSin[tap])**2
          c.globalAlpha=fade*dotMix*glint*(1-tap/segments*.7)
          const x=xs[tap],y=ys[tap]
          const size=(.65+glint*.65)*scale;c.fillRect(x-size/2,y-size/2,size,size)
        }
      }
      const twinkle=.5+.5*Math.sin(age*9+s.seed)**2,px=s.x*rw,py=s.y*rh
      const size=(7+5*(1-age/s.max))*scale
      c.globalAlpha=fade*twinkle;c.drawImage(this.glows[s.color],px-size/2,py-size/2,size,size)
      c.fillStyle='#fff9e9';c.beginPath();c.arc(px,py,.7*scale,0,Math.PI*2);c.fill()
    }
    for(let i=this.flashes.length-1;i>=0;i--){
      const flash=this.flashes[i];flash.life-=dt
      if(flash.life<=0){this.flashes.splice(i,1);continue}
      const size=(18+(1-flash.life/.22)*40)*scale
      c.globalAlpha=(flash.life/.22)**2*.7
      c.drawImage(this.glows[5],flash.x*rw-size/2,flash.y*rh-size/2,size,size)
    }
    c.globalAlpha=1;c.globalCompositeOperation='destination-out'
    c.drawImage(this.maskCanvas,0,0,rw,rh);c.globalCompositeOperation='source-over'
    if(clearBackground){target.fillStyle='#000';target.fillRect(0,0,w,h)}target.drawImage(this.layer,0,0,w,h)
    for(const aim of this.handStates.values()){target.strokeStyle='#ffffff88';target.lineWidth=1;target.beginPath();target.arc(aim.x*w,aim.y*h,8,0,Math.PI*2);target.stroke()}
  }
}
export function afterglowTemplate(){return `<main class="body-example afterglow-example example-view"><video id="body-camera" autoplay muted playsinline aria-hidden="true"></video><canvas id="body-canvas" aria-label="손끝으로 만드는 불꽃놀이"></canvas><header class="fireworks-heading"><span>불꽃놀이 · LIGHT UP THE NIGHT</span><h1>FIREWORKS<i aria-hidden="true">✧</i></h1></header><div class="fireworks-glimmers" aria-hidden="true"><i>✧</i><i>✦</i><i>✧</i></div><button id="body-camera-toggle">카메라 켜기</button><details class="afterglow-panel" open><summary>불꽃놀이 설정</summary><label>종류 <select id="firework-type"><option value="random">랜덤</option><option value="peony">꽃송이</option><option value="ring">링</option><option value="willow">황금 버드나무</option><option value="heart">하트</option><option value="spiral">스파이럴</option></select></label><button id="firework-clear">불꽃 지우기</button></details><p id="body-status" role="status" hidden></p></main>`}
