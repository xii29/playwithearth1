type P={x:number;y:number;z:number}
export class PalmTurn {
  private states=new Map<string,{at:number;x:number;y:number;armed:boolean;backSince:number;frontSince:number}>()
  update(hands:P[][],labels:string[],now:number){
    let turned=false;const seen=new Set<string>()
    hands.forEach((p,i)=>{
      if(p.length<21)return
      const id=labels[i];if(!id||labels.filter(x=>x===id).length!==1)return
      seen.add(id)
      const a={x:p[5].x-p[0].x,y:p[5].y-p[0].y,z:p[5].z-p[0].z},b={x:p[17].x-p[0].x,y:p[17].y-p[0].y,z:p[17].z-p[0].z}
      const z=a.x*b.y-a.y*b.x,len=Math.hypot(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,z)
      // MediaPipe handedness assumes mirrored input; this camera input is raw.
      const front=z/Math.max(.00001,len)*(id.toLowerCase()==='left'?-1:1)
      let s=this.states.get(id)
      if(!s||now-s.at>300||Math.hypot(p[0].x-s.x,p[0].y-s.y)>.22){s={at:now,x:p[0].x,y:p[0].y,armed:false,backSince:now,frontSince:now};this.states.set(id,s)}
      if(front<-.45){if(now-s.backSince>200)s.armed=true;s.frontSince=now}
      else if(front>.55){if(s.armed&&now-s.frontSince>180){turned=true;s.armed=false}s.backSince=now}
      else{s.backSince=now;s.frontSince=now}
      s.at=now;s.x=p[0].x;s.y=p[0].y
    })
    for(const id of this.states.keys())if(!seen.has(id))this.states.delete(id)
    return turned
  }
}
