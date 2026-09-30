// Reused, bounded-resolution compositor: displaced RGB, bloom and masked opacity.
export class BodyMeltedSpectrum {
  readonly canvas=document.createElement('canvas')
  private ctx=this.canvas.getContext('2d')!
  private source=document.createElement('canvas')
  private sc=this.source.getContext('2d')!
  private image:ImageData|null=null
  resize(w:number,h:number){
    this.canvas.width=this.source.width=w;this.canvas.height=this.source.height=h
    this.image=this.sc.createImageData(w,h)
  }
  render(rgb:Uint8ClampedArray,mask:Float32Array,gw:number,gh:number,transparent:number,stamp:number){
    if(!this.image||rgb.length<gw*gh*4)return
    const w=this.canvas.width,h=this.canvas.height,out=this.image.data,t=stamp*.00035
    const sample=(x:number,y:number,c:number)=>{
      x=Math.max(0,Math.min(gw-1.001,x));y=Math.max(0,Math.min(gh-1.001,y))
      const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=(iy*gw+ix)*4
      return (rgb[i+c]*(1-fx)+rgb[i+4+c]*fx)*(1-fy)+(rgb[i+gw*4+c]*(1-fx)+rgb[i+(gw+1)*4+c]*fx)*fy
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=x/w*gw,v=y/h*gh,i=Math.min(gh-1,Math.floor(v))*gw+Math.min(gw-1,Math.floor(u)),p=(y*w+x)*4
      const dx=Math.sin(v*.055+t*2)*3+Math.sin(u*.035+v*.026-t)*2
      const dy=Math.cos(u*.047-t)*3+Math.sin(v*.03+t)*2,flow=1-mask[i]*.55
      out[p]=sample(u+dx*flow+1.6,v+dy*flow,0)
      out[p+1]=sample(u+dx*flow,v+dy*flow,1)
      out[p+2]=sample(u+dx*flow-1.6,v+dy*flow,2)
      out[p+3]=255*(1-mask[i]*transparent)
    }
    this.sc.putImageData(this.image,0,0)
    const c=this.ctx
    c.globalCompositeOperation='source-over';c.filter='none'
    // Deliberate abstract backdrop, not an invented reconstruction of hidden scenery.
    const bg=c.createLinearGradient(0,0,w,h)
    bg.addColorStop(0,'#080c25');bg.addColorStop(.5,'#281240');bg.addColorStop(1,'#063340')
    c.fillStyle=bg;c.fillRect(0,0,w,h)
    c.filter='blur(1px) saturate(155%)';c.drawImage(this.source,0,0)
    c.globalCompositeOperation='screen';c.globalAlpha=.42;c.filter='blur(12px) saturate(180%)';c.drawImage(this.source,0,0)
    c.filter='none';c.globalAlpha=1;c.globalCompositeOperation='source-over'
  }
}
