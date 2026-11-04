import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateWorkoutAccuracy,rangeAccuracy} from '../shared/workout-accuracy.ts';
import {relocateWorkout,scheduledDays} from '../shared/schedule-days.ts';
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
 const stage={...base,seconds:null,meters:5000,paceFastSeconds:null,paceSlowSeconds:null};
 assert.equal(calculateWorkoutAccuracy([stage],{durationSeconds:2000,distanceMeters:5000},{plannedMinutes:20,plannedKm:5}).correct,100);
 assert.equal(calculateWorkoutAccuracy([base],{}).measured,false);
 assert.equal(calculateWorkoutAccuracy([{...base,paceFastSeconds:null,paceSlowSeconds:null}],{durationSeconds:1200,distanceMeters:3000}).correct,100);
});
test('moving a preferred-day workout to any day survives saving and preserves the preference',()=>{
 const preferred=['TER','QUI'];const workout={title:'Leve'},other={title:'Longão'},removed={removed:true};
 const moved=relocateWorkout({TER:workout,QUI:other},'TER','DOM',removed);
 assert.deepEqual(scheduledDays(preferred,moved),['QUI','DOM']);
 assert.equal(moved.DOM,workout);assert.equal(moved.TER.removed,true);assert.deepEqual(preferred,['TER','QUI']);
 const swapped=relocateWorkout(moved,'DOM','QUI',removed);assert.equal(swapped.QUI,workout);assert.equal(swapped.DOM,other);
 assert.deepEqual(scheduledDays(preferred,JSON.parse(JSON.stringify(swapped))),['QUI','DOM']);
});
