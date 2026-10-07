export type Joint={x:number;y:number}
export type Catcher={x:number;y:number;width:number;id?:string;points?:Joint[]}
type Bill={x:number;y:number;vx:number;vy:number;angle:number;catcher:number;catcherId?:string;offset:number;level:number;gold?:boolean}
export function moneyCatchers(hands:Joint[][],ids:string[]=[]):Catcher[]{
  const out:Catcher[]=[]
  for(const [index,h] of hands.entries()){
    if(h.length<21)continue
    // Upper envelope of every joint fills the enclosed finger/palm spaces,
    // including curled hands. Keep identity when two hands touch.
    const points=h.map(p=>({...p})).sort((a,b)=>a.x-b.x||a.y-b.y),upper:Joint[]=[]
    for(const p of points){while(upper.length>1){const a=upper[upper.length-2],b=upper[upper.length-1];if((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>0)break;upper.pop()}upper.push(p)}
    const left=points[0].x-.018,right=points[points.length-1].x+.018
    out.push({x:(left+right)/2,y:Math.min(...h.map(p=>p.y)),width:right-left,id:ids[index]||String(index),points:[{x:left,y:upper[0].y},...upper,{x:right,y:upper[upper.length-1].y}]})
  }
  return out
}
// Measure fingertip motion relative to the palm, so moving a pinched hand
// through the frame cannot trigger the rubbing gesture.
export class MoneyRub {
  private states=new Map<string,{x:number;y:number;dx:number;dy:number;at:number;turns:number;turnedAt:number;until:number}>()
  reset(){this.states.clear()}
  update(hands:Joint[][],stamp:number,ids:string[]=[]){
    const seen=new Set<string>();let active=0
    hands.slice(0,2).forEach((h,i)=>{
      if(h.length<21)return
      const id=ids[i]||String(i),ax=h[9].x-h[0].x,ay=h[9].y-h[0].y,size=Math.hypot(ax,ay)
      if(size<.025)return
      const tx=h[8].x-h[4].x,ty=h[8].y-h[4].y
      if(Math.hypot(tx,ty)/size>.65){this.states.delete(id);return}
      const x=(tx*ax+ty*ay)/(size*size),y=(ty*ax-tx*ay)/(size*size)
      seen.add(id)
      let s=this.states.get(id)
      if(!s||stamp-s.at>250){s={x,y,dx:0,dy:0,at:stamp,turns:0,turnedAt:stamp,until:0};this.states.set(id,s)}
      const dx=x-s.x,dy=y-s.y,distance=Math.hypot(dx,dy)
      if(stamp-s.turnedAt>650)s.turns=0
      if(distance>.025&&distance<.45){
        if(dx*s.dx+dy*s.dy<-.0005){s.turns++;s.turnedAt=stamp}
        s.dx=dx;s.dy=dy;s.x=x;s.y=y
        if(s.turns>=2)s.until=stamp+650
      }
      s.at=stamp
      if(stamp<s.until)active++
    })
    for(const id of this.states.keys())if(!seen.has(id))this.states.delete(id)
    return active
  }
}
export class MoneyRain {
  readonly bills:Bill[]=[]
  readonly pile = new Uint16Array(64)
  collected=0
  boost=0
  private spawn=0
  private showerCount=0
  private sprite:HTMLCanvasElement|null=null
  private goldSprite:HTMLCanvasElement|null=null
  readonly goldPile=new Uint16Array(64)
  private loads=new Uint16Array(4)
  private pileCanvas:HTMLCanvasElement|null=null
  private pileDirty=true
  reset(){this.bills.length=0;this.pile.fill(0);this.goldPile.fill(0);this.spawn=0;this.showerCount=0;this.collected=0;this.boost=0;this.pileDirty=true}
  update(dt:number,mask:Float32Array,w:number,h:number,catchers:Catcher[],random=Math.random){
    dt=Math.min(.05,dt)
    let top=h,left=w,right=0
    for(let y=0;y<Math.min(h,top+5);y++)for(let x=0;x<w;x++)if(mask[y*w+x]>.5){if(top===h)top=y;left=Math.min(left,x);right=Math.max(right,x)}
    const solid=(x:number,y:number)=>y>=0&&y<h&&x>=0&&x<w&&mask[Math.floor(y)*w+Math.floor(x)]>.5
    const halfWidth=Math.max(1.5,w*.016),halfHeight=halfWidth*.47
    const surfaceAt=(c:Catcher,x:number)=>{const ps=c.points;if(!ps)return c.y;for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i];if(x>=a.x&&x<=b.x)return a.y+(b.y-a.y)*(x-a.x)/Math.max(.00001,b.x-a.x)}return c.y}
    if(top<h||this.boost>0){this.spawn+=dt*(22+Math.min(2,this.boost)*55);while(this.spawn>=1&&this.bills.length<320){this.spawn--;const center=top<h?(left+right)/2:w/2,spread=this.boost>0?w*.9:Math.max(12,right-left+24);this.bills.push({x:Math.max(2,Math.min(w-2,center+(random()-.5)*spread)),y:-3-random()*6,vx:(random()-.5)*7,vy:18,angle:random()*6,catcher:-1,offset:0,level:0})}}else this.spawn=0
    // Newly emitted particles may become gold only during a rubbing shower.
    for(const b of this.bills)if(b.gold===undefined)b.gold=this.boost>0&&(this.showerCount++%3===0)
    this.spawn=Math.min(1,this.spawn)
    if(this.loads.length<catchers.length)this.loads=new Uint16Array(catchers.length)
    const loads=this.loads;loads.fill(0)
    for(const b of this.bills){if(b.catcherId)b.catcher=catchers.findIndex(c=>c.id===b.catcherId);if(b.catcher>=0&&catchers[b.catcher])loads[b.catcher]++}
    for(let bi=this.bills.length-1;bi>=0;bi--){
      const b=this.bills[bi],held=catchers[b.catcher]
      if(held){
        // Compact levels around a single palm anchor, rather than a sloping fan.
        b.offset*=Math.exp(-dt*18)
        b.x=(held.x+b.offset)*w
        b.y=surfaceAt(held,held.x)*h-halfHeight-b.level*Math.max(.8,halfHeight*.7)
        b.vx=b.vy=0;continue
      }
      b.catcher=-1;b.catcherId=undefined
      // A moving body can overtake a bill; project it back above the silhouette.
      if(solid(b.x,b.y)&&!catchers.some(c=>Math.abs(b.x/w-c.x)<=c.width/2&&Math.abs(b.y/h-surfaceAt(c,b.x/w))<.12)){let y=Math.floor(b.y);while(y>0&&solid(b.x,y))y--;b.y=y-1;b.vy=0}
      b.vy=Math.min(125,b.vy+72*dt);b.vx*=Math.exp(-dt*.25)
      const steps=Math.max(1,Math.ceil(Math.abs(b.vy)*dt/.6))
      for(let k=0;k<steps;k++){
        const nx=Math.max(1,Math.min(w-2,b.x+b.vx*dt/steps)),ny=b.y+b.vy*dt/steps
        let landed=false
        for(let j=0;j<catchers.length;j++){
          const c=catchers[j],surface=surfaceAt(c,c.x)*h-halfHeight-loads[j]*Math.max(.8,halfHeight*.7)
          if(b.vy>=0&&Math.abs(nx-c.x*w)<c.width*w/2&&b.y<=surface+Math.max(3,halfHeight*2)&&ny+halfHeight>=surface&&loads[j]<80){
            b.catcher=j;b.catcherId=c.id;b.offset=Math.max(-.006,Math.min(.006,nx/w-c.x));b.level=loads[j]++;b.x=(c.x+b.offset)*w;b.y=surface;b.vx=b.vy=0;landed=true;break
          }
        }
        if(landed)break
        const bin=Math.max(0,Math.min(63,Math.floor(nx/w*64))),floor=h-2-Math.min(h*.3,this.pile[bin]*.8)
        if(ny>=floor){this.pile[bin]=Math.min(Math.ceil(h*.3/.8),this.pile[bin]+1);if(b.gold)this.goldPile[bin]=Math.min(this.pile[bin],this.goldPile[bin]+1);this.pileDirty=true;this.collected++;this.bills[bi]=this.bills[this.bills.length-1];this.bills.pop();landed=true;break}
        let blocked=false
        if(b.vy>=0)for(let offset=-halfWidth;offset<=halfWidth;offset+=1){if(solid(nx+offset,ny+halfHeight)){blocked=true;break}}
        if(blocked){
          b.vy=0;b.vx+=nx<(left+right)/2?-1.2:1.2;b.angle*=.8;break
        }
        b.x=nx;b.y=ny
      }
      b.angle+=b.vx*dt*.12
    }
  }
  draw(ctx:CanvasRenderingContext2D,width:number,height:number,w:number,h:number,_catchers:Catcher[]){
    if(!this.sprite){
      this.sprite=document.createElement('canvas');this.sprite.width=192;this.sprite.height=90;const c=this.sprite.getContext('2d')!;c.scale(3,3)
      c.fillStyle='#b1d3a2';c.fillRect(0,0,64,30);c.strokeStyle='#31573f';c.lineWidth=2;c.strokeRect(2,2,60,26);c.strokeRect(5,5,54,20);c.beginPath();c.ellipse(32,15,11,10,0,0,Math.PI*2);c.stroke();c.fillStyle='#244330';c.font='bold 10px serif';c.textAlign='center';c.fillText('100',32,18);c.font='7px serif';c.fillText('100',12,18);c.fillText('100',52,18)
    }
    if(!this.goldSprite){const s=document.createElement('canvas');s.width=192;s.height=90;const c=s.getContext('2d')!;const g=c.createLinearGradient(0,0,0,90);g.addColorStop(0,'#fffbd0');g.addColorStop(.35,'#ffd652');g.addColorStop(1,'#a66508');c.fillStyle=g;c.beginPath();c.moveTo(22,12);c.lineTo(170,12);c.lineTo(188,78);c.lineTo(4,78);c.closePath();c.fill();c.strokeStyle='#fff5ab';c.lineWidth=4;c.stroke();c.fillStyle='#81520c';c.font='bold 23px serif';c.textAlign='center';c.fillText('GOLD',96,53);this.goldSprite=s}
    const sx=width/w,sy=height/h,bw=Math.max(18,Math.min(36,width*.032)),bh=bw*30/64
    if(!this.pileCanvas)this.pileCanvas=document.createElement('canvas')
    if(this.pileCanvas.width!==Math.round(width)||this.pileCanvas.height!==Math.round(height)){this.pileCanvas.width=Math.round(width);this.pileCanvas.height=Math.round(height);this.pileDirty=true}
    if(this.pileDirty){
      const p=this.pileCanvas.getContext('2d')!;p.clearRect(0,0,width,height)
      for(let bin=0;bin<64;bin++)for(let layer=0;layer<this.pile[bin];layer+=2)p.drawImage(layer<this.goldPile[bin]?this.goldSprite:this.sprite,bin/64*width-bw/2+(layer%3-1)*2,height-bh-layer*.8*sy,bw,bh)
      this.pileDirty=false
    }
    ctx.drawImage(this.pileCanvas,0,0,width,height)
    for(const b of this.bills){ctx.save();ctx.translate(b.x*sx,b.y*sy);ctx.rotate(b.catcher>=0?0:Math.sin(b.angle)*.5);ctx.drawImage(b.gold?this.goldSprite:this.sprite,-bw/2,-bh/2,bw,bh);ctx.restore()}
  }
}
