import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityResult, expandStages, readMetrics, stepsFromGarminWorkout } from '../shared/activity-results.ts';
import { treinoParaGarmin } from '../worker/garmin-treino.ts';
import { listarAtividades, lerAtividade } from '../worker/garmin-conexao.ts';

const session={token:'synthetic-token',refresh:'',expiraEm:Date.now()+3600000};
const steps=[{kind:'simple',label:'Aquecimento',minutes:5,zone:'Z1'},
 {kind:'repeat',label:'Tiro',repetitions:2,effortSeconds:60,effortZone:'Z4',recoverySeconds:60,recoveryActivity:'walk'},
 {kind:'simple',label:'Desaquecimento',distanceMeters:500,activity:'walk'}];

test('expands every effort and recovery including time, distance and walking',()=>{
 const expanded=expandStages(steps);
 assert.equal(expanded.length,6);
 assert.equal(expanded[0].seconds,300);
 assert.deepEqual(expanded.filter(s=>s.intensity==='recovery').map(s=>s.activity),['walk','walk']);
 assert.equal(expanded[5].meters,500);
 assert.equal(expandStages([{type:'repeat',repetitions:2,effort:{seconds:60},recovery:{seconds:0}}]).length,2);
});

test('missing metrics remain missing; pace uses exact elapsed exercise time',()=>{
 const m=readMetrics({distance:100,duration:30,averageHR:null,averagePower:0,minTemperature:-5});
 assert.equal(m.paceSeconds,300);assert.equal(m.averageHeartRate,undefined);
 assert.equal(m.averagePower,0);assert.equal(m.minTemperature,-5);
});

test('preserves identifiable workout steps with per-lap heart rate and cadence',()=>{
 const duration=[300,60,60,60,60,180];
 const intensity=['WARMUP','ACTIVE','REST','ACTIVE','REST','COOLDOWN'];
 const r=buildActivityResult({provider:'Garmin',activityId:'123',startedAt:Date.now(),plannedSteps:steps,workoutMatch:'workout-id',
  raw:{workoutId:99,distance:2500,duration:720,splits:{lapDTOs:duration.map((seconds,i)=>({lapIndex:i+1,duration:seconds,distance:i===5?500:200,intensityType:intensity[i],averageHR:130+i,averageRunCadence:150+i}))}}});
 assert.equal(r.stages.length,6);assert.equal(r.stages[1].metrics.averageHeartRate,131);
 assert.equal(r.stages[1].metrics.averageCadence,151);assert.equal(r.laps[0].association,'sequence');
});

test('automatic kilometre laps cannot be labelled as planned warmup and intervals',()=>{
 const r=buildActivityResult({provider:'Garmin',activityId:'123',startedAt:Date.now(),plannedSteps:steps,workoutMatch:'date',
 raw:{splits:{lapDTOs:Array.from({length:6},()=>({duration:300,distance:1000}))}}});
 assert.ok(r.stages.every(s=>s.metrics===null));assert.ok(r.laps.every(l=>l.stageIndex===null));
});

test('incomplete workout keeps unmeasured planned stages instead of inventing completion',()=>{
 const r=buildActivityResult({provider:'Amazfit / Zepp',activityId:'z1',startedAt:Date.now(),plannedSteps:steps,
 raw:{step_metrics:[{stepIndex:0,durationSeconds:300,distanceMeters:600,averageHeartRate:128}]}});
 assert.equal(r.stages[0].metrics.averageHeartRate,128);assert.equal(r.stages[1].metrics,null);
 assert.equal(r.laps[0].association,'explicit');
});

test('Garmin step indexes join auto laps in warmup and identify an interrupted repetition',()=>{
 const data=[{step:0,seconds:200,meters:400,type:'WARMUP'}, {step:0,seconds:100,meters:200,type:'WARMUP'},
  {step:1,seconds:60,meters:200,type:'ACTIVE'}, {step:2,seconds:60,meters:100,type:'RECOVERY'},
  {step:1,seconds:10,meters:20,type:'ACTIVE'}];
 const raw={splits:{lapDTOs:data.map((d,i)=>({lapIndex:i+1,wktStepIndex:d.step,wktIndex:0,intensityType:d.type,duration:d.seconds,distance:d.meters,averageHR:140}))},
  typedSplits:{splits:[{type:'INTERVAL_WARMUP',lapIndexes:[1,2],duration:300,distance:600,averageHR:139},
   {type:'INTERVAL_ACTIVE',lapIndexes:[3],duration:60,distance:200}, {type:'INTERVAL_RECOVERY',lapIndexes:[4],duration:60,distance:100},
   {type:'INTERVAL_ACTIVE',lapIndexes:[5],duration:10,distance:20}]}};
 const input={provider:'Garmin',activityId:'123',startedAt:Date.now(),plannedSteps:steps,workoutMatch:'workout-id',raw};
 const result=buildActivityResult(input);
 assert.deepEqual(result.stages[0].lapIndexes,[0,1]);assert.equal(result.stages[0].metrics.durationSeconds,300);
 assert.equal(result.stages[0].metrics.averageHeartRate,139);assert.equal(result.stages[3].metrics.durationSeconds,10);
 assert.equal(result.stages[4].metrics,null);assert.equal(result.stages[5].metrics,null);
 assert.equal(result.laps[4].association,'explicit');
 assert.ok(buildActivityResult({...input,workoutMatch:'date'}).stages.every(s=>s.metrics===null));
 assert.ok(buildActivityResult({...input,allowGarminStepIndexes:false}).stages.every(s=>s.metrics===null));
});

test('Garmin complete intervals retain cooldown and leave the extra recording lap apart',()=>{
 const data=[{step:0,sec:300,type:'WARMUP'}, {step:1,sec:60,type:'ACTIVE'}, {step:2,sec:60,type:'RECOVERY'},
  {step:1,sec:60,type:'ACTIVE'}, {step:2,sec:60,type:'RECOVERY'}, {step:4,sec:180,type:'COOLDOWN'}, {sec:2,type:'ACTIVE'}];
 const raw={splits:{lapDTOs:data.map((d,i)=>({lapIndex:i+1,wktStepIndex:d.step,wktIndex:0,intensityType:d.type,duration:d.sec,distance:100}))},
  typedSplits:{splits:data.map((d,i)=>({type:`INTERVAL_${d.type}`,lapIndexes:[i+1],duration:d.sec,distance:100}))}};
 const result=buildActivityResult({provider:'Garmin',activityId:'123',startedAt:Date.now(),plannedSteps:steps,workoutMatch:'workout-id',raw});
 assert.equal(result.stages.filter(s=>s.metrics).length,6);assert.equal(result.stages[5].metrics.durationSeconds,180);
 assert.equal(result.laps[6].stageIndex,null);
});

test('old publication fingerprints restore the sent workout instead of an edited plan',()=>{
 const original=[{type:'simple',label:'Aquecimento',seconds:300,meters:null,target:null},
  {type:'repeat',label:'Tiro',repetitions:2,effort:{seconds:60,meters:null,activity:'walk',target:null},recovery:{seconds:60,meters:null,target:null}},
  {type:'simple',label:'Desaquecimento',seconds:null,meters:500,target:null}];
 const restored=stepsFromGarminWorkout(treinoParaGarmin({title:'Treino',description:'',estimatedSeconds:720,estimatedMeters:null,maxHeartRate:null,steps:original}));
 assert.deepEqual(expandStages(restored).map(s=>[s.intensity,s.seconds,s.meters,s.activity]),expandStages(original).map(s=>[s.intensity,s.seconds,s.meters,s.activity]));
 assert.equal(stepsFromGarminWorkout({workoutSegments:[]}),null);
 assert.equal(readMetrics({paceSeconds:310}).paceSeconds,310);
});

test('reads Connect activity list and all detail endpoints using mobile bearer headers',async()=>{
 const original=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push([String(url),options]);return Response.json(String(url).includes('activitylist-service')?[{activityId:123}]:{activityId:123,lapDTOs:[]})};
 try {
  assert.equal((await listarAtividades(session,'2026-10-01','2026-10-07')).valor[0].activityId,123);
  const detail=await lerAtividade(session,'123');assert.ok(detail.ok&&detail.valor.complete);
  assert.equal(requests.length,5);assert.ok(requests[2][0].endsWith('/123/splits'));
  assert.ok(requests[3][0].endsWith('/123/typedsplits'));assert.ok(requests[4][0].includes('maxChartSize=2000'));
  assert.ok(requests.every(([,options])=>options.headers.Authorization==='Bearer synthetic-token'));
  assert.ok(requests.every(([url])=>!url.includes('wellness-api')));
 }finally{globalThis.fetch=original}
});

test('a quota error halts detail requests, and invalid identifiers never reach Garmin',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return calls===1?Response.json({activityId:123}):new Response('',{status:429})};
 try{
  const result=await lerAtividade(session,'123');assert.equal(result.falha,'limite_de_tentativas');assert.equal(calls,2);
  assert.equal((await lerAtividade(session,'../tokens')).ok,false);assert.equal(calls,2);
 }finally{globalThis.fetch=original}
});

test('temporarily unavailable detail preserves summary for a later retry',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return calls===2?new Response('',{status:503}):Response.json({activityId:123})};
 try{const result=await lerAtividade(session,'123');assert.equal(result.ok,true);assert.equal(result.valor.complete,false)}finally{globalThis.fetch=original}
});
