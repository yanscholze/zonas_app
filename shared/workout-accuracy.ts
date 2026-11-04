import type { Metrics, PlannedStage } from './activity-results.ts';
type Stage=PlannedStage & {metrics?:Metrics|null};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
/** A faixa inteira vale 100; fora dela, mede o desvio da borda mais próxima. */
export function rangeAccuracy(actual:number,fast:number,slow:number):number{
  const lower=Math.min(fast,slow),upper=Math.max(fast,slow);
  const boundary=actual<lower?lower:actual>upper?upper:actual;
  return Math.max(0,100-Math.abs(actual-boundary)/boundary*100);
}
export function calculateWorkoutAccuracy(stages:Stage[],summary:Metrics,fallback?:{plannedMinutes:number|null;plannedKm:number|null}){
  const measured:Array<{score:number;weight:number}>=[];
  const compare=(stage:Stage,metrics:Metrics)=>{
    const scores:number[]=[];
    // Distância e tempo estimados da sessão não são alvos de uma etapa.
    if(positive(stage.meters)&&positive(metrics.distanceMeters))scores.push(rangeAccuracy(metrics.distanceMeters,stage.meters,stage.meters));
    else if(positive(stage.seconds)&&positive(metrics.durationSeconds))scores.push(rangeAccuracy(metrics.durationSeconds,stage.seconds,stage.seconds));
    const pace=metrics.paceSeconds??(positive(metrics.durationSeconds)&&positive(metrics.distanceMeters)?metrics.durationSeconds*1000/metrics.distanceMeters:undefined);
    if(positive(stage.paceFastSeconds)&&positive(stage.paceSlowSeconds)&&positive(pace))scores.push(rangeAccuracy(pace,stage.paceFastSeconds,stage.paceSlowSeconds));
    if(scores.length)measured.push({score:scores.reduce((a,b)=>a+b,0)/scores.length,weight:stage.seconds||metrics.durationSeconds||(stage.meters?stage.meters/3:1)});
  };
  const mapped=stages.filter(stage=>stage.metrics);
  if(mapped.length)mapped.forEach(stage=>compare(stage,stage.metrics!));
  else if(stages.length){
    // Sem divisões, só é possível comparar o volume total da mesma unidade.
    const allDistance=stages.every(stage=>positive(stage.meters));
    const allTime=stages.every(stage=>!positive(stage.meters)&&positive(stage.seconds));
    if(allDistance||allTime){
      const samePace=stages.every(stage=>stage.paceFastSeconds===stages[0].paceFastSeconds&&stage.paceSlowSeconds===stages[0].paceSlowSeconds);
      compare({...stages[0],meters:allDistance?stages.reduce((s,v)=>s+(v.meters||0),0):null,seconds:allTime?stages.reduce((s,v)=>s+(v.seconds||0),0):null,paceFastSeconds:samePace?stages[0].paceFastSeconds:null,paceSlowSeconds:samePace?stages[0].paceSlowSeconds:null},summary);
    }
  }else if(fallback){
    const scores:number[]=[];
    if(positive(fallback.plannedMinutes)&&positive(summary.durationSeconds))scores.push(rangeAccuracy(summary.durationSeconds,fallback.plannedMinutes*60,fallback.plannedMinutes*60));
    if(positive(fallback.plannedKm)&&positive(summary.distanceMeters))scores.push(rangeAccuracy(summary.distanceMeters,fallback.plannedKm*1000,fallback.plannedKm*1000));
    if(scores.length)measured.push({score:scores.reduce((a,b)=>a+b,0)/scores.length,weight:1});
  }
  const total=measured.reduce((s,v)=>s+v.weight,0);
  const correct=total?Math.round(measured.reduce((s,v)=>s+v.score*v.weight,0)/total):0;
  return {correct,wrong:total?100-correct:0,classification:!total?'Concluído sem medição':correct>=80?'Dentro do planejado':correct>=60?'Parcialmente correto':'Fora do planejado',measured:Boolean(total)};
}
