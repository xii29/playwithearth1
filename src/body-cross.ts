type Point={x:number;y:number}
const side=(a:Point,b:Point,p:Point)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)
export function fingersCrossed(h:Point[]){
  if(h.length<21||h.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return false
  const palm=Math.hypot(h[5].x-h[17].x,h[5].y-h[17].y)
  if(palm<.025)return false
  for(let a=5;a<8;a++)for(let b=9;b<12;b++){
    const epsilon=palm*palm*.006
    const s1=side(h[a],h[a+1],h[b]),s2=side(h[a],h[a+1],h[b+1])
    const s3=side(h[b],h[b+1],h[a]),s4=side(h[b],h[b+1],h[a+1])
    if(s1*s2<0&&s3*s4<0&&Math.min(Math.abs(s1),Math.abs(s2),Math.abs(s3),Math.abs(s4))>epsilon)return true
  }
  return false
}
export class CrossedFingers {
  active=false
  private candidate=false
  private since=0
  reset(){this.active=this.candidate=false;this.since=0}
  update(hands:Point[][],stamp:number){
    const next=hands.some(fingersCrossed)
    if(next!==this.candidate){this.candidate=next;this.since=stamp}
    if(stamp-this.since>=(next?220:180))this.active=next
    return this.active
  }
}
