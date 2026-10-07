import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'
import { MoneyRain, MoneyRub, moneyCatchers, type Catcher, type Joint } from './money-rain'

export function setupMoneyExample(root:HTMLElement){
  const video=root.querySelector<HTMLVideoElement>('#body-camera')!
  const canvas=root.querySelector<HTMLCanvasElement>('#body-canvas')!,ctx=canvas.getContext('2d',{alpha:false})!
  const button=root.querySelector<HTMLButtonElement>('#body-camera-toggle')!,status=root.querySelector<HTMLElement>('#body-status')!
  const rain=new MoneyRain(),rub=new MoneyRub(),events=new AbortController()
  const low=matchMedia('(pointer:coarse)').matches||navigator.hardwareConcurrency<=4
  const input=document.createElement('canvas'),ic=input.getContext('2d')!
  let stream:MediaStream|null=null,worker:Worker|null=null,handModel:HandLandmarker|null=null,bodyModel:ImageSegmenter|null=null
  let width=1,height=1,dpr=1,gw=1,gh=1,mask=new Float32Array(0),hasBody=false
  let disposed=false,loading=false,generation=0,raf=0,previous=0,videoTime=-1
  let busy=false,submitted=0,cost=20,handAt=-Infinity,maskAt=-Infinity,lastInference=-Infinity,lastKind='mask'
  let catchers:Catcher[]=[],targets:Catcher[]=[],rubUntil=0,boost=0
  let cancelInit:(()=>void)|null=null,fallbackPending=false,workerTimer=0
  const tracked=new Map<string,{catcher:Catcher;at:number}>()
  const say=(text:string)=>{if(status.textContent!==text)status.textContent=text}
  let lastGuide=-Infinity,pendingGuide='',pendingSince=0
  const guide=(text:string,stamp:number)=>{
    if(text!==pendingGuide){pendingGuide=text;pendingSince=stamp}
    if(stamp-pendingSince>=650&&stamp-lastGuide>=3500&&status.textContent!==text){say(text);lastGuide=stamp}
  }
  const resize=()=>{
    width=Math.max(1,root.clientWidth);height=Math.max(1,root.clientHeight)
    // Keep Retina detail without allocating an unbounded 4K/5K render surface.
    dpr=Math.min(devicePixelRatio,low?1.5:2,2560/width,2560/height)
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)
    gw=low?192:256;gh=Math.max(48,Math.min(384,Math.round(gw*height/width)));mask=new Float32Array(gw*gh)
    hasBody=false;rain.reset();tracked.clear();catchers=[];targets=[];rub.reset();boost=0;rubUntil=0
  }
  const observer=new ResizeObserver(resize);observer.observe(root);resize()
  const onHands=(landmarks:Joint[][],ids:string[],stamp:number)=>{
    if(document.hidden||performance.now()-stamp>400)return
    handAt=stamp
    const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
    for(const c of moneyCatchers(landmarks,ids)){
      const id=c.id!
      tracked.set(id,{catcher:{id,x:((width-vw)/2+(1-c.x)*vw)/width,y:((height-vh)/2+c.y*vh)/height,width:c.width*vw/width,points:c.points?.map(p=>({x:((width-vw)/2+(1-p.x)*vw)/width,y:((height-vh)/2+p.y*vh)/height})).reverse()},at:stamp})
    }
    // Short recognition gaps no longer drop all the bills off a hand.
    for(const [id,item] of tracked)if(stamp-item.at>140)tracked.delete(id)
    targets=[...tracked.values()].map(item=>item.catcher)
    boost=rub.update(landmarks,stamp,ids);rubUntil=boost?stamp+220:0
  }
  const onMask=(data:Float32Array,mw:number,mh:number,stamp:number)=>{
    if(document.hidden||performance.now()-stamp>600)return
    const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
    let count=0
    for(let y=0;y<gh;y++){
      const v=((y+.5)/gh*height-(height-vh)/2)/vh,my=Math.max(0,Math.min(mh-1,Math.floor(v*mh)))
      for(let x=0;x<gw;x++){
        const u=1-((x+.5)/gw*width-(width-vw)/2)/vw,mx=Math.max(0,Math.min(mw-1,Math.floor(u*mw)))
        const value=Math.max(0,Math.min(1,(1-data[my*mw+mx]-.4)/.35))
        mask[y*gw+x]=value;if(value>.5)count++
      }
    }
    hasBody=count>12;maskAt=stamp
  }
  const terminateWorker=()=>{clearTimeout(workerTimer);workerTimer=0;cancelInit?.();cancelInit=null;worker?.terminate();worker=null;busy=false}
  const stop=()=>{
    generation++;terminateWorker();handModel?.close();bodyModel?.close();handModel=null;bodyModel=null
    stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null
    loading=false;fallbackPending=false;rain.reset();rub.reset();tracked.clear();catchers=[];targets=[];boost=0;rubUntil=0
    mask.fill(0);hasBody=false;handAt=maskAt=lastInference=-Infinity;videoTime=-1;previous=0;cost=20
    cancelAnimationFrame(raf);raf=0;button.disabled=false;button.textContent='카메라 켜기';button.classList.remove('is-active')
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height)
  }
  const startFallback=async(id:number)=>{
    if(fallbackPending||disposed||id!==generation)return
    fallbackPending=true;terminateWorker()
    try{
      const vision=await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
      if(disposed||id!==generation)return
      const hands=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.5})
      if(disposed||id!==generation){hands.close();return}handModel=hands
      const body=await ImageSegmenter.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/selfie_multiclass.tflite`},runningMode:'VIDEO',outputConfidenceMasks:true,outputCategoryMask:false})
      if(disposed||id!==generation){body.close();return}bodyModel=body
    }catch{if(id===generation){stop();say('인식을 준비하지 못했어요. 카메라를 다시 켜 주세요.')}}
    finally{if(id===generation)fallbackPending=false}
  }
  const initWorker=()=>new Promise<void>((resolve,reject)=>{
    const current=new Worker(new URL('./money-vision.worker.ts',import.meta.url),{type:'module'});worker=current
    const id=generation;let ready=false
    const fail=()=>{
      if(current!==worker)return
      if(!ready){reject(new Error('Worker unavailable'));return}
      void startFallback(id)
    }
    const timeout=window.setTimeout(fail,12000)
    cancelInit=()=>{clearTimeout(timeout);reject(new Error('Cancelled'))}
    current.onerror=event=>{event.preventDefault();fail()}
    current.onmessage=({data:m})=>{
      if(disposed||current!==worker||id!==generation)return
      if(m.type==='ready'){ready=true;clearTimeout(timeout);cancelInit=null;resolve()}
      else if(m.type==='hands')onHands(m.landmarks,m.ids,m.timestamp)
      else if(m.type==='mask')onMask(m.data,m.width,m.height,m.timestamp)
      else if(m.type==='done'){clearTimeout(workerTimer);workerTimer=0;busy=false;cost=m.cost}
      else if(m.type==='error')fail()
    }
    current.postMessage({type:'init',base:new URL(`${import.meta.env.BASE_URL}mediapipe/`,location.href).href})
  })
  const submit=(stamp:number)=>{
    const current=worker
    if(!current||loading||busy||stamp-submitted<Math.max(low?40:28,cost))return
    busy=true;submitted=stamp
    const scale=Math.min(1,(low?640:960)/Math.max(video.videoWidth,video.videoHeight))
    workerTimer=window.setTimeout(()=>{if(current===worker)void startFallback(generation)},2500)
    void createImageBitmap(video,{resizeWidth:Math.max(1,Math.round(video.videoWidth*scale)),resizeHeight:Math.max(1,Math.round(video.videoHeight*scale))}).then(bitmap=>{
      if(disposed||current!==worker||document.hidden){bitmap.close();if(current===worker){busy=false;clearTimeout(workerTimer)}return}
      current.postMessage({type:'frame',bitmap,timestamp:stamp},[bitmap])
    }).catch(()=>{if(current===worker)void startFallback(generation)})
  }
  const inferFallback=(stamp:number)=>{
    if(!handModel||!bodyModel||stamp-lastInference<Math.max(low?60:45,cost*1.5))return
    const scale=Math.min(1,(low?640:960)/Math.max(video.videoWidth,video.videoHeight))
    const iw=Math.round(video.videoWidth*scale),ih=Math.round(video.videoHeight*scale)
    if(input.width!==iw||input.height!==ih){input.width=iw;input.height=ih}
    ic.drawImage(video,0,0,iw,ih);lastInference=stamp
    const started=performance.now()
    try{
      if(stamp-maskAt>Math.max(140,cost*4)&&lastKind==='hands'){
        const result=bodyModel.segmentForVideo(input,stamp)
        try{const m=result.confidenceMasks?.[0];if(m)onMask(m.getAsFloat32Array(),m.width,m.height,stamp)}finally{result.close()}
        lastKind='mask'
      }else{
        const result=handModel.detectForVideo(input,stamp);onHands(result.landmarks,result.handedness?.map(h=>h[0]?.categoryName??'')??[],stamp);lastKind='hands'
      }
      cost=cost*.8+(performance.now()-started)*.2
    }catch{rub.reset();boost=0}
  }
  const draw=(stamp:number)=>{
    raf=0;if(disposed||document.hidden||!stream)return
    raf=requestAnimationFrame(draw)
    // RAF supplies smooth bill motion independently of camera/inference rate.
    if(previous&&stamp-previous<1000/60-1)return
    const dt=previous?Math.min(.05,(stamp-previous)/1000):1/60;previous=stamp
    if(video.readyState<2)return
    if(video.currentTime!==videoTime){
      videoTime=video.currentTime
      if(worker)submit(stamp);else inferFallback(stamp)
    }
    if(stamp-maskAt>600){mask.fill(0);hasBody=false}
    if(stamp-handAt>220){tracked.clear();targets=[];boost=0;rub.reset()}
    catchers=targets.map(target=>{
      const old=catchers.find(c=>c.id===target.id),mix=1-Math.exp(-dt/ .035)
      if(!old)return target
      const x=old.x+(target.x-old.x)*mix,y=old.y+(target.y-old.y)*mix
      return {...target,x,y,points:target.points?.map(p=>({x:p.x+x-target.x,y:p.y+y-target.y}))}
    })
    rain.boost=stamp<rubUntil?boost:0
    ctx.setTransform(dpr,0,0,dpr,0,0)
    const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
    ctx.save();ctx.translate(width,0);ctx.scale(-1,1);ctx.drawImage(video,(width-vw)/2,(height-vh)/2,vw,vh);ctx.restore()
    rain.update(dt,mask,gw,gh,catchers);rain.draw(ctx,width,height,gw,gh,catchers)
    root.classList.toggle('is-money-boost',rain.boost>0)
    if(!loading&&!fallbackPending)guide(rain.boost?'손끝 비비기! 돈과 금이 함께 쏟아져요.':hasBody?'어떤 손 모양으로도 돈을 받아 보세요 · 엄지·검지를 비비면 금도 내려요.':'카메라에 얼굴과 손이 보이도록 서 주세요.',stamp)
  }
  const start=async()=>{
    if(loading||stream||disposed)return
    if(!navigator.mediaDevices?.getUserMedia){say('HTTPS 또는 localhost에서 카메라를 열어 주세요.');return}
    const id=++generation;loading=true;button.disabled=true;say('고화질 카메라와 손 인식을 준비하고 있어요…')
    try{
      const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:low?1280:1920},height:{ideal:low?720:1080},frameRate:{ideal:30,max:30}},audio:false})
      if(disposed||id!==generation){camera.getTracks().forEach(t=>t.stop());return}
      stream=camera;video.srcObject=camera;await video.play()
      if(disposed||id!==generation)return
      if(document.hidden)camera.getVideoTracks().forEach(t=>t.enabled=false)
      else raf=requestAnimationFrame(draw)
      try{await initWorker()}catch{if(!disposed&&id===generation)await startFallback(id)}
      if(disposed||id!==generation)return
      button.textContent='카메라 중지';button.classList.add('is-active')
    }catch{if(!disposed&&id===generation){stop();say('카메라를 열지 못했어요. 권한과 연결을 확인해 주세요.')}}
    finally{if(!disposed&&id===generation){loading=false;button.disabled=false}}
  }
  button.addEventListener('click',()=>{if(stream){stop();root.classList.remove('is-money-boost');say('카메라 중지')}else void start()},{signal:events.signal})
  root.querySelector('#body-separate')!.addEventListener('click',()=>{rain.reset();rub.reset();boost=0;rubUntil=0},{signal:events.signal})
  document.addEventListener('visibilitychange',()=>{
    stream?.getVideoTracks().forEach(t=>t.enabled=!document.hidden)
    if(document.hidden){cancelAnimationFrame(raf);raf=0;rub.reset();boost=0;rubUntil=0}
    else if(stream&&!raf){previous=0;videoTime=-1;raf=requestAnimationFrame(draw)}
  },{signal:events.signal})
  void start()
  return()=>{disposed=true;stop();events.abort();observer.disconnect()}
}
