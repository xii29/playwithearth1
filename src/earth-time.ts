export function koreanVillageTime(now=new Date()) {
  const korea=new Date(now.getTime()+9*3600000)
  const hour=korea.getUTCHours()+korea.getUTCMinutes()/60
  const daylight=Math.max(0,Math.min(1,(hour-5.5)/1.5,(19.5-hour)/1.5))
  const label=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit',hour12:true}).format(now)
  return {hour,daylight,label,period:daylight===0?'밤':daylight<1?'노을':'낮'}
}
