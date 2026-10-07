type Landmark={x:number;y:number;visibility?:number}
// Only head and trunk occlude the fireworks. Explicitly erase arm/hand
// capsules as well, including arms crossed in front of the trunk.
export function corePersonMask(background:Float32Array,w:number,h:number,poses:Landmark[][],canvas:OffscreenCanvas|HTMLCanvasElement){
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  const c=canvas.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D
  c.clearRect(0,0,w,h);c.fillStyle='#fff';c.globalCompositeOperation='source-over'
  const valid=(p:Landmark|undefined)=>!!p&&(p.visibility??1)>.45
  for(const p of poses){
    if(![11,12].every(i=>valid(p[i])))continue
    // Missing hips in a close-up must not make the detected face disappear.
    if([23,24].every(i=>valid(p[i]))){c.beginPath();[11,12,24,23].forEach((i,j)=>{if(j)c.lineTo(p[i].x*w,p[i].y*h);else c.moveTo(p[i].x*w,p[i].y*h)});c.closePath();c.fill()}
    if(valid(p[0])){
      const span=Math.hypot((p[11].x-p[12].x)*w,(p[11].y-p[12].y)*h)
      const ears=valid(p[7])&&valid(p[8])?Math.hypot((p[7].x-p[8].x)*w,(p[7].y-p[8].y)*h):0
      const radius=Math.max(ears*.7,span*.26)
      c.beginPath();c.ellipse(p[0].x*w,p[0].y*h-radius*.12,radius,radius*1.35,0,0,Math.PI*2);c.fill()
      const neckX=(p[11].x+p[12].x)*w/2,neckY=(p[11].y+p[12].y)*h/2
      c.lineWidth=radius*.85;c.strokeStyle='#fff';c.beginPath();c.moveTo(p[0].x*w,p[0].y*h);c.lineTo(neckX,neckY);c.stroke()
    }
  }
  c.globalCompositeOperation='destination-out';c.strokeStyle='#fff';c.lineCap='round'
  for(const p of poses){
    if(!valid(p[11])||!valid(p[12]))continue
    const span=Math.hypot((p[11].x-p[12].x)*w,(p[11].y-p[12].y)*h)
    for(const [a,b,d,e] of [[11,13,15,19],[12,14,16,20]]){
      if(!valid(p[a])||!valid(p[b]))continue
      c.lineWidth=Math.max(3,span*.23);c.beginPath();c.moveTo((p[a].x*.8+p[b].x*.2)*w,(p[a].y*.8+p[b].y*.2)*h);c.lineTo(p[b].x*w,p[b].y*h)
      if(valid(p[d]))c.lineTo(p[d].x*w,p[d].y*h)
      if(valid(p[e]))c.lineTo(p[e].x*w,p[e].y*h)
      c.stroke()
    }
  }
  c.globalCompositeOperation='source-over'
  const pixels=c.getImageData(0,0,w,h).data,out=new Float32Array(w*h)
  for(let i=0;i<out.length;i++)out[i]=1-(1-background[i])*pixels[i*4+3]/255
  return out
}
