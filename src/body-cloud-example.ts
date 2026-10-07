import { FilesetResolver, ImageSegmenter, HandLandmarker } from '@mediapipe/tasks-vision'
import { BodyParticles } from './body-particles'
import { createFireworkRenderer } from './firework-renderer'
import { PersonMaskContinuity } from './person-mask-continuity'

export function setupBodyCloud(root:HTMLElement,fireworkMode=false){
  const video=root.querySelector<HTMLVideoElement>('#body-camera')!,canvas=root.querySelector<HTMLCanvasElement>('#body-canvas')!,button=root.querySelector<HTMLButtonElement>('#body-camera-toggle')!,status=root.querySelector<HTMLElement>('#body-status')!
  const ctx=canvas.getContext('2d',{alpha:false})!,sample=document.createElement('canvas'),sc=sample.getContext('2d',{willReadFrequently:true})!,particles=new BodyParticles(),events=new AbortController()
  const low=matchMedia('(pointer:coarse)').matches||navigator.hardwareConcurrency<=4
  const fireworks=fireworkMode?createFireworkRenderer():null
  const people=document.createElement('canvas'),pc=people.getContext('2d')!,matte=document.createElement('canvas'),mc=matte.getContext('2d')!
  let hands:HandLandmarker|null=null,handAt=-Infinity
  let worker:Worker|null=null,busy=false,workerFrame=-Infinity,workerTimer=0
  const input=document.createElement('canvas'),ic=input.getContext('2d')!
  let matteImage:ImageData|null=null
  let maskCleared=true
  const continuity=new PersonMaskContinuity()
  let candidate=new Float32Array(0),personVideoTime=-1,personDirty=true
  let fallbackInputTime=-1,lastMaskAttempt=-Infinity
  let cancelWorkerInit:(()=>void)|null=null
  let width=1,height=1,dpr=1,gw=1,gh=1,mask=new Float32Array(0),model:ImageSegmenter|null=null,stream:MediaStream|null=null,loading=false,disposed=false,generation=0,raf=0,last=0,inferred=-Infinity,videoTime=-1,failures=0
  const clear=()=>{continuity.reset();personDirty=true;personVideoTime=-1;particles.reset();mask.fill(0);fireworks?.setMask(mask,gw,gh);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height)}
  const resize=()=>{
    width=Math.max(1,root.clientWidth);height=Math.max(1,root.clientHeight);dpr=Math.min(devicePixelRatio,1.5)
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)
    const budget=fireworkMode?90000:low?30000:56000,aspect=width/height
    gw=Math.max(8,Math.round(Math.sqrt(budget*aspect)));gh=Math.max(8,Math.round(budget/gw))
    sample.width=matte.width=gw;sample.height=matte.height=gh
    const quality=Math.min(dpr,(low?1280:1920)/Math.max(width,height))
    people.width=fireworks?Math.round(width*quality):1;people.height=fireworks?Math.round(height*quality):1
    mask=new Float32Array(gw*gh);candidate=new Float32Array(gw*gh);matteImage=null;clear();inferred=-Infinity
  }
  const observer=new ResizeObserver(resize);observer.observe(root);resize()
  const stop=()=>{
    fallbackInputTime=-1;lastMaskAttempt=-Infinity
    cancelWorkerInit?.();cancelWorkerInit=null;clearTimeout(workerTimer);worker?.terminate();worker=null;busy=false;workerFrame=-Infinity
    generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;model?.close();model=null;hands?.close();hands=null;handAt=-Infinity;fireworks?.reset();loading=false
    cancelAnimationFrame(raf);raf=0;clear();button.disabled=false;button.textContent='카메라 켜기';button.classList.remove('is-active');inferred=-Infinity;videoTime=-1;last=0
  }

  const receiveMask=(data:Float32Array,sw:number,sh:number,stamp:number)=>{
    if(document.hidden||performance.now()-stamp>900)return
    inferred=stamp
    maskCleared=false
    const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
          let count=0
          for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
            const u=1-((x+.5)/gw*width-(width-vw)/2)/vw,v=((y+.5)/gh*height-(height-vh)/2)/vh
            const mx=Math.max(0,Math.min(sw-1,Math.floor(u*sw))),my=Math.max(0,Math.min(sh-1,Math.floor(v*sh)))
            const a=Math.max(0,Math.min(1,(1-data[my*sw+mx]-.4)/.35));candidate[y*gw+x]=a;if(a>.5)count++
          }
          if(fireworks&&!continuity.accept(count>Math.max(8,gw*gh*.001),stamp))return
          mask.set(candidate)
          if(fireworks){
            fireworks.setMask(mask,gw,gh)
            const image=matteImage??(matteImage=mc.createImageData(gw,gh));for(let i=0;i<mask.length;i++)image.data[i*4+3]=mask[i]*255;mc.putImageData(image,0,0)
            personDirty=true
          }
          else{
            sc.save();sc.translate(gw,0);sc.scale(-1,1);sc.drawImage(video,(width-vw)/2/width*gw,(height-vh)/2/height*gh,vw/width*gw,vh/height*gh);sc.restore()
            particles.update(mask,sc.getImageData(0,0,gw,gh).data,gw,gh)
          }
          const message=fireworks?(count?'사람 인식 중 · 손끝으로 불꽃 위치를 지정하세요.':'검지로 가리키거나 화면을 클릭해 불꽃을 만드세요.'):count?'사람 인식 중 · 움직이면 작은 입자가 흩어지고 다시 모입니다.':'카메라에 얼굴과 몸이 보이도록 서 주세요.'
          if(status.textContent!==message)status.textContent=message
  }
  const receiveHands=(landmarks:{x:number;y:number}[][],ids:string[],stamp:number)=>{
    if(document.hidden||performance.now()-stamp>500)return
    const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
    fireworks?.hands(landmarks.map(h=>h.map(p=>({x:((width-vw)/2+(1-p.x)*vw)/width,y:((height-vh)/2+p.y*vh)/height}))),stamp,ids);handAt=stamp
  }
  const startWorker=()=>new Promise<void>((resolve,reject)=>{
    const current=new Worker(new URL('./firework-vision.worker.ts',import.meta.url),{type:'module'});worker=current
    const timer=window.setTimeout(()=>reject(new Error('Tracking initialization timed out')),20000)
    cancelWorkerInit=()=>{clearTimeout(timer);reject(new Error('Cancelled'))}
    let ready=false
    current.onerror=e=>{e.preventDefault();if(!ready){clearTimeout(timer);reject(new Error('Worker unavailable'))}else{stop();button.title='인식이 중단됐어요. 다시 켜 주세요.'}}
    current.onmessage=({data:m})=>{
      if(worker!==current||disposed)return
      if(m.type==='ready'){ready=true;clearTimeout(timer);cancelWorkerInit=null;resolve()}
      if(m.type==='hands')receiveHands(m.landmarks,m.ids,m.timestamp)
      if(m.type==='mask')receiveMask(m.data,m.width,m.height,m.timestamp)
      if(m.type==='done'){busy=false;clearTimeout(workerTimer)}
      if(m.type==='error'){if(!ready){clearTimeout(timer);reject(new Error('Tracking unavailable'))}else{stop();button.title='인식이 중단됐어요. 다시 켜 주세요.'}}
    }
    current.postMessage({type:'init',base:import.meta.env.BASE_URL+'mediapipe/'})
  })
  const sendFrame=(stamp:number)=>{
    if(!worker||busy||video.readyState<2||video.currentTime===videoTime||stamp-workerFrame<30)return
    videoTime=video.currentTime;workerFrame=stamp;busy=true
    const current=worker,scale=Math.min(1,640/video.videoWidth),w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale)
    if(input.width!==w||input.height!==h){input.width=w;input.height=h}ic.drawImage(video,0,0,w,h)
    workerTimer=window.setTimeout(()=>{if(current===worker){stop();button.title='인식이 지연됐어요. 다시 켜 주세요.'}},5000)
    void createImageBitmap(input).then(bitmap=>{if(disposed||worker!==current||document.hidden){bitmap.close();if(worker===current){busy=false;clearTimeout(workerTimer)}return}current.postMessage({type:'frame',bitmap,timestamp:stamp},[bitmap])}).catch(()=>{if(worker===current){busy=false;clearTimeout(workerTimer)}})
  }
  const draw=(stamp:number)=>{
    raf=0;if(disposed||document.hidden||!stream)return
    raf=requestAnimationFrame(draw)
    if(stamp-last<1000/30)return
    const dt=last?Math.min(.08,(stamp-last)/1000):1/30;last=stamp
    if(worker)sendFrame(stamp)
    if(!worker&&fireworks&&video.readyState>=2&&fallbackInputTime!==video.currentTime){
      const scale=Math.min(1,640/video.videoWidth),w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale)
      if(input.width!==w||input.height!==h){input.width=w;input.height=h}ic.drawImage(video,0,0,w,h);fallbackInputTime=video.currentTime
    }
    if(video.readyState>=2&&hands&&fireworks&&stamp-handAt>110&&stamp-lastMaskAttempt<150){
      try{
        const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
        const result=hands.detectForVideo(input,stamp)
        fireworks.hands(result.landmarks.map(h=>h.map(p=>({x:((width-vw)/2+(1-p.x)*vw)/width,y:((height-vh)/2+p.y*vh)/height}))),stamp,result.handedness?.map(h=>h[0]?.categoryName??''))
      }catch{fireworks.hands([],stamp)}
      handAt=stamp
    }else if(video.readyState>=2&&model&&video.currentTime!==videoTime&&stamp-lastMaskAttempt>(fireworks?(low?100:66):(low?125:83))){
      videoTime=video.currentTime;lastMaskAttempt=stamp
      try{
        const result=model.segmentForVideo(fireworks?input:video,stamp)
        try{
          const source=result.confidenceMasks?.[0]
          if(!source)return
          const raw=source.getAsFloat32Array()
          receiveMask(raw,source.width,source.height,stamp)
        }finally{result.close()}
        failures=0
      }catch{if(++failures>=4){stop();status.textContent='인식이 중단됐어요. 카메라를 다시 켜 주세요.';return}}
    }
    const maskTTL=fireworks?1000:500
    if(stamp-inferred>maskTTL&&!maskCleared){particles.reset();mask.fill(0);fireworks?.setMask(mask,gw,gh);maskCleared=true}
    if(fireworks&&stamp-handAt>350)fireworks.hands([],stamp)
    ctx.setTransform(dpr,0,0,dpr,0,0)
    if(fireworks){
      ctx.fillStyle='#000';ctx.fillRect(0,0,width,height)
      fireworks.draw(ctx,width,height,dt,false)
      if(stamp-inferred<=maskTTL&&video.readyState>=2){
        // Composite current HD camera frames, not low-resolution inference snapshots.
        if(personDirty||personVideoTime!==video.currentTime){
          const pw=people.width,ph=people.height,scale=Math.max(pw/video.videoWidth,ph/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
          pc.clearRect(0,0,pw,ph);pc.save();pc.translate(pw,0);pc.scale(-1,1);pc.drawImage(video,(pw-vw)/2,(ph-vh)/2,vw,vh);pc.restore()
          pc.globalCompositeOperation='destination-in';pc.drawImage(matte,0,0,pw,ph);pc.globalCompositeOperation='source-over';personVideoTime=video.currentTime;personDirty=false
        }
        ctx.drawImage(people,0,0,width,height)
      }
    }else particles.draw(ctx,width,height,dt)
  }
  const start=async()=>{
    if(loading||stream||disposed)return
    if(!navigator.mediaDevices?.getUserMedia){status.textContent='HTTPS 또는 localhost에서 카메라를 열어 주세요.';return}
    const id=++generation;loading=true;button.disabled=true;status.textContent='카메라와 Body Mask를 준비하고 있어요…'
    try{
      const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:fireworks?(low?1280:1920):640},height:{ideal:fireworks?(low?720:1080):480},frameRate:{ideal:fireworks?30:24,max:30}},audio:false})
      if(disposed||id!==generation){camera.getTracks().forEach(t=>t.stop());return}
      stream=camera;video.srcObject=camera;await video.play()
      if(disposed||id!==generation)return
      let workerReady=false
      if(fireworks&&typeof Worker!=='undefined'&&typeof OffscreenCanvas!=='undefined'){
        try{await startWorker();workerReady=true}catch{cancelWorkerInit?.();cancelWorkerInit=null;worker?.terminate();worker=null}
        if(disposed||id!==generation)return
      }
      if(!workerReady){
      const vision=await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
      if(disposed||id!==generation)return
      const ready=await ImageSegmenter.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/selfie_multiclass.tflite`},runningMode:'VIDEO',outputConfidenceMasks:true,outputCategoryMask:false})
      if(disposed||id!==generation){ready.close();return}
      model=ready
      if(fireworks){
        const handModel=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`},runningMode:'VIDEO',numHands:6})
        if(disposed||id!==generation){handModel.close();return}hands=handModel
      }
      }
      failures=0;button.textContent='카메라 중지';button.classList.add('is-active')
      if(document.hidden)stream.getVideoTracks().forEach(t=>{t.enabled=false})
      else raf=requestAnimationFrame(draw)
    }catch{if(!disposed&&id===generation){stop();status.textContent='카메라 또는 모델을 열지 못했어요. 권한과 연결을 확인해 주세요.'}}
    finally{if(!disposed&&id===generation){loading=false;button.disabled=false}}
  }
  button.addEventListener('click',()=>{if(stream){stop();status.textContent='카메라 중지'}else void start()},{signal:events.signal})
  if(fireworks){
    root.querySelector<HTMLSelectElement>('#firework-type')!.addEventListener('change',e=>{fireworks.type=(e.target as HTMLSelectElement).value},{signal:events.signal})
    root.querySelector('#firework-clear')!.addEventListener('click',()=>fireworks.reset(),{signal:events.signal})
    canvas.addEventListener('pointerdown',e=>{const r=canvas.getBoundingClientRect();fireworks.burst((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,performance.now())},{signal:events.signal})
  }
  document.addEventListener('visibilitychange',()=>{
    stream?.getVideoTracks().forEach(t=>{t.enabled=!document.hidden})
    if(document.hidden){cancelAnimationFrame(raf);raf=0;clear()}
    else if(stream&&(model||worker)&&!raf){last=0;inferred=-Infinity;raf=requestAnimationFrame(draw)}
  },{signal:events.signal})
  void start()
  return()=>{disposed=true;stop();fireworks?.dispose();observer.disconnect();events.abort()}
}
