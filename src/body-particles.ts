/** Fixed particle slots, grayscale only, and bounded local motion trails. */
export class BodyParticles {
  private oldMask=new Float32Array(0)
  private oldLight=new Float32Array(0)
  private dx=new Float32Array(0)
  private dy=new Float32Array(0)
  private life=new Float32Array(0)
  private mask=new Float32Array(0)
  private light=new Float32Array(0)
  private jitterX=new Float32Array(0)
  private jitterY=new Float32Array(0)
  private gw=0
  private gh=0
  private lastX=0
  private lastY=0
  private initialized=false
  reset(){this.oldMask.fill(0);this.mask.fill(0);this.life.fill(0);this.dx.fill(0);this.dy.fill(0);this.initialized=false}
  update(mask:Float32Array,rgb:Uint8ClampedArray,w:number,h:number){
    if(this.gw!==w||this.gh!==h){
      this.gw=w;this.gh=h
      this.oldMask=new Float32Array(w*h);this.oldLight=new Float32Array(w*h)
      this.dx=new Float32Array(w*h);this.dy=new Float32Array(w*h);this.life=new Float32Array(w*h)
      this.mask=new Float32Array(w*h);this.light=new Float32Array(w*h);this.initialized=false
      this.jitterX=new Float32Array(w*h);this.jitterY=new Float32Array(w*h)
      for(let i=0;i<w*h;i++){this.jitterX[i]=Math.sin(i*12.3)*.2;this.jitterY[i]=Math.cos(i*7.1)*.2}
    }
    let sx=0,sy=0,count=0
    for(let i=0;i<mask.length;i++)if(mask[i]>.5){sx+=i%w;sy+=Math.floor(i/w);count++}
    const cx=count?sx/count:this.lastX,cy=count?sy/count:this.lastY
    const vx=this.initialized?Math.max(-8,Math.min(8,cx-this.lastX)):0,vy=this.initialized?Math.max(-8,Math.min(8,cy-this.lastY)):0
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,p=i*4,l=(rgb[p]*.299+rgb[p+1]*.587+rgb[p+2]*.114)/255
      this.light[i]=l
      if(this.initialized&&(mask[i]>.3||this.oldMask[i]>.3)){
        const change=mask[i]-this.oldMask[i],detail=l-this.oldLight[i]
        const gx=mask[y*w+Math.min(w-1,x+1)]-mask[y*w+Math.max(0,x-1)]
        const gy=mask[Math.min(h-1,y+1)*w+x]-mask[Math.max(0,y-1)*w+x]
        const energy=Math.min(1,Math.abs(change)*.85+Math.abs(detail)*1.5+Math.hypot(vx,vy)*.07)
        if(energy>.08){
          // Most dots stay anchored, preserving the face and filled body shape.
          if(i%2===0){this.dx[i]=vx*4-gx*change*14+Math.sin(i*2.4)*energy*5;this.dy[i]=vy*4-gy*change*14+Math.cos(i*1.7)*energy*5;this.life[i]=Math.max(this.life[i],energy)}
        }
      }
      this.oldLight[i]=l;this.oldMask[i]=mask[i];this.mask[i]=mask[i]
    }
    this.lastX=cx;this.lastY=cy;this.initialized=count>0
  }
  draw(ctx:CanvasRenderingContext2D,width:number,height:number,dt:number){
    ctx.fillStyle='#000';ctx.fillRect(0,0,width,height)
    const sx=width/this.gw,sy=height/this.gh,decay=Math.exp(-dt*1.35),returnRate=Math.exp(-dt*1.7)
    // Eight batches avoid per-dot style switches, shadows, and gradients.
    for(let bin=0;bin<8;bin++){
      ctx.fillStyle=`rgb(${90+bin*23},${90+bin*23},${90+bin*23})`;ctx.beginPath()
      for(let i=0;i<this.mask.length;i++){
        if(this.mask[i]<.35||Math.min(7,Math.floor(this.light[i]*8))!==bin)continue
        const x=((i%this.gw)+.5+this.jitterX[i])*sx,y=(Math.floor(i/this.gw)+.5+this.jitterY[i])*sy
        const size=.7+this.light[i]*.65
        ctx.rect(x,y,size,size)
      }
      ctx.fill()
    }
    ctx.fillStyle='#aaa';ctx.beginPath()
    for(let i=0;i<this.life.length;i+=2){
      this.life[i]*=decay;this.dx[i]*=returnRate;this.dy[i]*=returnRate
      if(this.life[i]<.035)continue
      const x=((i%this.gw)+.5)*sx,y=(Math.floor(i/this.gw)+.5)*sy,size=Math.max(.35,this.life[i])
      // Sparse multi-tap trails, no full-frame accumulation or permanent ghosts.
      for(let tap=1;tap<=5;tap++)ctx.rect(x+this.dx[i]*sx*tap*.6,y+this.dy[i]*sy*tap*.6,size,size)
    }
    ctx.fill()
  }
}
