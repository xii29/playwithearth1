type Point = {x:number;y:number}
/** Camera-only clap: apart -> rapidly closing -> contact, with release and cooldown. */
export class BodyClap {
  private armed=false
  private distance=0
  private stamp=-Infinity
  private last=-Infinity
  reset(){this.armed=false;this.stamp=-Infinity;this.distance=0}
  update(hands:Point[][], stamp:number) {
    if(hands.length!==2||hands.some(h=>h.length<21)){this.reset();return false}
    const centers=hands.map(h=>({x:(h[0].x+h[5].x+h[9].x+h[13].x+h[17].x)/5,y:(h[0].y+h[5].y+h[9].y+h[13].y+h[17].y)/5}))
    const gap=Math.hypot(centers[0].x-centers[1].x,centers[0].y-centers[1].y)
    const palm=Math.max(.045,hands.reduce((s,h)=>s+Math.hypot(h[5].x-h[17].x,h[5].y-h[17].y),0)/2)
    const dt=(stamp-this.stamp)/1000,speed=dt>0&&dt<.35?(this.distance-gap)/dt:0
    if(gap>Math.max(.18,palm*2.5))this.armed=true
    const clap=this.armed&&gap<Math.max(.075,palm*1.35)&&speed>.25&&stamp-this.last>900
    this.distance=gap;this.stamp=stamp
    if(clap){this.armed=false;this.last=stamp}
    return clap
  }
}
