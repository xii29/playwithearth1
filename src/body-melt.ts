// Cached clean plate plus mask-normal refraction. No per-frame image allocations.
export class BodyMeltedSpectrum {
  readonly canvas=document.createElement('canvas')
  private ctx=this.canvas.getContext('2d')!
  private source=document.createElement('canvas')
  private sc=this.source.getContext('2d')!
  private image:ImageData|null=null
  private background:Uint8ClampedArray|null=null
  get backgroundReady(){return this.background!==null}
  resetBackground(){this.background=null}
  captureBackground(rgb:Uint8ClampedArray){this.background=new Uint8ClampedArray(rgb)}
  resize(w:number,h:number){
    this.canvas.width=this.source.width=w;this.canvas.height=this.source.height=h
    this.image=this.sc.createImageData(w,h)
    this.resetBackground()
  }
  render(rgb:Uint8ClampedArray,mask:Float32Array,gw:number,gh:number,transparent:number,stamp:number){
    if(!this.image||rgb.length<gw*gh*4)return
    const w=this.canvas.width,h=this.canvas.height,out=this.image.data,t=stamp*.00035
    const sample=(data:Uint8ClampedArray,x:number,y:number,c:number)=>{
      x=Math.max(0,Math.min(gw-1.001,x));y=Math.max(0,Math.min(gh-1.001,y))
      const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=(iy*gw+ix)*4
      return (data[i+c]*(1-fx)+data[i+4+c]*fx)*(1-fy)+(data[i+gw*4+c]*(1-fx)+data[i+(gw+1)*4+c]*fx)*fy
    }
    const bg=this.background?.length===rgb.length?this.background:null
    const amount=bg?transparent:0
    const maskAt=(x:number,y:number)=>mask[Math.max(0,Math.min(gh-1,y))*gw+Math.max(0,Math.min(gw-1,x))]
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=x/w*gw,v=y/h*gh,i=Math.min(gh-1,Math.floor(v))*gw+Math.min(gw-1,Math.floor(u)),p=(y*w+x)*4
      const dx=Math.sin(v*.055+t*2)*3+Math.sin(u*.035+v*.026-t)*2
      const dy=Math.cos(u*.047-t)*3+Math.sin(v*.03+t)*2,flow=1-mask[i]*.55
      const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy
      const m=maskAt(ix,iy)*(1-fx)*(1-fy)+maskAt(ix+1,iy)*fx*(1-fy)+maskAt(ix,iy+1)*(1-fx)*fy+maskAt(ix+1,iy+1)*fx*fy
      const nx=(maskAt(ix+2,iy)-maskAt(ix-2,iy))*.5,ny=(maskAt(ix,iy+2)-maskAt(ix,iy-2))*.5
      const rim=Math.min(1,Math.hypot(nx,ny)*2.3)
      // Slight internal relief preserves facial/clothing contours like liquid glass.
      const relief=(sample(rgb,u+1,v,1)-sample(rgb,u-1,v,1))/255
      const bendX=nx*11+Math.sin(v*.18+t*5)*rim*2+relief*1.5
      const bendY=ny*11+Math.cos(u*.15-t*4)*rim*2
      const blend=amount*Math.max(m,rim*.55)
      for(let c=0;c<3;c++){
        const original=sample(rgb,u+dx*flow*(1-amount)+(1-c)*1.6*(1-amount),v+dy*flow*(1-amount),c)
        const glass=bg?sample(bg,u+bendX+(1-c)*rim*.7,v+bendY,c):original
        const highlight=(nx*.65-ny*.45)*rim*65+relief*m*12
        out[p+c]=original*(1-blend)+(glass+highlight)*blend
      }
      out[p+3]=255
    }
    this.sc.putImageData(this.image,0,0)
    const c=this.ctx
    c.globalCompositeOperation='source-over';c.filter='none'
    c.filter=`saturate(${100+55*(1-amount)}%)`;c.drawImage(this.source,0,0)
    c.globalCompositeOperation='screen';c.globalAlpha=.32*(1-amount);c.filter='blur(12px) saturate(180%)';c.drawImage(this.source,0,0)
    c.filter='none';c.globalAlpha=1;c.globalCompositeOperation='source-over'
  }
}
