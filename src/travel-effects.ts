export type EffectMode = 'pixel' | 'blur' | 'recolor' | 'lightmap' | 'melt' | 'thermal'
export function randomWindowEffect(previous: EffectMode, random = Math.random) {
  const choices: EffectMode[] = ['pixel','blur','recolor','lightmap','melt','thermal']
  const candidates = choices.filter(mode=>mode!==previous)
  return {mode:candidates[Math.floor(random()*candidates.length)]!,recolorAmount:3+Math.floor(random()*4)}
}
// Canvas-native approximation of a feedback/displacement/bloom TouchDesigner pipeline.
export function createLuminanceGridRenderer() {
  const layer=document.createElement('canvas'), lc=layer.getContext('2d')!
  let out:ImageData|null=null
  const palette=new Uint8Array(768),stops=[[4,3,26],[32,12,120],[152,19,132],[249,56,29],[255,180,32],[255,255,213]]
  for(let i=0;i<256;i++){const p=i/255*5,a=Math.floor(p),b=Math.min(5,a+1),t=p-a;for(let c=0;c<3;c++)palette[i*3+c]=stops[a][c]*(1-t)+stops[b][c]*t}
  return (ctx:CanvasRenderingContext2D,pixels:ImageData,amount:number,width:number,height:number,mode:'melt'|'thermal',time=0)=>{
    const w=pixels.width,h=pixels.height,src=pixels.data
    if(!out||out.width!==w||out.height!==h){layer.width=w;layer.height=h;out=lc.createImageData(w,h)}
    const dst=out.data,k=amount/100,t=time*.00035
    const read=(x:number,y:number,c:number)=>{x=Math.max(0,Math.min(w-1.001,x));y=Math.max(0,Math.min(h-1.001,y));const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=(iy*w+ix)*4+c;return (src[i]*(1-fx)+src[i+4]*fx)*(1-fy)+(src[i+w*4]*(1-fx)+src[i+w*4+4]*fx)*fy}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4
      if(mode==='thermal'){
        const l=Math.max(0,Math.min(255,Math.round((src[i]*.299+src[i+1]*.587+src[i+2]*.114)*( .6+k*1.1))))*3
        dst[i]=palette[l];dst[i+1]=palette[l+1];dst[i+2]=palette[l+2]
      }else{
        const dx=Math.sin(y*.03+t+Math.sin(x*.026-t))*k*17,dy=Math.sin(x*.027-t+Math.cos(y*.021+t))*k*23,split=k*4
        dst[i]=read(x+dx+split,y+dy,0);dst[i+1]=read(x+dx,y+dy,1);dst[i+2]=read(x+dx-split,y+dy,2)
      }
      dst[i+3]=255
    }
    lc.putImageData(out,0,0);ctx.save();ctx.imageSmoothingEnabled=true
    ctx.filter=mode==='melt'?'blur('+k*3+'px)':'none';ctx.drawImage(layer,0,0,width,height)
    if(mode==='melt'){ctx.globalCompositeOperation='screen';ctx.globalAlpha=.12+k*.3;ctx.filter='blur('+(8+k*16)+'px)';ctx.drawImage(layer,0,0,width,height)}
    ctx.restore()
  }
}
