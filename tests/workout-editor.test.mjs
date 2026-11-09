import test from 'node:test';
import assert from 'node:assert/strict';
import { readEditorSteps, saveEditorSteps, moveEditorStep } from '../shared/workout-editor.ts';
import { expandStages } from '../shared/activity-results.ts';

const mixed = [
  {kind:'simple',label:'Caminhada',seconds:30,zone:null,activity:'walk'},
  {kind:'repeat',label:'Série A',repetitions:2,effortMeters:400,effortZone:'Z4',recoverySeconds:45,recoveryZone:'Z1',recoveryActivity:'walk'},
  {kind:'simple',label:'Aquecimento',meters:1234,distanceUnit:'km',zone:'Z2'},
  {kind:'simple',label:'Desaquecimento',minutes:5,zone:'Z1'},
  {kind:'repeat',label:'Série B',repetitions:3,effortMinutes:2,effortZone:'Z3',recoveryMinutes:0,recoveryZone:null},
  {kind:'simple',label:'Aquecimento',meters:250,distanceUnit:'m',zone:null},
];

test('mixed stages, repeated labels, exact distance, free zones and zero recovery survive JSON save and reopen',()=>{
  const first=readEditorSteps(mixed);
  assert.equal(new Set(first.map(step=>step.id)).size,mixed.length);
  assert.equal(first[2].amount,1.234);
  const saved=saveEditorSteps(first,()=>undefined);
  const reopened=readEditorSteps(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(saveEditorSteps(reopened,()=>undefined),saved);
  assert.deepEqual(expandStages(saved),expandStages(mixed));
  assert.deepEqual(saved.map(step=>step.label),mixed.map(step=>step.label));
  assert.equal(saved[0].zone,null);assert.equal(saved[0].pace,undefined);
  assert.equal(saved[4].recoveryMinutes,0);
});

test('any stage can move across repeat groups without losing or mutating other stages',()=>{
  const original=readEditorSteps(mixed);
  const moved=moveEditorStep(original,original[3].id,0);
  assert.deepEqual(moved.map(step=>step.label),['Desaquecimento','Caminhada','Série A','Aquecimento','Série B','Aquecimento']);
  assert.deepEqual(original.map(step=>step.label),mixed.map(step=>step.label));
  const again=moveEditorStep(moved,original[1].id,5);
  const saved=saveEditorSteps(again,z=>z==='Z4'?'4:30–5:00/km':undefined);
  assert.deepEqual(saved.map(step=>step.label),['Desaquecimento','Caminhada','Aquecimento','Série B','Aquecimento','Série A']);
  assert.equal(saved[5].effortPace,'4:30–5:00/km');
  assert.equal(saved[5].effortMeters,400);assert.equal(saved[5].recoveryActivity,'walk');
  assert.deepEqual(saveEditorSteps(readEditorSteps(saved),()=>undefined).map(step=>step.label),saved.map(step=>step.label));
  for(const position of [-1,6,NaN,1.5])assert.strictEqual(moveEditorStep(original,original[0].id,position),original);
  assert.strictEqual(moveEditorStep(original,'missing',1),original);
});

test('single optional stage and empty editor do not introduce mandatory warmup or cooldown',()=>{
  assert.deepEqual(saveEditorSteps(readEditorSteps([]),()=>undefined),[]);
  assert.equal(saveEditorSteps(readEditorSteps([mixed[3]]),()=>undefined).length,1);
});
