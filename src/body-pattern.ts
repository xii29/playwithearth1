// Camera-driven monochrome labyrinth / halftone field. Static carriers are cached.
export class BodyPattern {
  readonly canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private image: ImageData | null = null
  private carrier = new Float32Array(0)
  resize(w: number, h: number) {
    if(this.image&&this.canvas.width===w&&this.canvas.height===h)return
    this.canvas.width=w;this.canvas.height=h;this.image=this.ctx.createImageData(w,h);this.carrier=new Float32Array(w*h)
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const a=x+19*Math.sin(y*.023)+11*Math.sin((x+y)*.031)+8*Math.cos(y*.057-x*.018)
      const b=y+17*Math.sin(x*.021)-10*Math.cos((y-x)*.029)+7*Math.sin(x*.061+y*.013)
      this.carrier[y*w+x]=Math.sin(a*.72)+.66*Math.cos(b*.72)
    }
  }
  render(light: Float32Array, mask: Float32Array, gw: number, gh: number, separated: boolean) {
    if(!this.image)return
    const w=this.canvas.width,h=this.canvas.height,out=this.image.data
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const u=x/(w-1)*(gw-1),v=y/(h-1)*(gh-1),ix=Math.min(gw-2,Math.floor(u)),iy=Math.min(gh-2,Math.floor(v)),fx=u-ix,fy=v-iy,i=iy*gw+ix
      const wa=(1-fx)*(1-fy),wb=fx*(1-fy),wc=(1-fx)*fy,wd=fx*fy
      const l=(light[i]*wa+light[i+1]*wb+light[i+gw]*wc+light[i+gw+1]*wd)/255,threshold=(.5-l)*3.7
      const value=Math.max(0,Math.min(1,(this.carrier[y*w+x]-threshold)*3+.5))
      const alpha=separated?Math.max(0,Math.min(1,(mask[i]*wa+mask[i+1]*wb+mask[i+gw]*wc+mask[i+gw+1]*wd-.12)/.76)):1
      const p=(y*w+x)*4,c=Math.round(value*alpha*255)
      out[p]=out[p+1]=out[p+2]=c;out[p+3]=255
    }
    this.ctx.putImageData(this.image,0,0)
  }
}
