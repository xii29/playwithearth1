export type FaceRegion={x:number;y:number;width:number;height:number}
type Point={x:number;y:number}
/** Coordinates are mirrored screen coordinates. Only right-to-left face sweeps fire. */
export class FaceSwipe {
  private track:{start:Point;last:Point;at:number;seen:number;face:FaceRegion}|null=null
  private cooldown=0
  reset(){this.track=null}
  update(palms:Point[],face:FaceRegion|null,stamp:number){
    if(!face||!palms.length||stamp<this.cooldown){this.reset();return false}
    if(this.track&&(stamp-this.track.seen>260||stamp-this.track.at>1200))this.reset()
    const near=(p:Point,f:FaceRegion)=>Math.abs(p.y-f.y)<Math.max(.08,f.height*.85)&&Math.abs(p.x-f.x)<Math.max(.3,f.width*1.7)
    if(!this.track){
      const p=palms.find(p=>near(p,face)&&p.x>face.x+Math.max(.055,face.width*.3))
      if(p)this.track={start:p,last:p,at:stamp,seen:stamp,face:{...face}}
      return false
    }
    const track=this.track
    const p=palms.reduce((best,p)=>Math.hypot(p.x-track.last.x,p.y-track.last.y)<Math.hypot(best.x-track.last.x,best.y-track.last.y)?p:best)
    if(!near(p,track.face)||Math.hypot(p.x-track.last.x,p.y-track.last.y)>.25||p.x-track.last.x>.07){this.reset();return false}
    track.last=p;track.seen=stamp
    if(stamp-track.at>=100&&p.x<track.face.x-Math.max(.045,track.face.width*.25)&&track.start.x-p.x>Math.max(.15,track.face.width*.85)){
      this.reset();this.cooldown=stamp+1000;return true
    }
    return false
  }
}
