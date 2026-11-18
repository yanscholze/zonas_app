/** Recompute from stored raw pace points, preserving original targets and stage mappings. */
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {enrichPaceEvidence,expandStages} from '../shared/activity-results.ts';
import {calculateWorkoutAccuracy} from '../shared/workout-accuracy.ts';
process.umask(0o077);
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const snapshot=value('--snapshot'),coach=value('--coach');
if(!args.includes('--snapshot')||!existsSync(snapshot)||!args.includes('--coach'))throw new Error('Provide --snapshot and --coach');
const db=new DatabaseSync(snapshot,{readOnly:true}),q=value=>"'"+String(value).replaceAll("'","''")+"'";
const owners=db.prepare("SELECT email FROM user_accounts WHERE name=? AND role='owner'").all(coach);
if(owners.length!==1)throw new Error('Coach must identify exactly one owner');
const rows=db.prepare("SELECT * FROM external_activities WHERE athlete_name IN (SELECT name FROM athletes WHERE coach_email=?) AND activity_result IS NOT NULL").all(owners[0].email);
const statements=[],report=[],processed=new Set();
for(const row of rows){
 const prior=JSON.parse(row.activity_result),raw=JSON.parse(row.raw_payload);
 if(prior.mappingVersion!==3)continue;
 const result=enrichPaceEvidence(prior,raw.charts);
 const patches=result.stages.flatMap((stage,index)=>stage.paceEvidence?[{path:`$.stages[${index}].paceEvidence`,value:stage.paceEvidence}]:[]);
 if(!patches.length)continue;
 const guard=`id=${q(row.id)} AND json_extract(activity_result,'$.importedAt')=${Number(prior.importedAt)}`;
 for(let start=0;start<patches.length;start+=20){
  const pairs=patches.slice(start,start+20).map(p=>`${q(p.path)},json(${q(JSON.stringify(p.value))})`);
  statements.push(`UPDATE external_activities SET activity_result=json_set(activity_result,${pairs.join(',')}) WHERE ${guard};`);
 }
 statements.push(`UPDATE external_activities SET activity_result=json_set(activity_result,'$.mappingVersion',4) WHERE ${guard};`);
 const executions=db.prepare('SELECT * FROM workout_executions WHERE athlete_name=? AND external_activity_id=? AND source=?').all(row.athlete_name,row.external_activity_id,row.provider);
 for(const execution of executions){
  if(execution.status==='Não realizado')continue;
  const old=execution.activity_result?JSON.parse(execution.activity_result):null;
  if(!old||old.importedAt!==prior.importedAt)continue;
  const analysis=calculateWorkoutAccuracy(result.stages,result.summary,{plannedMinutes:Number(execution.planned_minutes)||null,plannedKm:Number(execution.planned_km)||null});
  statements.push(`UPDATE workout_executions SET activity_result=(SELECT activity_result FROM external_activities WHERE ${guard}),correct_percentage=${analysis.correct},wrong_percentage=${analysis.wrong},classification=${q(analysis.classification)} WHERE id=${q(execution.id)} AND json_extract(activity_result,'$.importedAt')=${Number(prior.importedAt)} AND EXISTS(SELECT 1 FROM external_activities WHERE ${guard});`);
  report.push({id:execution.id,athlete:row.athlete_name,week:execution.week_start,day:execution.workout_day,before:execution.correct_percentage,after:analysis.correct,coverage:analysis.coverage,precision:analysis.precision});
  processed.add(execution.id);
 }
}
const remaining=db.prepare("SELECT e.*,w.sessions FROM workout_executions e LEFT JOIN training_weeks w ON w.athlete_name=e.athlete_name AND w.week_start=e.week_start WHERE e.athlete_name IN (SELECT name FROM athletes WHERE coach_email=?) AND COALESCE(e.status,'')<>'Não realizado'").all(owners[0].email);
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):q(value);
for(const execution of remaining){
 if(processed.has(execution.id))continue;
 const result=execution.activity_result?JSON.parse(execution.activity_result):null;
 const session=JSON.parse(execution.sessions||'{}')[execution.workout_day]||{};
 const stages=result?.stages?.length?result.stages:expandStages(session.steps);
 const summary=result?.summary||{durationSeconds:Number(execution.actual_minutes)*60||undefined,distanceMeters:Number(execution.actual_km)*1000||undefined};
 const analysis=calculateWorkoutAccuracy(stages,summary,{plannedMinutes:Number(execution.planned_minutes)||null,plannedKm:Number(execution.planned_km)||null});
 statements.push(`UPDATE workout_executions SET correct_percentage=${analysis.correct},wrong_percentage=${analysis.wrong},classification=${q(analysis.classification)} WHERE id=${q(execution.id)} AND correct_percentage=${Number(execution.correct_percentage)} AND actual_minutes IS ${literal(execution.actual_minutes)} AND actual_km IS ${literal(execution.actual_km)};`);
 report.push({id:execution.id,athlete:execution.athlete_name,week:execution.week_start,day:execution.workout_day,before:execution.correct_percentage,after:analysis.correct,coverage:analysis.coverage,precision:analysis.precision});
}
const directory=dirname(snapshot),file=join(directory,'recalculate-accuracy.sql');
writeFileSync(file,statements.join('\n'),{mode:0o600});
writeFileSync(join(directory,'accuracy-recalculation-report.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',activities:rows.length,executions:report.length,changed:report.filter(r=>r.before!==r.after).length}));
if(args.includes('--apply')){
 const output=execFileSync('npx',['wrangler','d1','execute','zonasapp','--remote','--file',file,'--json'],{encoding:'utf8',maxBuffer:30*1024*1024,timeout:60000});
 writeFileSync(join(directory,'recalculate-accuracy-result.json'),output,{mode:0o600});
 console.log('Historical accuracy recalculated; concurrent imports and original activity data are preserved.');
}
db.close();
