import { Afterglow } from './afterglow'
// At most one render job and one presentation bitmap exist at a time.
export function createFireworkRenderer(){
  let worker:Worker|null=null,local:Afterglow|null=null,bitmap:ImageBitmap|null=null
  let ready=false,busy=false,elapsed=0,epoch=0,kind='random',disposed=false,timer=0
  let mask:Float32Array=new Float32Array(0),mw=1,mh=1
  const fallback=()=>{if(disposed)return;clearTimeout(timer);worker?.terminate();worker=null;busy=false;bitmap?.close();bitmap=null;local=new Afterglow();local.type=kind;if(mask.length)local.setMask(mask,mw,mh)}
  try{
    if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined')throw new Error('No worker canvas')
    worker=new Worker(new URL('./firework-render.worker.ts',import.meta.url),{type:'module'})
    const current=worker
    worker.onerror=e=>{e.preventDefault();fallback()}
    worker.onmessage=({data:m})=>{
      if(disposed||worker!==current){m.bitmap?.close();return}
      if(m.type==='ready'){ready=true;clearTimeout(timer)}
      else if(m.type==='frame'){busy=false;clearTimeout(timer);if(m.epoch!==epoch){m.bitmap.close();return}bitmap?.close();bitmap=m.bitmap}
      else if(m.type==='error')fallback()
    }
    timer=window.setTimeout(fallback,8000)
  }catch{fallback()}
  return {
    get type(){return kind},set type(value:string){kind=value;if(local)local.type=value;else worker?.postMessage({type:'kind',value})},
    setMask(value:Float32Array,w:number,h:number){mask=value;mw=w;mh=h;if(local)local.setMask(value,w,h);else worker?.postMessage({type:'mask',mask:value,w,h})},
    hands(hands:{x:number;y:number}[][],stamp:number,ids:string[]=[]){if(local)local.hands(hands,stamp,ids);else worker?.postMessage({type:'hands',hands,stamp,ids})},
    burst(x:number,y:number,stamp:number){if(local)local.burst(x,y,stamp);else worker?.postMessage({type:'burst',x,y,stamp})},
    reset(){epoch++;elapsed=0;bitmap?.close();bitmap=null;if(local)local.reset();else worker?.postMessage({type:'reset'})},
    draw(ctx:CanvasRenderingContext2D,w:number,h:number,dt:number,clear=true){
      if(local){local.draw(ctx,w,h,dt,clear);return}
      if(clear){ctx.fillStyle='#000';ctx.fillRect(0,0,w,h)}
      if(bitmap)ctx.drawImage(bitmap,0,0,w,h)
      elapsed+=dt
      if(ready&&!busy){busy=true;worker?.postMessage({type:'frame',w,h,dt:elapsed,epoch});elapsed=0;timer=window.setTimeout(fallback,5000)}
    },
    dispose(){disposed=true;clearTimeout(timer);worker?.terminate();bitmap?.close();local?.reset();worker=null;bitmap=null;local=null}
  }
}
