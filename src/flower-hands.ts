export type FlowerJoint={x:number;y:number;z?:number}
const clamp=(n:number)=>Math.max(0,Math.min(1,n))
export function handOpenness(hand:FlowerJoint[],aspect=1){
  if(hand.length<21)return 0
  const p=hand.map(v=>({x:v.x,y:v.y/aspect,z:v.z??0}))
  const distance=(a:number,b:number)=>Math.hypot(p[a].x-p[b].x,p[a].y-p[b].y,p[a].z-p[b].z)
  const palm=Math.max(.001,distance(0,9))
  const values=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]].map(([base,a,b,tip],i)=>{
    const path=distance(base,a)+distance(a,b)+distance(b,tip)
    const curl=clamp((distance(base,tip)/Math.max(.001,path)-.5)/.43)
    const reach=clamp((distance(0,tip)/palm-(i===0?.85:1.05))/(i===0?.65:1.1))
    return curl*.72+reach*.28
  })
  return clamp((values[0]*.12+values.slice(1).reduce((a,b)=>a+b,0)*.22-.12)/.8)
}
export class FlowerHands{
  private sides=[{value:0,at:-Infinity},{value:0,at:-Infinity}]
  reset(){this.sides.forEach(s=>{s.value=0;s.at=-Infinity})}
  update(hands:FlowerJoint[][],labels:string[],stamp:number,aspect=1){
    hands.slice(0,2).forEach((h,i)=>{
      if(h.length<21)return
      const label=labels[i]?.toLowerCase(),side=label==='left'?0:label==='right'?1:(h[0].x<.5?0:1)
      this.sides[side]={value:handOpenness(h,aspect),at:stamp}
    })
  }
  values(stamp:number){
    const [left,right]=this.sides.map(s=>stamp-s.at<350?s.value:0)
    return [left,(left+right)/2,right]
  }
  visible(stamp:number){return this.sides.map(s=>stamp-s.at<350)}
}
