import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'
const scope=self as typeof self & {import?:(url:string)=>Promise<void>;ModuleFactory?:unknown}
scope.import=async url=>{scope.ModuleFactory=(await import(/* @vite-ignore */ url)).default}
let hands:HandLandmarker,body:ImageSegmenter
let slot=0,failures=0
self.addEventListener('message',async({data:m}:MessageEvent)=>{
  if(m.type==='init'){
    try{
      const files=await FilesetResolver.forVisionTasks(m.base+'wasm',true)
      hands=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:m.base+'models/hand_landmarker.task'},runningMode:'VIDEO',numHands:6})
      body=await ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:m.base+'models/selfie_multiclass.tflite'},runningMode:'VIDEO',outputConfidenceMasks:true,outputCategoryMask:false})
      self.postMessage({type:'ready'})
    }catch{self.postMessage({type:'error'})}return
  }
  if(m.type!=='frame')return
  const bitmap=m.bitmap as ImageBitmap
  try{
    // One model per job, one transferable frame in flight. Rendering never
    // waits for synchronous vision inference on the UI thread.
    if(slot++%3===2){const r=hands.detectForVideo(bitmap,m.timestamp);self.postMessage({type:'hands',landmarks:r.landmarks,ids:r.handedness.map(h=>h[0]?.categoryName??''),timestamp:m.timestamp})}
    else{
      const r=body.segmentForVideo(bitmap,m.timestamp)
      try{const source=r.confidenceMasks?.[0];if(source){const data=source.getAsFloat32Array().slice();self.postMessage({type:'mask',data,width:source.width,height:source.height,timestamp:m.timestamp},{transfer:[data.buffer]})}}finally{r.close()}
    }
    failures=0
  }catch{if(++failures>=3)self.postMessage({type:'error'})}finally{bitmap.close();self.postMessage({type:'done'})}
})
