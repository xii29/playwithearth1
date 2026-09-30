type Joint={x:number;y:number}
export type Catcher={x:number;y:number;width:number}
type Bill={x:number;y:number;vx:number;vy:number;angle:number;catcher:number;offset:number;level:number}
export function moneyCatchers(hands:Joint[][]):Catcher[]{
  const valid=hands.filter(h=>h.length>=21),out:Catcher[]=[]
  for(const h of valid){
    const d=(a:number,b:number)=>Math.hypot(h[a].x-h[b].x,h[a].y-h[b].y)
    const extended=(t:number,p:number)=>d(t,0)>d(p,0)*1.18
    if(extended(8,6)&&extended(12,10)&&!extended(16,14)&&!extended(20,18)&&d(8,12)>.035)
      out.push({x:(h[8].x+h[12].x)/2,y:Math.min(h[8].y,h[12].y)-.012,width:Math.max(.09,d(8,12)+.025)})
  }
  if(valid.length===2){
    const a=valid[0][9],b=valid[1][9]
    if(Math.hypot(a.x-b.x,a.y-b.y)<.22&&Math.abs(a.y-b.y)<.12)out.push({x:(a.x+b.x)/2,y:(a.y+b.y)/2-.035,width:Math.max(.15,Math.abs(a.x-b.x)+.12)})
  }
  return out
}
export class MoneyRain {
  readonly bills:Bill[]=[]
  readonly pile = new Uint16Array(64)
  collected=0
  private spawn=0
  private sprite:HTMLCanvasElement|null=null
  reset(){this.bills.length=0;this.pile.fill(0);this.spawn=0;this.collected=0}
  update(dt:number,mask:Float32Array,w:number,h:number,catchers:Catcher[],random=Math.random){
    dt=Math.min(.05,dt)
    let top=h,left=w,right=0
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]>.5){if(top===h)top=y;if(y<top+5){left=Math.min(left,x);right=Math.max(right,x)}}
    const solid=(x:number,y:number)=>y>=0&&y<h&&x>=0&&x<w&&mask[Math.floor(y)*w+Math.floor(x)]>.5
    const halfWidth=Math.max(1.5,w*.016),halfHeight=halfWidth*.47
    if(top<h){this.spawn+=dt*14;while(this.spawn>=1&&this.bills.length<320){this.spawn--;this.bills.push({x:Math.max(2,Math.min(w-2,(left+right)/2+(random()-.5)*Math.max(12,right-left+24))),y:-3-random()*6,vx:(random()-.5)*7,vy:8,angle:random()*6,catcher:-1,offset:0,level:0})}}else this.spawn=0
    this.spawn=Math.min(1,this.spawn)
    const loads=new Uint16Array(catchers.length)
    for(const b of this.bills)if(b.catcher>=0&&catchers[b.catcher])loads[b.catcher]++
    for(let bi=this.bills.length-1;bi>=0;bi--){
      const b=this.bills[bi],held=catchers[b.catcher]
      if(held){b.x=(held.x+b.offset)*w;b.y=held.y*h-2-b.level*.8;b.vx=b.vy=0;continue}
      b.catcher=-1
      // A moving body can overtake a bill; project it back above the silhouette.
      if(solid(b.x,b.y)){let y=Math.floor(b.y);while(y>0&&solid(b.x,y))y--;b.y=y-1;b.vy=-4}
      b.vy=Math.min(65,b.vy+35*dt);b.vx*=Math.exp(-dt*.25)
      const steps=Math.max(1,Math.ceil(Math.abs(b.vy)*dt/.6))
      for(let k=0;k<steps;k++){
        const nx=Math.max(1,Math.min(w-2,b.x+b.vx*dt/steps)),ny=b.y+b.vy*dt/steps
        let landed=false
        for(let j=0;j<catchers.length;j++){
          const c=catchers[j],surface=c.y*h-2-loads[j]*.8
          if(b.vy>=0&&Math.abs(nx-c.x*w)<c.width*w/2&&b.y<=surface+1&&ny>=surface&&loads[j]<35){
            b.catcher=j;b.offset=nx/w-c.x;b.level=loads[j]++;b.x=nx;b.y=surface;b.vx=b.vy=0;landed=true;break
          }
        }
        if(landed)break
        const bin=Math.max(0,Math.min(63,Math.floor(nx/w*64))),floor=h-2-Math.min(h*.3,this.pile[bin]*.8)
        if(ny>=floor){this.pile[bin]=Math.min(Math.ceil(h*.3/.8),this.pile[bin]+1);this.collected++;this.bills.splice(bi,1);landed=true;break}
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
  draw(ctx:CanvasRenderingContext2D,width:number,height:number,w:number,h:number,catchers:Catcher[]){
    if(!this.sprite){
      this.sprite=document.createElement('canvas');this.sprite.width=64;this.sprite.height=30;const c=this.sprite.getContext('2d')!
      c.fillStyle='#b1d3a2';c.fillRect(0,0,64,30);c.strokeStyle='#31573f';c.lineWidth=2;c.strokeRect(2,2,60,26);c.strokeRect(5,5,54,20);c.beginPath();c.ellipse(32,15,11,10,0,0,Math.PI*2);c.stroke();c.fillStyle='#244330';c.font='bold 10px serif';c.textAlign='center';c.fillText('100',32,18);c.font='7px serif';c.fillText('100',12,18);c.fillText('100',52,18)
    }
    const sx=width/w,sy=height/h,bw=Math.max(18,Math.min(36,width*.032)),bh=bw*30/64
    for(let bin=0;bin<64;bin++)for(let layer=0;layer<this.pile[bin];layer+=2){ctx.drawImage(this.sprite,bin/64*width-bw/2+(layer%3-1)*2,height-bh-layer*.8*sy,bw,bh)}
    for(const b of this.bills){ctx.save();ctx.translate(b.x*sx,b.y*sy);ctx.rotate(b.catcher>=0?0:Math.sin(b.angle)*.5);ctx.drawImage(this.sprite,-bw/2,-bh/2,bw,bh);ctx.restore()}
    ctx.strokeStyle='#dcffc0';ctx.lineWidth=2
    for(const c of catchers){ctx.beginPath();ctx.moveTo((c.x-c.width/2)*width,c.y*height);ctx.quadraticCurveTo(c.x*width,c.y*height+8,(c.x+c.width/2)*width,c.y*height);ctx.stroke()}
  }
}
