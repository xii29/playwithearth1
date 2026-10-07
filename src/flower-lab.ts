import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { createFlowerSculpture } from './flower-sculpture'
import { FlowerHands, type FlowerJoint } from './flower-hands'

export function setupFlowerLab(root:HTMLElement){
  const video=root.querySelector<HTMLVideoElement>('#lab-camera')!,canvas=root.querySelector<HTMLCanvasElement>('#lab-flowers')!
  const toggle=root.querySelector<HTMLButtonElement>('#lab-camera-toggle')!,status=root.querySelector<HTMLElement>('#lab-status')!
  const sculpture=createFlowerSculpture(canvas),hands=new FlowerHands(),events=new AbortController()
  const input=document.createElement('canvas'),ic=input.getContext('2d')!
  let worker:Worker|null=null,model:HandLandmarker|null=null,stream:MediaStream|null=null
  let disposed=false,starting=false,active=false,busy=false,ready=false,generation=0,raf=0,last=0,lastDetect=-Infinity,videoTime=-1
  let cancelInit:(()=>void)|null=null,watchdog=0,cost=30,dirty=true
  const values=[0,0,0]
  const say=(text:string)=>{if(status.textContent!==text)status.textContent=text}
  const resize=()=>{sculpture.resize(Math.max(1,root.clientWidth),Math.max(1,root.clientHeight));dirty=true;schedule()}
  const receive=(landmarks:FlowerJoint[][],labels:string[],stamp:number)=>{
    if(document.hidden||performance.now()-stamp>450)return
    hands.update(landmarks,labels,stamp,input.width/input.height)
  }
  const releaseWorker=()=>{clearTimeout(watchdog);cancelInit?.();cancelInit=null;worker?.terminate();worker=null;ready=false;busy=false}
  const stop=()=>{
    generation++;active=false;starting=false;releaseWorker();model?.close();model=null
    stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;hands.reset()
    toggle.disabled=false;toggle.textContent='카메라 시작';toggle.classList.remove('is-active');schedule()
  }
  const initWorker=()=>new Promise<void>((resolve,reject)=>{
    const current=new Worker(new URL('./shampoo-hand.worker.ts',import.meta.url),{type:'module'});worker=current
    const timer=window.setTimeout(()=>reject(new Error('Tracking timeout')),10000)
    cancelInit=()=>{clearTimeout(timer);reject(new Error('Cancelled'))}
    current.onerror=e=>{e.preventDefault();if(!ready)reject(new Error('Worker unavailable'));else{stop();say('손 인식이 중단됐어요. 카메라를 다시 켜 주세요.')}}
    current.onmessage=({data:m})=>{
      if(disposed||worker!==current)return
      if(m.type==='ready'){ready=true;clearTimeout(timer);cancelInit=null;resolve()}
      if(m.type==='result'){busy=false;clearTimeout(watchdog);cost=cost*.8+Math.max(1,performance.now()-m.timestamp)*.2;receive(m.landmarks,m.handedness,m.timestamp)}
      if(m.type==='error'){if(!ready)reject(new Error('Worker unavailable'));else{stop();say('손 인식이 중단됐어요. 카메라를 다시 켜 주세요.')}}
    }
    current.postMessage({type:'init'})
  })
  const start=async()=>{
    if(active||starting||disposed)return
    const id=++generation;starting=true;toggle.disabled=true;say('양손 인식을 준비하고 있어요…')
    try{
      const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false})
      if(disposed||id!==generation){camera.getTracks().forEach(t=>t.stop());return}
      stream=camera;video.srcObject=camera;await video.play()
      if(disposed||id!==generation)return
      try{await initWorker()}catch{
        if(disposed||id!==generation)return
        releaseWorker()
        const vision=await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
        if(disposed||id!==generation)return
        const created=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,minTrackingConfidence:.5})
        if(disposed||id!==generation){created.close();return}model=created
      }
      if(disposed||id!==generation)return
      active=true;lastDetect=-Infinity;videoTime=-1;cost=30
      stream?.getVideoTracks().forEach(t=>t.enabled=!document.hidden)
      toggle.textContent='카메라 끄기';toggle.classList.add('is-active');schedule()
    }catch{if(!disposed&&id===generation){stop();say('카메라를 시작하지 못했어요. 카메라 권한을 확인해 주세요.')}}
    finally{if(id===generation){starting=false;toggle.disabled=false}}
  }
  const detect=(stamp:number)=>{
    if(!active||busy||video.readyState<2||video.currentTime===videoTime||stamp-lastDetect<Math.max(40,cost*1.15))return
    videoTime=video.currentTime;lastDetect=stamp
    const scale=Math.min(1,720/video.videoWidth),w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale)
    if(input.width!==w||input.height!==h){input.width=w;input.height=h}
    // Selfie-mirrored input keeps anatomical handedness stable across crossing.
    ic.setTransform(-1,0,0,1,w,0);ic.drawImage(video,0,0,w,h)
    if(worker&&ready){
      const current=worker;busy=true
      watchdog=window.setTimeout(()=>{if(current===worker){stop();say('손 인식이 지연됐어요. 카메라를 다시 켜 주세요.')}},2500)
      void createImageBitmap(input).then(bitmap=>{
        if(current!==worker||disposed||document.hidden){bitmap.close();if(current===worker){busy=false;clearTimeout(watchdog)}return}
        current.postMessage({type:'frame',bitmap,timestamp:stamp},[bitmap])
      }).catch(()=>{if(current===worker){stop();say('손 인식을 다시 시작해 주세요.')}})
    }else if(model){
      const started=performance.now()
      try{const result=model.detectForVideo(input,stamp);receive(result.landmarks,result.handedness.map(h=>h[0]?.categoryName??''),stamp)}
      catch{hands.reset()}
      cost=cost*.8+(performance.now()-started)*.2
    }
  }
  function schedule(){if(!raf&&!disposed&&!document.hidden)raf=requestAnimationFrame(frame)}
  function frame(stamp:number){
    raf=0;if(disposed||document.hidden)return
    const dt=last?Math.min(.06,(stamp-last)/1000):1/60;last=stamp
    detect(stamp)
    const target=hands.values(stamp),seen=hands.visible(stamp)
    let moving=false
    values.forEach((value,i)=>{
      const next=value+(target[i]-value)*(1-Math.exp(-dt/.12))
      values[i]=Math.abs(next-target[i])<.001?target[i]:next
      if(values[i]!==value)dirty=true
      if(Math.abs(values[i]-target[i])>.001)moving=true
    })
    if(active)say(seen.some(Boolean)?'손을 천천히 펴서 꽃을 피워 보세요. 오므리면 다시 봉오리가 됩니다.':'양손의 손바닥을 카메라에 보여 주세요.')
    if(dirty){sculpture.update(values);sculpture.render();dirty=false}
    if(active||moving)schedule()
  }
  const observer=new ResizeObserver(resize);observer.observe(root);resize()
  toggle.addEventListener('click',()=>{if(active){stop();say('카메라가 꺼졌어요. 꽃봉오리들이 쉬고 있어요.')}else void start()},{signal:events.signal})
  document.addEventListener('visibilitychange',()=>{
    stream?.getVideoTracks().forEach(t=>t.enabled=!document.hidden)
    if(document.hidden){cancelAnimationFrame(raf);raf=0;hands.reset()}
    else{last=0;videoTime=-1;schedule()}
  },{signal:events.signal})
  return()=>{disposed=true;stop();cancelAnimationFrame(raf);observer.disconnect();events.abort();sculpture.dispose()}
}
