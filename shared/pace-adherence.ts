export const PACE_TOLERANCE_SECONDS = 3;
export type PaceEvidence = { seconds:number; inTargetSeconds:number; source:'samples' };
type Segment={start:number;end:number;pace:number};
type ChartData={metricDescriptors?:Array<{key?:string;metricsIndex?:number}>;activityDetailMetrics?:Array<{metrics?:unknown[]}>};

/** Garmin detail values are already SI; descriptor.unit.factor is display metadata. */
export function paceSegments(value:unknown):Segment[]{
 const data=value as ChartData|null;
 const descriptors=data?.metricDescriptors||[],rows=data?.activityDetailMetrics||[];
 const find=(pattern:RegExp)=>{const index=descriptors.findIndex(d=>pattern.test(d.key||''));return index<0?-1:descriptors[index].metricsIndex??index};
 const speed=find(/^directSpeed$/i),time=find(/^sumDuration$/i);
 if(speed<0||time<0)return [];
 const segments:Segment[]=[];
 for(let i=0;i<rows.length-1;i++){
  const a=rows[i].metrics,b=rows[i+1].metrics;
  if(!a||!b||a[time]===null||b[time]===null||a[speed]===null)continue;
  const start=Number(a[time]),end=Number(b[time]),velocity=Number(a[speed]);
  if(![start,end,velocity].every(Number.isFinite)||start<0||end<=start||end-start>30||velocity<0)continue;
  segments.push({start,end,pace:velocity>0?1000/velocity:Infinity});
 }
 return segments;
}

export function measuredPaceEvidence(segments:Segment[],windows:Array<{start:number;end:number}>,fast:number|null,slow:number|null):PaceEvidence|undefined{
 if(!fast||!slow||!windows.length||!segments.length)return;
 let seconds=0,inTargetSeconds=0;
 for(const window of windows)for(const point of segments){
  const overlap=Math.max(0,Math.min(window.end,point.end)-Math.max(window.start,point.start));
  if(point.start>=window.end)break;
  if(!overlap)continue;
  seconds+=overlap;
  if(point.pace>=fast-PACE_TOLERANCE_SECONDS&&point.pace<=slow+PACE_TOLERANCE_SECONDS)inTargetSeconds+=overlap;
 }
 return seconds>0?{seconds,inTargetSeconds,source:'samples'}:undefined;
}
