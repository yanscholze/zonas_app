import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityResult, expandStages, readMetrics } from '../shared/activity-results.ts';
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
