import { Afterglow } from './afterglow'
const effect=new Afterglow(),canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d')!
self.onmessage=({data:m})=>{
  try{
    if(m.type==='mask')effect.setMask(m.mask,m.w,m.h)
    else if(m.type==='hands')effect.hands(m.hands,m.stamp,m.ids)
    else if(m.type==='burst')effect.burst(m.x,m.y,m.stamp)
    else if(m.type==='kind')effect.type=m.value
    else if(m.type==='reset')effect.reset()
    else if(m.type==='frame'){
      // Match the existing effect's pixel budget, without changing its graphics.
      const scale=Math.min(1,1280/m.w,1280/m.h),w=Math.round(m.w*scale),h=Math.round(m.h*scale)
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.setTransform(w/m.w,0,0,h/m.h,0,0)
      effect.draw(ctx as unknown as CanvasRenderingContext2D,m.w,m.h,m.dt,false)
      const bitmap=canvas.transferToImageBitmap();self.postMessage({type:'frame',bitmap,epoch:m.epoch},{transfer:[bitmap]})
    }
  }catch{self.postMessage({type:'error'})}
}
self.postMessage({type:'ready'})
