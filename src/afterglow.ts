type Spark={x:number;y:number;vx:number;vy:number;life:number;max:number;color:number;drag:number}
type Joint={x:number;y:number}
const colors=['#ffce66','#ff6aab','#76eaff','#b299ff','#9bffa0','#ffffff']
export const fireworkTypes=['random','peony','ring','willow','heart','spiral'] as const
export class Afterglow {
  private sparks:Spark[]=[]
  private layer=document.createElement('canvas')
  private ctx=this.layer.getContext('2d')!
  private maskCanvas=document.createElement('canvas')
  private mc=this.maskCanvas.getContext('2d')!
  private maskImage:ImageData|null=null
  private lastFire=-Infinity
  private aim:{x:number;y:number;since:number}|null=null
  private pinched=false
  type:string='random'
  reset(){this.sparks.length=0;this.aim=null;this.pinched=false;this.lastFire=-Infinity}
  setMask(mask:Float32Array,w:number,h:number){
    if(this.maskCanvas.width!==w||this.maskCanvas.height!==h||!this.maskImage){this.maskCanvas.width=w;this.maskCanvas.height=h;this.maskImage=this.mc.createImageData(w,h)}
    const p=this.maskImage.data
    for(let i=0;i<mask.length;i++){p[i*4+3]=Math.round(mask[i]*255)}
    this.mc.putImageData(this.maskImage,0,0)
  }
  burst(x:number,y:number,stamp:number){
    if(stamp-this.lastFire<300)return
    this.lastFire=stamp
    const type=this.type==='random'?fireworkTypes[1+Math.floor(Math.random()*5)]:this.type
    const color=type==='willow'?0:Math.floor(Math.random()*colors.length),count=type==='willow'?170:120
    // Fixed upper bound; discard oldest sparks before accepting a new burst.
    if(this.sparks.length+count>2000)this.sparks.splice(0,this.sparks.length+count-2000)
    for(let i=0;i<count;i++){
      const a=i/count*Math.PI*2,r=type==='ring'?1:Math.sqrt(Math.random()),speed=.12+r*.2
      let vx=Math.cos(a)*speed,vy=Math.sin(a)*speed
      if(type==='heart'){vx=16*Math.sin(a)**3*.016;vy=-(13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a))*.016}
      if(type==='spiral'){vx=Math.cos(a*3)*(.04+i/count*.3);vy=Math.sin(a*3)*(.04+i/count*.3)}
      if(type==='willow'){vx*=.65;vy=vy*.6-.1}
      const life=type==='willow'?3.5:1.7+Math.random()*.8
      this.sparks.push({x,y,vx,vy,life,max:life,color:type==='spiral'?i%colors.length:color,drag:type==='willow'?.8:1.15})
    }
  }
  hands(hands:Joint[][],stamp:number){
    const h=hands.find(h=>h.length>=21)
    if(!h){this.aim=null;this.pinched=false;return}
    const tip=h[8],pinch=Math.hypot(tip.x-h[4].x,tip.y-h[4].y)<.045
    if(pinch&&!this.pinched)this.burst(tip.x,tip.y,stamp)
    this.pinched=pinch
    if(!this.aim||Math.hypot(tip.x-this.aim.x,tip.y-this.aim.y)>.035)this.aim={...tip,since:stamp}
    else if(stamp-this.aim.since>650){this.burst(tip.x,tip.y,stamp);this.aim.since=stamp+250}
  }
  draw(target:CanvasRenderingContext2D,w:number,h:number,dt:number){
    const scale=Math.min(1,1280/w,1280/h),rw=Math.max(1,Math.round(w*scale)),rh=Math.max(1,Math.round(h*scale))
    if(this.layer.width!==rw||this.layer.height!==rh){this.layer.width=rw;this.layer.height=rh}
    const c=this.ctx;c.clearRect(0,0,rw,rh);c.lineWidth=1.4
    for(let i=this.sparks.length-1;i>=0;i--){
      const s=this.sparks[i];s.life-=dt;if(s.life<=0){this.sparks[i]=this.sparks[this.sparks.length-1];this.sparks.pop();continue}
      const x=s.x,y=s.y;s.vx*=Math.exp(-dt*s.drag);s.vy=s.vy*Math.exp(-dt*s.drag)+dt*.065;s.x+=s.vx*dt;s.y+=s.vy*dt
      c.globalAlpha=Math.min(1,s.life/.6);c.strokeStyle=colors[s.color];c.beginPath();c.moveTo((x-s.vx*.06)*rw,(y-s.vy*.06)*rh);c.lineTo(s.x*rw,s.y*rh);c.stroke()
    }
    c.globalAlpha=1;c.globalCompositeOperation='destination-out'
    c.drawImage(this.maskCanvas,0,0,rw,rh);c.globalCompositeOperation='source-over'
    target.fillStyle='#000';target.fillRect(0,0,w,h);target.drawImage(this.layer,0,0,w,h)
    if(this.aim){target.strokeStyle='#ffffff88';target.lineWidth=1;target.beginPath();target.arc(this.aim.x*w,this.aim.y*h,8,0,Math.PI*2);target.stroke()}
  }
}
export function afterglowTemplate(){return `<main class="body-example afterglow-example example-view"><video id="body-camera" autoplay muted playsinline aria-hidden="true"></video><canvas id="body-canvas" aria-label="손끝으로 만드는 불꽃놀이"></canvas><button id="body-camera-toggle">카메라 켜기</button><details class="afterglow-panel" open><summary>불꽃놀이 설정</summary><label>종류 <select id="firework-type"><option value="random">랜덤</option><option value="peony">꽃송이</option><option value="ring">링</option><option value="willow">황금 버드나무</option><option value="heart">하트</option><option value="spiral">스파이럴</option></select></label><button id="firework-clear">불꽃 지우기</button><p>원하는 곳을 클릭·터치하거나, 검지로 가리켜 잠시 멈추세요. 검지와 엄지를 집어도 터집니다.</p></details><div class="body-guide"><p id="body-status" role="status">카메라를 준비하고 있어요…</p><small>검정 배경 · 불꽃은 사람 실루엣 뒤로 가려집니다.</small></div></main>`}
