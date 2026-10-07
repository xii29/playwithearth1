import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'

// MediaPipe's module loader needs its default factory exposed on the worker.
const scope=self as typeof self & {import?:(url:string)=>Promise<void>;ModuleFactory?:unknown}
scope.import=async url=>{scope.ModuleFactory=(await import(/* @vite-ignore */ url)).default}
let hands:HandLandmarker|null=null,body:ImageSegmenter|null=null
let maskAt=-Infinity,handAt=-Infinity,cost=20
self.addEventListener('message',async(event:MessageEvent)=>{
  const m=event.data
  if(m.type==='init'){
    try{
      const vision=await FilesetResolver.forVisionTasks(m.base+'wasm',true)
      hands=await HandLandmarker.createFromOptions(vision,{
        baseOptions:{modelAssetPath:m.base+'models/hand_landmarker.task'},runningMode:'VIDEO',numHands:2,
        minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.5,
      })
      body=await ImageSegmenter.createFromOptions(vision,{
        baseOptions:{modelAssetPath:m.base+'models/selfie_multiclass.tflite'},runningMode:'VIDEO',
        outputConfidenceMasks:true,outputCategoryMask:false,
      })
      self.postMessage({type:'ready'})
    }catch{hands?.close();body?.close();self.postMessage({type:'error'})}
    return
  }
  if(m.type!=='frame'||!m.bitmap)return
  const bitmap=m.bitmap as ImageBitmap,started=performance.now()
  try{
    // Never queue frames or run both models in one job. Hands get the slots
    // between body updates; the interval grows automatically on slower devices.
    if(m.timestamp-maskAt>Math.max(110,cost*4)&&body&&Number.isFinite(handAt)){
      const result=body.segmentForVideo(bitmap,m.timestamp)
      try{
        const mask=result.confidenceMasks?.[0]
        if(mask){
          const data=mask.getAsFloat32Array().slice()
          self.postMessage({type:'mask',timestamp:m.timestamp,width:mask.width,height:mask.height,data}, {transfer:[data.buffer]})
        }
      }finally{result.close()}
      maskAt=m.timestamp
    }else if(hands){
      const result=hands.detectForVideo(bitmap,m.timestamp)
      self.postMessage({type:'hands',timestamp:m.timestamp,landmarks:result.landmarks,ids:result.handedness.map(h=>h[0]?.categoryName??'')})
      handAt=m.timestamp
    }
    cost=cost*.8+(performance.now()-started)*.2
    self.postMessage({type:'done',cost})
  }catch{self.postMessage({type:'error'})}
  finally{bitmap.close()}
})
