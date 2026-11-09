import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import * as schema from '../db/schema.ts';
import { tableSql } from '../db/sql.ts';
import { weekStartOf, workoutDayOf } from '../worker/integrations.ts';
import { readEditorSteps, saveEditorSteps, moveEditorStep } from '../shared/workout-editor.ts';

const hash=value=>createHash('sha256').update(value).digest('hex');
const encryptionKey='test-only-encryption-key';
const startedAt=Date.now()-3600000;
const weekStart=weekStartOf(startedAt),day=workoutDayOf(startedAt);
const plan={title:'Treino leve',durationMinutes:2,estimatedKm:0.4,steps:[{kind:'simple',label:'Aquecimento',seconds:60},{kind:'simple',label:'Desaquecimento',seconds:60}]};

function d1(sqlite){
 return {prepare(sql){let values=[];return{
  bind(...input){values=input;return this},
  async first(column){const row=sqlite.prepare(sql).get(...values);return column?row?.[column]??null:row??null},
  async all(){return{results:sqlite.prepare(sql).all(...values),success:true}},
  async run(){const stmt=sqlite.prepare(sql);if(/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql))return{results:stmt.all(...values),success:true,meta:{changes:0}};
   const result=stmt.run(...values);return{success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}},
 }}, async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out}catch(error){sqlite.exec('ROLLBACK');throw error}},
 async exec(sql){sqlite.exec(sql);return{count:1,duration:0}}};
}
async function fixture(provider='Garmin'){
 const sqlite=new DatabaseSync(':memory:');for(const table of Object.values(schema))for(const sql of tableSql(table))sqlite.exec(sql);
 const now=Date.now();
 const insert=(sql,...values)=>sqlite.prepare(sql).run(...values);
 insert("INSERT INTO athletes (id,name,initials,distance,phase,week,next_workout,integration,coach_email,created_at) VALUES ('athlete','Aluno Teste','AT','5 km','Base','1','Treino',?,'coach@exemplo.test',?)",provider,now);
 insert("INSERT INTO training_weeks (id,athlete_name,week_start,plan,phase,week_label,training_days,sessions,status,updated_at) VALUES ('week','Aluno Teste',?,'Plano','Base','1',?,?,'Liberada',?)",weekStart,JSON.stringify([day]),JSON.stringify({[day]:plan}),now);
 for(const [id,email,role,athleteName,token] of [['student','student@exemplo.test','student','Aluno Teste','b'.repeat(64)],['coach','coach@exemplo.test','coach',null,'c'.repeat(64)],['other','other@exemplo.test','coach',null,'d'.repeat(64)]]){
  insert("INSERT INTO user_accounts (id,email,name,role,athlete_name,password_hash,password_salt,password_iterations,status,must_change_password,failed_attempts,created_at,updated_at) VALUES (?,?,?,?,?,'x','x',1,'Ativo',0,0,?,?)",id,email,id,role,athleteName,now,now);
  insert("INSERT INTO user_sessions (token_hash,user_id,email,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)",hash(token),id,email,now+3600000,now,now);
 }
 insert("INSERT INTO athlete_access (id,athlete_name,email,status,updated_at) VALUES ('access','Aluno Teste','student@exemplo.test','Ativo',?)",now);
 const url=new URL('../dist/server/index.js',import.meta.url);url.searchParams.set('return',crypto.randomUUID());
 const {default:worker}=await import(url);
 const env={DB:d1(sqlite),ASSETS:{fetch:async()=>new Response('',{status:404})},COACH_EMAIL:'coach@exemplo.test',STRAVA_TOKEN_ENCRYPTION_KEY:encryptionKey};
 const pending=[];const ctx={waitUntil(p){pending.push(p)},passThroughOnException(){}};
 const request=async(path,method='GET',body=null,token='b'.repeat(64),headers={})=>worker.fetch(new Request('https://zonas.test'+path,{method,headers:{cookie:`zonas_session=${token}`,...(body?{'content-type':'application/json',origin:'https://zonas.test'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
 return{sqlite,worker,env,ctx,pending,insert,request};
}
async function encrypt(value){const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encryptionKey)),{name:'AES-GCM'},false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));return`${Buffer.from(iv).toString('base64')}.${Buffer.from(bytes).toString('base64')}`}

test('edited stage order persists through the API and reaches Garmin and the Zepp device endpoint unchanged',async()=>{
 const f=await fixture(),now=Date.now(),coach='c'.repeat(64),currentWeek=weekStartOf(now),currentDay=workoutDayOf(now);
 const editor=readEditorSteps([
  {kind:'simple',label:'Aquecimento',meters:1234,distanceUnit:'km',zone:null,activity:'walk'},
  {kind:'repeat',label:'Tiros A',repetitions:2,effortSeconds:60,effortZone:null,recoverySeconds:30,recoveryZone:null},
  {kind:'simple',label:'Desaquecimento',minutes:5,zone:null},
  {kind:'repeat',label:'Tiros B',repetitions:3,effortMeters:200,effortZone:null,recoverySeconds:45,recoveryZone:null},
  {kind:'simple',label:'Aquecimento',seconds:30,zone:null},
 ]);
 const steps=saveEditorSteps(moveEditorStep(editor,editor[2].id,0),()=>undefined);
 const sessions={[currentDay]:{...plan,steps}};
 const sent=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/workout-service/workout')){sent.push(JSON.parse(options.body));return Response.json({workoutId:321})}return Response.json({})};
 try{
  let response=await f.request('/api/training-weeks','POST',{athleteName:'Aluno Teste',weekStart:currentWeek,plan:'Plano',phase:'Base',weekLabel:'Semana 1',trainingDays:[currentDay],sessions,status:'Liberada'},coach);
  assert.ok(response.ok);
  const saved=f.sqlite.prepare('SELECT sessions FROM training_weeks WHERE week_start=?').get(currentWeek);
  assert.deepEqual(JSON.parse(saved.sessions)[currentDay].steps,steps);
  f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?)",await encrypt('test-mobile-token'),now+3600000,now);
  response=await f.request('/api/training-weeks','POST',{action:'publish',athleteName:'Aluno Teste',weekStart:currentWeek},coach);
  assert.equal(response.status,200);assert.equal(sent.length,1);
  const garmin=sent[0].workoutSegments[0].workoutSteps;
  assert.deepEqual(garmin.map(step=>step.stepType.stepTypeKey),['cooldown','warmup','repeat','repeat','warmup']);
  assert.deepEqual(garmin.map(step=>step.stepOrder),[1,2,3,6,9]);
  assert.equal(garmin[1].endConditionValue,1234);
  assert.equal(garmin[2].numberOfIterations,2);assert.equal(garmin[3].numberOfIterations,3);
  assert.equal(garmin[2].workoutSteps[0].targetType.workoutTargetTypeKey,'no.target');
  const token='e'.repeat(48);
  f.insert("INSERT INTO device_ingest_tokens (token_hash,athlete_name,provider,created_at) VALUES (?,'Aluno Teste','zepp',?)",hash(token),now);
  f.insert("UPDATE training_week_publications SET status='published' WHERE provider='zepp'");
  response=await f.request('/api/ingest/device/workout','GET',null,undefined,{'x-zonas-ingest-token':token});
  assert.equal(response.status,200);
  const device=await response.json();
  assert.deepEqual(device.workout.steps.map(step=>step.label),steps.map(step=>step.label));
  assert.equal(device.workout.steps[1].meters,1234);assert.equal(device.workout.steps[1].activity,'walk');
  assert.equal(device.workout.steps[4].seconds,30);
 }finally{globalThis.fetch=original;f.sqlite.close()}
});

test('device completion is persisted once and the same stage metrics are visible to athlete and owning coach',async()=>{
 const f=await fixture('Amazfit / Zepp');const token='a'.repeat(48);
 f.insert("INSERT INTO device_ingest_tokens (token_hash,athlete_name,provider,created_at) VALUES (?,'Aluno Teste','zepp',?)",hash(token),Date.now());
 const activity={trackid:'synthetic-zepp',start_time:Math.floor(startedAt/1000),type:'run',dis:400,run_time:120,avg_heart_rate:140,
  step_metrics:[{stepIndex:0,durationSeconds:60,distanceMeters:200,averageHeartRate:130},{stepIndex:1,durationSeconds:60,distanceMeters:200,averageHeartRate:150}]};
 for(let i=0;i<2;i++)assert.equal((await f.request('/api/ingest/device','POST',{workouts:[activity]},undefined,{'x-zonas-ingest-token':token})).status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workout_executions').get().n,1);
 const student=await(await f.request('/api/student/workout-executions?days=30')).json();
 const coach=await(await f.request('/api/workout-executions','GET',null,'c'.repeat(64))).json();
 assert.equal(student.executions.length,1);assert.deepEqual(student.executions[0].activity_result,coach.executions[0].activity_result);
 assert.equal(student.executions[0].activity_result.stages[1].metrics.averageHeartRate,150);
 const other=await(await f.request('/api/workout-executions','GET',null,'d'.repeat(64))).json();assert.equal(other.executions.length,0);
 f.sqlite.close();
});

test('coach comments and review state persist for the student and stay inside the owning coach portfolio',async()=>{
 const f=await fixture();const now=Date.now();
 f.insert("INSERT INTO workout_executions (id,athlete_name,week_start,workout_day,correct_percentage,wrong_percentage,classification,source,created_at,status) VALUES ('review-me','Aluno Teste',?,?,80,20,'Parcialmente correto','Garmin',?,'Concluído')",weekStart,day,now);
 const coach='c'.repeat(64),other='d'.repeat(64);
 let response=await f.request('/api/workout-executions','POST',{id:'review-me',action:'review',coachNote:'Boa consistência. Faça a próxima etapa mais leve.'},coach);
 assert.equal(response.status,200);let body=await response.json();assert.equal(body.execution.coach_note,'Boa consistência. Faça a próxima etapa mais leve.');assert.ok(body.execution.coach_reviewed_at);
 const student=await(await f.request('/api/student/workout-executions?days=30')).json();assert.equal(student.executions[0].coach_note,'Boa consistência. Faça a próxima etapa mais leve.');
 response=await f.request('/api/workout-executions','POST',{id:'review-me',action:'comment',coachNote:'Comentário alterado'},other);assert.equal(response.status,404);
 response=await f.request('/api/workout-executions','POST',{id:'review-me',action:'reopen'},coach);assert.equal(response.status,200);body=await response.json();assert.equal(body.execution.coach_reviewed_at,null);assert.equal(body.execution.coach_note,'Boa consistência. Faça a próxima etapa mais leve.');
 f.sqlite.close();
});

test('account list repairs only pending logins with exact matching active access',async()=>{
 const f=await fixture();const now=Date.now();
 f.insert("UPDATE athlete_access SET email='student-old@exemplo.test' WHERE athlete_name='Aluno Teste'");
 f.insert("INSERT INTO user_accounts (id,email,name,role,athlete_name,password_hash,password_salt,password_iterations,status,must_change_password,failed_attempts,created_at,updated_at) VALUES ('legacy-active','student-old@exemplo.test','Aluno Teste','student','Aluno Teste','x','x',1,'Aguardando aprovação',0,0,?,?)",now,now);
 f.insert("INSERT INTO user_accounts (id,email,name,role,athlete_name,password_hash,password_salt,password_iterations,status,must_change_password,failed_attempts,created_at,updated_at) VALUES ('other-pending','pending@exemplo.test','Outro','student','Aluno Teste','x','x',1,'Aguardando aprovação',0,0,?,?)",now,now);
 const response=await f.request('/api/accounts','GET',null,'c'.repeat(64));assert.equal(response.status,200);
 assert.equal(f.sqlite.prepare("SELECT status FROM user_accounts WHERE id='legacy-active'").get().status,'Ativo');
 assert.equal(f.sqlite.prepare("SELECT status FROM user_accounts WHERE id='other-pending'").get().status,'Aguardando aprovação');
 f.sqlite.close();
});

test('Garmin cron imports completion automatically, links workoutId, reuses manual record and avoids duplicates',async()=>{
 const f=await fixture();const now=Date.now();
 f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?)",await encrypt('test-mobile-token'),now+3600000,now);
 f.insert("INSERT INTO training_week_publications (id,athlete_name,week_start,provider,status,remote_workouts) VALUES ('pub','Aluno Teste',?,'garmin','sent',?)",weekStart,JSON.stringify({[day]:{workoutId:99,steps:plan.steps}}));
 f.insert("INSERT INTO workout_executions (id,athlete_name,week_start,workout_day,correct_percentage,wrong_percentage,classification,source,created_at,status,note) VALUES ('manual','Aluno Teste',?,?,0,0,'Concluído sem medição','Manual',?,'Concluído','Nota do aluno')",weekStart,day,now);
 const original=globalThis.fetch;let calls=0;
 const activity={activityId:123,beginTimestamp:startedAt,activityType:{typeKey:'running'},distance:400,duration:120,averageHR:140};
 globalThis.fetch=async(url,options)=>{
  calls++;assert.equal(options.headers.Authorization,'Bearer test-mobile-token');
  if(String(url).includes('activitylist-service'))return Response.json([activity]);
  if(String(url).endsWith('/splits'))return Response.json({lapDTOs:[{duration:60,distance:200,averageHR:130,intensityType:'WARMUP'},{duration:60,distance:200,averageHR:150,intensityType:'COOLDOWN'}]});
  if(String(url).endsWith('/123'))return Response.json({...activity,metadataDTO:{associatedWorkoutId:99},summaryDTO:{duration:120,distance:400}});
  return Response.json({});
 };
 try{
  await f.worker.scheduled({cron:'*/10 * * * *',scheduledTime:now},f.env,f.ctx);await Promise.all(f.pending);
  assert.equal(calls,5);const records=f.sqlite.prepare('SELECT * FROM workout_executions').all();assert.equal(records.length,1);
  assert.equal(records[0].id,'manual');assert.equal(records[0].note,'Nota do aluno');assert.equal(records[0].source,'Garmin');
  const result=JSON.parse(records[0].activity_result);assert.equal(result.workoutMatch,'workout-id');assert.equal(result.stages[0].metrics.averageHeartRate,130);
  // Simula a execução seguinte, sem depender de esperar dez minutos.
  f.insert("UPDATE external_integrations SET last_import_attempt_at=0");
  await f.worker.scheduled({cron:'*/10 * * * *',scheduledTime:now+600000},f.env,f.ctx);await Promise.all(f.pending);
  assert.equal(calls,6);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workout_executions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM training_weeks').get().status,'Liberada');
 }finally{globalThis.fetch=original;f.sqlite.close()}
});

test('a cycling activity never completes the running plan',async()=>{
 const f=await fixture('Amazfit / Zepp');const token='a'.repeat(48);
 f.insert("INSERT INTO device_ingest_tokens (token_hash,athlete_name,provider,created_at) VALUES (?,'Aluno Teste','zepp',?)",hash(token),Date.now());
 const activity={trackid:'cycle',start_time:Math.floor(startedAt/1000),type:'cycling',dis:20000,run_time:3600};
 assert.equal((await f.request('/api/ingest/device','POST',{workouts:[activity]},undefined,{'x-zonas-ingest-token':token})).status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workout_executions').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT matched_week_start FROM external_activities').get().matched_week_start,null);
 f.sqlite.close();
});

test('a Garmin workout from another platform is kept apart from the released plan',async()=>{
 const f=await fixture();const now=Date.now();
 f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?)",await encrypt('test-mobile-token'),now+3600000,now);
 const original=globalThis.fetch;
 const activity={activityId:777,beginTimestamp:startedAt,activityType:{typeKey:'running'},distance:400,duration:120,workoutId:900};
 globalThis.fetch=async url=>Response.json(String(url).includes('activitylist-service')?[activity]:String(url).endsWith('/777')?activity:{});
 try{
  await f.worker.scheduled({cron:'*/10 * * * *',scheduledTime:now},f.env,f.ctx);await Promise.all(f.pending);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM external_activities').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM workout_executions').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT matched_week_start FROM external_activities').get().matched_week_start,null);
 }finally{globalThis.fetch=original;f.sqlite.close()}
});

test('workout conversation preserves both authors, reopens review and blocks other portfolios and students',async()=>{
 const f=await fixture();const now=Date.now();
 f.insert("INSERT INTO workout_executions (id,athlete_name,week_start,workout_day,correct_percentage,wrong_percentage,classification,source,created_at,status,coach_note,coach_reviewed_at) VALUES ('chat','Aluno Teste',?,?,100,0,'Dentro do planejado','Garmin',?,'Concluído','Comentário original',?)",weekStart,day,now,now);
 const coach='c'.repeat(64),other='d'.repeat(64);
 let response=await f.request('/api/workout-messages','POST',{executionId:'chat',message:'Como você se sentiu?'},coach);assert.equal(response.status,200);
 response=await f.request('/api/student/workout-messages','POST',{executionId:'chat',message:'Bem, posso caminhar amanhã?'});assert.equal(response.status,200);
 const messages=(await response.json()).messages;assert.deepEqual(messages.map(m=>m.author_role),['coach','coach','student']);assert.equal(messages[0].body,'Comentário original');
 assert.equal(f.sqlite.prepare("SELECT coach_reviewed_at FROM workout_executions WHERE id='chat'").get().coach_reviewed_at,null);
 response=await f.request('/api/workout-messages?executionId=chat','GET',null,other);assert.equal(response.status,403);
 response=await f.request('/api/workout-messages','POST',{executionId:'chat',message:'Outro treinador'},other);assert.equal(response.status,403);
 f.insert("INSERT INTO workout_executions (id,athlete_name,week_start,workout_day,correct_percentage,wrong_percentage,classification,source,created_at) VALUES ('private','Outro Aluno',?,?,0,0,'Sem medição','Manual',?)",weekStart,day,now);
 response=await f.request('/api/student/workout-messages?executionId=private');assert.equal(response.status,404);
 response=await f.request('/api/student/workout-messages','POST',{executionId:'private',message:'Acesso indevido'});assert.equal(response.status,404);
 f.sqlite.close();
});

test('coach can persist a workout outside student preferred days and preserve the removed origin',async()=>{
 const f=await fixture();
 const sessions={TER:{type:'Descanso',removed:true},DOM:plan};
 const response=await f.request('/api/training-weeks','POST',{athleteName:'Aluno Teste',weekStart,plan:'Plano',phase:'Base',weekLabel:'Semana 1',trainingDays:['DOM'],sessions,status:'Liberada'},'c'.repeat(64));
 assert.equal(response.status,201,await response.text());
 const saved=f.sqlite.prepare('SELECT training_days,sessions FROM training_weeks WHERE athlete_name=? AND week_start=?').get('Aluno Teste',weekStart);
 assert.deepEqual(JSON.parse(saved.training_days),['DOM']);assert.equal(JSON.parse(saved.sessions).TER.removed,true);assert.deepEqual(JSON.parse(saved.sessions).DOM,plan);
 f.sqlite.close();
});

test('historical imported pace in range and manual timed workouts ignore estimated distance in both views',async()=>{
 const f=await fixture(),now=Date.now();
 const metrics={durationSeconds:1200,distanceMeters:3750,paceSeconds:320};
 const result={version:1,provider:'Garmin',summary:metrics,laps:[],stages:[{index:0,label:'Leve',activity:'run',seconds:1200,meters:null,paceFastSeconds:300,paceSlowSeconds:360,metrics,lapIndexes:[0]}]};
 f.insert("INSERT INTO workout_executions (id,athlete_name,week_start,workout_day,actual_minutes,actual_km,correct_percentage,wrong_percentage,classification,source,created_at,status,activity_result) VALUES ('old-score','Aluno Teste',?,?,20,'3.75',70,30,'Parcialmente correto','Garmin',?,'Concluído',?)",weekStart,day,now,JSON.stringify(result));
 f.insert("INSERT INTO workout_executions (id,athlete_name,week_start,workout_day,actual_minutes,actual_km,correct_percentage,wrong_percentage,classification,source,created_at,status) VALUES ('manual-score','Aluno Teste',?,?,2,'0.25',70,30,'Parcialmente correto','Manual',?,'Concluído')",weekStart,day,now);
 for(const [url,token] of [['/api/student/workout-executions?days=30','b'.repeat(64)],['/api/workout-executions','c'.repeat(64)]]){
  const response=await f.request(url,'GET',null,token);assert.equal(response.status,200);
  const executions=(await response.json()).executions;assert.equal(executions.length,2);
  assert.ok(executions.every(row=>row.correct_percentage===100));assert.ok(executions.every(row=>!('planned_sessions' in row)));
 }
 f.sqlite.close();
});

const referenceZones=Array.from({length:5},(_,i)=>({z:`Z${i+1}`,label:`Zona ${i+1}`,fast:360-i*30,slow:400-i*30}));
const referenceTempos=Array.from({length:4},(_,i)=>({label:['5 km','10 km','Meia maratona','Maratona'][i],targetPace:300+i*15,projectedTotal:1500}));
function insertZoneTest(f,id,zones,status='Aprovado'){
 f.insert("INSERT INTO performance_tests (id,athlete_name,test_date,test_type,distance_km,total_seconds,age,vam,vo2,fc_max,pace_seconds,zones,tempo_runs,status,created_at) VALUES (?,'Aluno Teste','2026-10-01','3km',3,900,30,'12','40',190,'300',?,?,?,?)",id,JSON.stringify(zones),JSON.stringify(referenceTempos),status,Date.now());
}

test('custom approval survives reload and an approved test cannot silently lose its active ranges through draft save',async()=>{
 const f=await fixture(),coach='c'.repeat(64);
 try{
  await f.request('/api/training-zone-defaults','POST',{zones:referenceZones},coach);
  insertZoneTest(f,'custom-edit',referenceZones,'Aguardando revisão');
  const custom=referenceZones.map(z=>({...z,slow:z.slow+70,fast:z.fast+70}));
  let response=await f.request('/api/performance-tests','POST',{id:'custom-edit',action:'approve',zones:custom,tempoRuns:referenceTempos},coach);
  assert.equal(response.status,200);
  for(const [route,token] of [['/api/performance-tests?athlete=Aluno%20Teste',coach],['/api/student/performance-tests','b'.repeat(64)]]){
   const data=await(await f.request(route,'GET',null,token)).json();
   assert.deepEqual(data.trainingZones,custom.map(z=>({...z,source:'individual'})));
   assert.deepEqual(JSON.parse(data.tests[0].zones),custom);
  }
  response=await f.request('/api/performance-tests','POST',{id:'custom-edit',action:'review',zones:referenceZones,tempoRuns:referenceTempos},coach);
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'approved_test_requires_approval');
  const active=await(await f.request('/api/student/performance-tests')).json();
  assert.deepEqual(active.trainingZones,custom.map(z=>({...z,source:'individual'})));
  assert.equal(active.tests[0].status,'Aprovado');
  const editedAgain=custom.map(z=>({...z,slow:z.slow+10,fast:z.fast+10}));
  response=await f.request('/api/performance-tests','POST',{id:'custom-edit',action:'approve',zones:editedAgain,tempoRuns:referenceTempos},coach);
  assert.equal(response.status,200);
  const reapproved=await(await f.request('/api/student/performance-tests')).json();
  assert.deepEqual(reapproved.trainingZones,editedAgain.map(z=>({...z,source:'individual'})));
  // Simulate another tab approving between the review's status read and write.
  f.insert('UPDATE request_deduplication SET expires_at=0');
  const prepare=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare=sql=>{
   const statement=prepare(sql);
   if(sql.startsWith('SELECT test_type,athlete_name,status FROM performance_tests')){
    const first=statement.first;
    statement.first=async()=>({...await first.call(statement),status:'Aguardando revisão'});
   }
   return statement;
  };
  response=await f.request('/api/performance-tests','POST',{id:'custom-edit',action:'review',zones:referenceZones,tempoRuns:referenceTempos},coach);
  assert.equal(response.status,409);
  const unchanged=f.sqlite.prepare("SELECT status,zones FROM performance_tests WHERE id='custom-edit'").get();
  assert.equal(unchanged.status,'Aprovado');assert.deepEqual(JSON.parse(unchanged.zones),editedAgain);
 }finally{f.sqlite.close()}
});

test('teacher defaults reach student and Garmin; personal zones win; Livre stays without target',async()=>{
 const f=await fixture();const coach='c'.repeat(64),other='d'.repeat(64),now=Date.now();
 let response=await f.request('/api/training-zone-defaults','POST',{zones:referenceZones},coach);assert.equal(response.status,200);
 await f.request('/api/training-zone-defaults','POST',{zones:referenceZones.map(z=>({...z,fast:z.fast+100,slow:z.slow+100}))},other);
 let body=await(await f.request('/api/student/performance-tests')).json();assert.equal(body.trainingZones[0].source,'default');assert.equal(body.trainingZones[0].fast,360);
 response=await f.request('/api/training-zone-defaults','POST',{zones:referenceZones});assert.equal(response.status,403);
 const sessions={[day]:{...plan,steps:[{kind:'simple',label:'Z1',seconds:60,zone:'Z1'},{kind:'simple',label:'Livre',seconds:60,zone:null},{kind:'repeat',repetitions:2,effortSeconds:60,effortZone:'Z4',recoverySeconds:60,recoveryZone:'Z1'}]}};
 f.insert('UPDATE training_weeks SET sessions=?',JSON.stringify(sessions));
 f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?)",await encrypt('test-mobile-token'),now+3600000,now);
 const original=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/workout-service/workout')){sent.push(JSON.parse(options.body));return Response.json({workoutId:123})}return Response.json({})};
 try{
  response=await f.request('/api/training-weeks','POST',{action:'publish',athleteName:'Aluno Teste',weekStart},coach);assert.equal(response.status,200);
  let steps=sent[0].workoutSegments[0].workoutSteps;assert.equal(steps[0].targetType.workoutTargetTypeKey,'pace.zone');assert.equal(steps[0].targetValueOne,2.5);assert.equal(steps[1].targetType.workoutTargetTypeKey,'no.target');assert.equal(steps[2].workoutSteps[0].targetType.workoutTargetTypeKey,'pace.zone');
  insertZoneTest(f,'individual',referenceZones.map(z=>({...z,fast:z.fast+30,slow:z.slow+30})));
  body=await(await f.request('/api/student/performance-tests')).json();assert.equal(body.trainingZones[0].source,'individual');assert.equal(body.trainingZones[0].fast,390);
  // New body avoids submitting the exact same operation within the security dedupe window.
  f.insert('UPDATE request_deduplication SET expires_at=0');
  response=await f.request('/api/training-weeks','POST',{action:'publish',athleteName:'Aluno Teste',weekStart},coach);assert.equal(response.status,200);
  steps=sent[1].workoutSegments[0].workoutSteps;assert.equal(steps[0].targetValueOne,Number((1000/430).toFixed(6)));
 }finally{globalThis.fetch=original;f.sqlite.close()}
});

test('approval queues current publication and cron updates future steps without touching past snapshots',async()=>{
 const f=await fixture(),now=Date.now(),coach='c'.repeat(64);
 const currentWeek=weekStartOf(now),currentDay=workoutDayOf(now);
 f.insert('UPDATE training_weeks SET week_start=?,training_days=?',currentWeek,JSON.stringify([currentDay]));
 const oldWeek=new Date(new Date(currentWeek+'T12:00:00Z').getTime()-7*86400000).toISOString().slice(0,10);
 f.insert("INSERT INTO training_week_publications (id,athlete_name,week_start,provider,status,remote_workouts) VALUES ('current','Aluno Teste',?,'garmin','sent','{}'),('past','Aluno Teste',?,'garmin','sent','{\"saved\":true}')",currentWeek,oldWeek);
 f.insert('UPDATE training_weeks SET sessions=?',JSON.stringify({[currentDay]:{...plan,steps:[{kind:'simple',seconds:120,zone:'Z2'}]}}));
 insertZoneTest(f,'awaiting',referenceZones,'Aguardando revisão');
 const denied=await f.request('/api/performance-tests','POST',{id:'awaiting',action:'approve',zones:referenceZones,tempoRuns:referenceTempos},'d'.repeat(64));assert.equal(denied.status,404);
 let response=await f.request('/api/performance-tests','POST',{id:'awaiting',action:'approve',zones:referenceZones,tempoRuns:referenceTempos},coach);assert.equal(response.status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM pace_refresh_jobs').get().n,1);assert.equal(f.sqlite.prepare('SELECT week_start FROM pace_refresh_jobs').get().week_start,currentWeek);
 f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at,last_import_attempt_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?,?)",await encrypt('test-mobile-token'),now+3600000,now,now);
 const original=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/workout-service/workout')){sent.push(JSON.parse(options.body));return Response.json({workoutId:222})}return Response.json({})};
 try{await f.worker.scheduled({cron:'*/10 * * * *',scheduledTime:now},f.env,f.ctx);await Promise.all(f.pending);assert.equal(sent.length,1);assert.equal(sent[0].workoutSegments[0].workoutSteps[0].targetType.workoutTargetTypeKey,'pace.zone');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM pace_refresh_jobs').get().n,0);assert.equal(f.sqlite.prepare("SELECT remote_workouts FROM training_week_publications WHERE id='past'").get().remote_workouts,'{"saved":true}');}
 finally{globalThis.fetch=original;f.sqlite.close()}
});

test('a normal zone without individual or default ranges is reported instead of silently uploaded without pace',async()=>{
 const f=await fixture(),now=Date.now(),coach='c'.repeat(64);
 f.insert('UPDATE training_weeks SET sessions=?',JSON.stringify({[day]:{...plan,steps:[{kind:'simple',seconds:120,zone:'Z1'}]}}));
 f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?)",await encrypt('test-mobile-token'),now+3600000,now);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({})};
 try{const response=await f.request('/api/training-weeks','POST',{action:'publish',athleteName:'Aluno Teste',weekStart},coach);assert.equal(response.status,200);const body=await response.json();assert.equal(body.providers[0].status,'failed');assert.match(body.providers[0].message,/faltam faixas para Z1/);assert.equal(calls,0);}
 finally{globalThis.fetch=original;f.sqlite.close()}
});

test('failed pace refresh keeps the queue and lease prevents immediate duplicate publication',async()=>{
 const f=await fixture(),now=Date.now(),currentWeek=weekStartOf(now),currentDay=workoutDayOf(now);
 f.insert('UPDATE training_weeks SET week_start=?,training_days=?,sessions=?',currentWeek,JSON.stringify([currentDay]),JSON.stringify({[currentDay]:{...plan,steps:[{kind:'simple',seconds:120,zone:'Z2'}]}}));
 f.insert("INSERT INTO training_week_publications (id,athlete_name,week_start,provider,status,remote_workouts) VALUES ('pub','Aluno Teste',?,'garmin','sent','{}')",currentWeek);
 f.insert("INSERT INTO pace_refresh_jobs (id,athlete_name,week_start,requested_at,lease_until) VALUES ('job','Aluno Teste',?,?,0)",currentWeek,now);
 f.insert("INSERT INTO external_integrations (id,athlete_name,provider,scopes,access_token_encrypted,refresh_token_encrypted,expires_at,status,updated_at,last_import_attempt_at) VALUES ('integration','Aluno Teste','Garmin','',?,'',?,'Conectado',?,?)",await encrypt('test-mobile-token'),now+3600000,now,now);
 insertZoneTest(f,'approved',referenceZones);
 const original=globalThis.fetch;let writes=0;
 globalThis.fetch=async()=>{writes++;return new Response('',{status:503})};
 try{
  await f.worker.scheduled({cron:'*/10 * * * *',scheduledTime:now},f.env,f.ctx);await Promise.all(f.pending);
  assert.equal(writes,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM pace_refresh_jobs').get().n,1);assert.ok(f.sqlite.prepare('SELECT lease_until FROM pace_refresh_jobs').get().lease_until>now);
  await f.worker.scheduled({cron:'*/10 * * * *',scheduledTime:now},f.env,f.ctx);await Promise.all(f.pending);assert.equal(writes,1);
 }finally{globalThis.fetch=original;f.sqlite.close()}
});
