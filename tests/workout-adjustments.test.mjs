import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateWorkoutAccuracy,rangeAccuracy} from '../shared/workout-accuracy.ts';
import {relocateWorkout,scheduledDays} from '../shared/schedule-days.ts';
import {paceSegments,measuredPaceEvidence} from '../shared/pace-adherence.ts';
const base={index:0,label:'Corrida',activity:'run',intensity:'active',zone:'Z2',seconds:1200,meters:null,paceFastSeconds:300,paceSlowSeconds:360};
test('all paces inside the prescribed band earn full credit without penalizing estimated distance',()=>{
 for(const pace of [300,320,360]){
  const metrics={durationSeconds:1200,distanceMeters:1200*1000/pace,paceSeconds:pace};
  assert.equal(calculateWorkoutAccuracy([{...base,metrics}],metrics,{plannedMinutes:20,plannedKm:5}).correct,100);
 }
 assert.equal(rangeAccuracy(320,360,300),100);
 assert.ok(rangeAccuracy(400,300,360)<100);
});
test('distance prescriptions do not penalize estimated time and missing data never earns a measured score',()=>{
 const stage={...base,zone:null,seconds:null,meters:5000,paceFastSeconds:null,paceSlowSeconds:null};
 assert.equal(calculateWorkoutAccuracy([stage],{durationSeconds:2000,distanceMeters:5000},{plannedMinutes:20,plannedKm:5}).correct,100);
 assert.equal(calculateWorkoutAccuracy([base],{}).measured,false);
 assert.equal(calculateWorkoutAccuracy([{...base,paceFastSeconds:null,paceSlowSeconds:null}],{durationSeconds:1200,distanceMeters:3000}).measured,false);
 assert.equal(calculateWorkoutAccuracy([{...base,zone:null,paceFastSeconds:null,paceSlowSeconds:null}],{durationSeconds:1200,distanceMeters:3000}).correct,100);
});
test('five minutes or one hundred metres of total volume deviation are allowed, but never excuse the wrong pace',()=>{
 const timed={...base,seconds:3600,metrics:{durationSeconds:3300,distanceMeters:10000,paceSeconds:330}};
 assert.equal(calculateWorkoutAccuracy([timed],timed.metrics).correct,100);
 const shortWarmup={...base,intensity:'warmup',seconds:600,metrics:{durationSeconds:300,paceSeconds:330}};
 const mainOnTime={...base,index:1,seconds:3000,metrics:{durationSeconds:3000,paceSeconds:330}};
 assert.equal(calculateWorkoutAccuracy([shortWarmup,mainOnTime],{durationSeconds:3300}).correct,100);
 const distance={...base,seconds:null,meters:10000,metrics:{durationSeconds:3267,distanceMeters:9900,paceSeconds:330}};
 assert.equal(calculateWorkoutAccuracy([distance],distance.metrics).correct,100);
 assert.equal(calculateWorkoutAccuracy([{...timed,metrics:{...timed.metrics,paceSeconds:400}}],timed.metrics).correct,0);
});
test('wrong main efforts cannot be compensated by exact volume or a long correct warmup',()=>{
 const warmup={...base,intensity:'warmup',seconds:1800,metrics:{durationSeconds:1800,paceSeconds:330}};
 const main={...base,index:1,seconds:120,paceFastSeconds:240,paceSlowSeconds:270,metrics:{durationSeconds:120,paceSeconds:330}};
 assert.equal(calculateWorkoutAccuracy([warmup,main],{durationSeconds:1920}).correct,0);
});
test('pace samples detect alternating outside-zone running even when the average is perfect',()=>{
 const raw={metricDescriptors:[{key:'sumDuration',metricsIndex:1},{key:'directSpeed',metricsIndex:0}],activityDetailMetrics:[{metrics:[1000/250,0]},{metrics:[1000/410,30]},{metrics:[1000/250,60]}]};
 const evidence=measuredPaceEvidence(paceSegments(raw),[{start:0,end:60}],300,360);
 assert.equal(evidence.seconds,60);assert.equal(evidence.inTargetSeconds,0);
 const s={...base,seconds:60,metrics:{durationSeconds:60,paceSeconds:330},paceEvidence:evidence};
 assert.equal(calculateWorkoutAccuracy([s],{durationSeconds:60}).correct,0);
});
test('unmapped planned work and missing numeric zones cannot produce full credit',()=>{
 const first={...base,seconds:600,metrics:{durationSeconds:600,paceSeconds:330}};
 const missing={...base,index:1,seconds:600,metrics:null};
 const score=calculateWorkoutAccuracy([first,missing],{durationSeconds:1200});
 assert.equal(score.correct,50);assert.equal(score.coverage,50);
 assert.equal(calculateWorkoutAccuracy([{...base,paceFastSeconds:null,paceSlowSeconds:null}],{durationSeconds:1200,paceSeconds:330}).measured,false);
});
test('moving a preferred-day workout to any day survives saving and preserves the preference',()=>{
 const preferred=['TER','QUI'];const workout={title:'Leve'},other={title:'Longão'},removed={removed:true};
 const moved=relocateWorkout({TER:workout,QUI:other},'TER','DOM',removed);
 assert.deepEqual(scheduledDays(preferred,moved),['QUI','DOM']);
 assert.equal(moved.DOM,workout);assert.equal(moved.TER.removed,true);assert.deepEqual(preferred,['TER','QUI']);
 const swapped=relocateWorkout(moved,'DOM','QUI',removed);assert.equal(swapped.QUI,workout);assert.equal(swapped.DOM,other);
 assert.deepEqual(scheduledDays(preferred,JSON.parse(JSON.stringify(swapped))),['QUI','DOM']);
});
