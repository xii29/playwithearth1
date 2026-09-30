import { FilesetResolver, ImageSegmenter, HandLandmarker } from '@mediapipe/tasks-vision'
import { BodyParticles } from './body-particles'
import { Afterglow } from './afterglow'

export function setupBodyCloud(root:HTMLElement,fireworkMode=false){
  const video=root.querySelector<HTMLVideoElement>('#body-camera')!,canvas=root.querySelector<HTMLCanvasElement>('#body-canvas')!,button=root.querySelector<HTMLButtonElement>('#body-camera-toggle')!,status=root.querySelector<HTMLElement>('#body-status')!
  const ctx=canvas.getContext('2d',{alpha:false})!,sample=document.createElement('canvas'),sc=sample.getContext('2d',{willReadFrequently:true})!,particles=new BodyParticles(),events=new AbortController()
  const low=matchMedia('(pointer:coarse)').matches||navigator.hardwareConcurrency<=4
  const fireworks=fireworkMode?new Afterglow():null
  let hands:HandLandmarker|null=null,handAt=-Infinity
  let width=1,height=1,dpr=1,gw=1,gh=1,mask=new Float32Array(0),model:ImageSegmenter|null=null,stream:MediaStream|null=null,loading=false,disposed=false,generation=0,raf=0,last=0,inferred=-Infinity,videoTime=-1,failures=0
  const clear=()=>{particles.reset();mask.fill(0);fireworks?.setMask(mask,gw,gh);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height)}
  const resize=()=>{
    const box=root.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);dpr=Math.min(devicePixelRatio,1.5)
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)
    const budget=fireworkMode?12000:low?18000:32000,aspect=width/height
    gw=Math.max(8,Math.round(Math.sqrt(budget*aspect)));gh=Math.max(8,Math.round(budget/gw))
    sample.width=gw;sample.height=gh;mask=new Float32Array(gw*gh);clear();inferred=-Infinity
  }
  const observer=new ResizeObserver(resize);observer.observe(root);resize()
  const stop=()=>{
    generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;model?.close();model=null;hands?.close();hands=null;handAt=-Infinity;fireworks?.reset();loading=false
    cancelAnimationFrame(raf);raf=0;clear();button.disabled=false;button.textContent='카메라 켜기';button.classList.remove('is-active');inferred=-Infinity;videoTime=-1;last=0
  }
  const draw=(stamp:number)=>{
    raf=0;if(disposed||document.hidden||!stream)return
    raf=requestAnimationFrame(draw)
    if(stamp-last<1000/30)return
    const dt=last?Math.min(.08,(stamp-last)/1000):1/30;last=stamp
    if(video.readyState>=2&&hands&&fireworks&&stamp-handAt>110){
      try{
        const scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
        fireworks.hands(hands.detectForVideo(video,stamp).landmarks.map(h=>h.map(p=>({x:((width-vw)/2+(1-p.x)*vw)/width,y:((height-vh)/2+p.y*vh)/height}))),stamp)
      }catch{fireworks.hands([],stamp)}
      handAt=stamp
    }else if(video.readyState>=2&&model&&video.currentTime!==videoTime&&stamp-inferred>(low?125:83)){
      videoTime=video.currentTime;inferred=stamp
      try{
        const result=model.segmentForVideo(video,stamp)
        try{
          const source=result.confidenceMasks?.[0]
          if(!source){clear();return}
          const data=source.getAsFloat32Array(),scale=Math.max(width/video.videoWidth,height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale
          let count=0
          for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
            const u=1-((x+.5)/gw*width-(width-vw)/2)/vw,v=((y+.5)/gh*height-(height-vh)/2)/vh
            const mx=Math.max(0,Math.min(source.width-1,Math.floor(u*source.width))),my=Math.max(0,Math.min(source.height-1,Math.floor(v*source.height)))
            const a=Math.max(0,Math.min(1,(1-data[my*source.width+mx]-.4)/.35));mask[y*gw+x]=a;if(a>.5)count++
          }
          if(fireworks)fireworks.setMask(mask,gw,gh)
          else{
            sc.save();sc.translate(gw,0);sc.scale(-1,1);sc.drawImage(video,(width-vw)/2/width*gw,(height-vh)/2/height*gh,vw/width*gw,vh/height*gh);sc.restore()
            particles.update(mask,sc.getImageData(0,0,gw,gh).data,gw,gh)
          }
          const message=fireworks?(count?'사람 인식 중 · 손끝으로 불꽃 위치를 지정하세요.':'검지로 가리키거나 화면을 클릭해 불꽃을 만드세요.'):count?'사람 인식 중 · 움직이면 작은 입자가 흩어지고 다시 모입니다.':'카메라에 얼굴과 몸이 보이도록 서 주세요.'
          if(status.textContent!==message)status.textContent=message
        }finally{result.close()}
        failures=0
      }catch{if(++failures>=4){stop();status.textContent='인식이 중단됐어요. 카메라를 다시 켜 주세요.';return}}
    }
    if(stamp-inferred>500){particles.reset();mask.fill(0);fireworks?.setMask(mask,gw,gh)}
    if(fireworks&&stamp-handAt>350)fireworks.hands([],stamp)
    ctx.setTransform(dpr,0,0,dpr,0,0)
    if(fireworks)fireworks.draw(ctx,width,height,dt);else particles.draw(ctx,width,height,dt)
  }
  const start=async()=>{
    if(loading||stream||disposed)return
    if(!navigator.mediaDevices?.getUserMedia){status.textContent='HTTPS 또는 localhost에서 카메라를 열어 주세요.';return}
    const id=++generation;loading=true;button.disabled=true;status.textContent='카메라와 Body Mask를 준비하고 있어요…'
    try{
      const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}},audio:false})
      if(disposed||id!==generation){camera.getTracks().forEach(t=>t.stop());return}
      stream=camera;video.srcObject=camera;await video.play()
      if(disposed||id!==generation)return
      const vision=await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
      if(disposed||id!==generation)return
      const ready=await ImageSegmenter.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/selfie_multiclass.tflite`},runningMode:'VIDEO',outputConfidenceMasks:true,outputCategoryMask:false})
      if(disposed||id!==generation){ready.close();return}
      model=ready
      if(fireworks){
        const handModel=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`},runningMode:'VIDEO',numHands:2})
        if(disposed||id!==generation){handModel.close();return}hands=handModel
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
    else if(stream&&model&&!raf){last=0;inferred=-Infinity;raf=requestAnimationFrame(draw)}
  },{signal:events.signal})
  void start()
  return()=>{disposed=true;stop();observer.disconnect();events.abort()}
}
