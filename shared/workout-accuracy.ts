import type { Metrics, PlannedStage } from './activity-results.ts';
import {PACE_TOLERANCE_SECONDS,type PaceEvidence} from './pace-adherence.ts';
type Stage=PlannedStage & {metrics?:Metrics|null;paceEvidence?:PaceEvidence};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export const ACCURACY_TOLERANCE={timeSeconds:300,distanceMeters:100,paceSeconds:PACE_TOLERANCE_SECONDS};
/** A measured pace is either in the prescribed band (plus GPS margin) or outside. */
export function rangeAccuracy(actual:number,fast:number,slow:number):number{
 return positive(actual)&&actual>=Math.min(fast,slow)-PACE_TOLERANCE_SECONDS&&actual<=Math.max(fast,slow)+PACE_TOLERANCE_SECONDS?100:0;
}
function volumeAccuracy(actual:number,planned:number,tolerance:number):number{
 if(!Number.isFinite(actual)||actual<=0)return 0;
 const excess=Math.max(0,Math.abs(actual-planned)-tolerance);
 return Math.max(0,100-excess/Math.max(tolerance,planned*.1,1)*100);
}
const paceOf=(m:Metrics)=>positive(m.paceSeconds)?m.paceSeconds:positive(m.durationSeconds)&&positive(m.distanceMeters)?m.durationSeconds*1000/m.distanceMeters:undefined;
export function calculateWorkoutAccuracy(stages:Stage[],summary:Metrics,fallback?:{plannedMinutes:number|null;plannedKm:number|null}){
 const totalTime=stages.reduce((s,v)=>s+(v.seconds||0),0),totalDistance=stages.reduce((s,v)=>s+(v.meters||0),0);
 const weight=(s:Stage)=>s.seconds||s.metrics?.durationSeconds||(s.meters?(s.meters/1000*(s.paceSlowSeconds||300)):1);
 const totalWeight=stages.reduce((sum,s)=>sum+weight(s),0);
 const paceScores:Array<{score:number;weight:number;main:boolean}>=[],volumeScores:Array<{score:number;weight:number;main?:boolean}>=[];
 let totalVolume:number|null=null,timeError=0,distanceError=0,timeMeasured=false,distanceMeasured=false;
 let mappedWeight=0,sampleWeight=0,missingPace=false;
 const mapped=stages.filter(s=>s.metrics&&Object.values(s.metrics).some(positive));
 for(const stage of mapped){
  const metrics=stage.metrics!,w=weight(stage);mappedWeight+=w;
  if(positive(stage.meters)&&metrics.distanceMeters!==undefined){distanceError+=Math.abs(metrics.distanceMeters-stage.meters);distanceMeasured=true}
  else if(positive(stage.seconds)&&metrics.durationSeconds!==undefined){timeError+=Math.abs(metrics.durationSeconds-stage.seconds);timeMeasured=true}
  const needsPace=Boolean(stage.zone&&stage.zone.toLowerCase()!=='livre')||positive(stage.paceFastSeconds);
  if(!needsPace)continue;
  if(!positive(stage.paceFastSeconds)||!positive(stage.paceSlowSeconds)){missingPace=true;continue}
  const evidence=stage.paceEvidence,pace=paceOf(metrics);
  if(evidence&&evidence.seconds>0){
   const duration=metrics.durationSeconds||evidence.seconds;
   const coverage=Math.min(1,(evidence.seconds+2)/duration);
   paceScores.push({score:Math.min(100,100*evidence.inTargetSeconds/evidence.seconds)*coverage,weight:w,main:stage.intensity==='active'});sampleWeight+=w;
  }else if(positive(pace))paceScores.push({score:rangeAccuracy(pace,stage.paceFastSeconds,stage.paceSlowSeconds),weight:w,main:stage.intensity==='active'});
  else missingPace=true;
 }
 const allTime=stages.length>0&&stages.every(s=>!positive(s.meters)&&positive(s.seconds));
 const allDistance=stages.length>0&&stages.every(s=>positive(s.meters));
 if(allTime&&summary.durationSeconds!==undefined)totalVolume=volumeAccuracy(summary.durationSeconds,totalTime,ACCURACY_TOLERANCE.timeSeconds);
 else if(allDistance&&summary.distanceMeters!==undefined)totalVolume=volumeAccuracy(summary.distanceMeters,totalDistance,ACCURACY_TOLERANCE.distanceMeters);
 if(!mapped.length&&stages.length){
  const samePace=stages.every(s=>s.paceFastSeconds===stages[0].paceFastSeconds&&s.paceSlowSeconds===stages[0].paceSlowSeconds);
  const needsPace=stages.some(s=>s.zone&&s.zone.toLowerCase()!=='livre'||positive(s.paceFastSeconds));
  const pace=paceOf(summary);
  if(samePace&&positive(stages[0].paceFastSeconds)&&positive(stages[0].paceSlowSeconds)&&positive(pace))paceScores.push({score:rangeAccuracy(pace,stages[0].paceFastSeconds,stages[0].paceSlowSeconds),weight:1,main:true});
  else if(needsPace)missingPace=true;
  if((allTime||allDistance)&&totalVolume!==null&&!missingPace)mappedWeight=totalWeight;
 }
 if(!stages.length&&fallback){
  if(positive(fallback.plannedMinutes)&&summary.durationSeconds!==undefined)volumeScores.push({score:volumeAccuracy(summary.durationSeconds,fallback.plannedMinutes*60,ACCURACY_TOLERANCE.timeSeconds),weight:1});
  if(positive(fallback.plannedKm)&&summary.distanceMeters!==undefined)volumeScores.push({score:volumeAccuracy(summary.distanceMeters,fallback.plannedKm*1000,ACCURACY_TOLERANCE.distanceMeters),weight:1});
 }
 const average=(rows:Array<{score:number;weight:number}>)=>{const weight=rows.reduce((s,v)=>s+v.weight,0);return weight?rows.reduce((s,v)=>s+v.score*v.weight,0)/weight:null};
 const stageTime=timeMeasured?volumeAccuracy(totalTime+timeError,totalTime,ACCURACY_TOLERANCE.timeSeconds):null;
 const stageDistance=distanceMeasured?volumeAccuracy(totalDistance+distanceError,totalDistance,ACCURACY_TOLERANCE.distanceMeters):null;
 const volumes=[totalVolume,stageTime,stageDistance,average(volumeScores)].filter((v):v is number=>v!==null);
 const volume=volumes.length?Math.min(...volumes):null,overallPace=average(paceScores),mainPace=average(paceScores.filter(s=>s.main));
 const pace=overallPace===null?null:Math.min(overallPace,mainPace??overallPace);
 const coverage=totalWeight?Math.min(1,mappedWeight/totalWeight):1;
 const measured=!missingPace&&(volume!==null||pace!==null);
 const correct=measured?Math.round((volume??100)*(pace??100)/100*coverage):0;
 const precision=!measured?'none':pace===null?'volume':sampleWeight>0?'samples':'averages';
 const classification=!measured?'Dados insuficientes para avaliar':coverage<.995?'Avaliação parcial':correct>=80?'Dentro do planejado':correct>=60?'Parcialmente correto':'Fora do planejado';
 const note=!measured?'Não foi possível verificar as zonas/ritmos prescritos; volume isolado não comprova acerto.':`${precision==='samples'?'Ritmo avaliado pelos pontos registrados':precision==='averages'?'Estimativa pelo ritmo médio das etapas':'Apenas volume, sem zona-alvo'}. Cobertura das etapas: ${Math.round(coverage*100)}%. Tolerância total: 5 min ou 100 m; ritmo: ±${PACE_TOLERANCE_SECONDS} s/km. Aquecimento não compensa ritmo errado na parte principal.`;
 return {correct,wrong:measured?100-correct:0,classification,measured,precision,coverage:Math.round(coverage*100),volumeScore:volume,paceScore:pace,note};
}
