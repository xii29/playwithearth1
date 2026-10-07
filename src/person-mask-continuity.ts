// Hold only brief all-empty dropouts; a real departure must still clear.
export class PersonMaskContinuity {
  private emptySince=-Infinity
  private occupied=false
  reset(){this.emptySince=-Infinity;this.occupied=false}
  accept(occupied:boolean,now:number){
    if(occupied){this.occupied=true;this.emptySince=-Infinity;return true}
    if(!this.occupied)return true
    if(!Number.isFinite(this.emptySince))this.emptySince=now
    if(now-this.emptySince<300)return false
    this.occupied=false;return true
  }
}
