import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import * as schema from '../db/schema.ts';
import { tableSql } from '../db/sql.ts';
import { weekStartOf, workoutDayOf } from '../worker/integrations.ts';

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
