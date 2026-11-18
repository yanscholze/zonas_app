/** Dry-run by default. Uses a private, verified D1 export restored locally. */
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {parsePaceZones} from '../shared/training-zones.ts';
process.umask(0o077);
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const snapshot=value('--snapshot'),coach=value('--coach'),cutoff=Date.parse(value('--cutoff'));
if(!args.includes('--snapshot')||!existsSync(snapshot)||!args.includes('--coach')||!Number.isFinite(cutoff))throw new Error('Provide --snapshot, --coach and --cutoff');
const db=new DatabaseSync(snapshot,{readOnly:true});
const owners=db.prepare("SELECT email FROM user_accounts WHERE name=? AND role='owner'").all(coach);
if(owners.length!==1)throw new Error('Coach must identify exactly one owner');
const athletes=db.prepare('SELECT name FROM athletes WHERE coach_email=?').all(owners[0].email);
const selected=[],missing=[];
for(const athlete of athletes){
 const tests=db.prepare("SELECT id,athlete_name,test_date,created_at,zones FROM performance_tests WHERE athlete_name=? AND status='Aprovado' ORDER BY test_date DESC,created_at DESC").all(athlete.name).filter(row=>parsePaceZones(row.zones).length===5);
 const source=tests.find(row=>row.created_at<cutoff)||tests[0];
 if(source)selected.push(source);else missing.push(athlete.name);
}
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const now=Date.now();
const statements=selected.map(row=>`INSERT INTO athlete_pace_zones (athlete_name,zones,source_test_id,origin,updated_at) SELECT athlete_name,zones,id,'historical-recovery',${now} FROM performance_tests WHERE id=${q(row.id)} AND athlete_name=${q(row.athlete_name)} AND status='Aprovado' AND zones=${q(row.zones)} AND athlete_name IN (SELECT name FROM athletes WHERE coach_email=${q(owners[0].email)}) ON CONFLICT(athlete_name) DO NOTHING;`);
const directory=dirname(snapshot),file=join(directory,'restore-individual-zones.sql');
writeFileSync(file,statements.join('\n'),{mode:0o600});
writeFileSync(join(directory,'zone-recovery-report.json'),JSON.stringify({cutoff:new Date(cutoff).toISOString(),selected,missing},null,2),{mode:0o600});
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',recoverable:selected.length,missing}));
if(args.includes('--apply')){
 const output=execFileSync('npx',['wrangler','d1','execute','zonasapp','--remote','--file',file,'--json'],{encoding:'utf8',maxBuffer:10*1024*1024,timeout:60000});
 writeFileSync(join(directory,'restore-individual-zones-result.json'),output,{mode:0o600});
 console.log('Individual zone restoration executed; concurrent manual edits are preserved.');
}
db.close();
