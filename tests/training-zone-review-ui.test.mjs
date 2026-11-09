import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const chrome='/usr/bin/google-chrome';
const available=await access(chrome).then(()=>true,()=>false);

test('reviewed custom ranges remain visible after save and remount; a new draft never replaces active zones', {skip:!available}, async()=>{
 const source=await readFile('app/ZonasAppClient.tsx','utf8');
 const format=source.slice(source.indexOf('function pace('),source.indexOf('function mondayOf('));
 const helpers=source.slice(source.indexOf('type PerformanceTestType ='),source.indexOf('function PendingTestCenter('));
 const component=source.slice(source.indexOf('function PendingTestCenter('),source.indexOf('\nfunction TestCalculator('));
 const dir=await mkdtemp(join(tmpdir(),'zonas-review-'));
 const script=`
 import {useState,useEffect,useRef,useCallback} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import CurrentTrainingZones from './app/CurrentTrainingZones';import {parsePaceZones} from './shared/training-zones';
 const avise=()=>{};const pergunte=async()=>true;const plural=(n,label)=>n+' '+label;const describeError=(error,fallback)=>error.message||fallback;
 ${format}
 ${helpers}
 let tests=[{id:'active',athlete_name:'Aluno',test_type:'3km',test_date:'2026-10-01',distance_km:3,total_seconds:900,status:'Aprovado',
 zones:JSON.stringify(Array.from({length:5},(_,i)=>({z:'Z'+(i+1),label:'Zona '+(i+1),slow:400-i*30,fast:360-i*30}))),
 tempo_runs:JSON.stringify(['5 km','10 km','Meia maratona','Maratona'].map(label=>({label,targetPace:300,projectedTotal:1500})))}];
 let posts=[];let reads=0;
 const api={get:async()=>{reads++;return {tests:JSON.parse(JSON.stringify(tests)),trainingZones:JSON.parse(tests.find(t=>t.status==='Aprovado').zones).map(z=>({...z,source:'individual'}))}},post:async(path,body)=>{
 if(body.zones.some(z=>!Number.isFinite(z.slow)||!Number.isFinite(z.fast)))throw new Error('Confira os ritmos em min:seg/km.');
 posts.push(body);tests=tests.map(t=>t.id===body.id?{...t,zones:JSON.stringify(body.zones),tempo_runs:JSON.stringify(body.tempoRuns),status:body.action==='approve'?'Aprovado':'Rascunho revisado'}:t);return {alreadySaved:true};
 }};
 ${component}
 const root=createRoot(document.getElementById('app'));const wait=()=>new Promise(resolve=>setTimeout(resolve,40));
 const check=(v,message)=>{if(!v)throw new Error(message)};
 const until=async(predicate)=>{for(let i=0;i<50;i++){if(predicate())return;await wait()}throw new Error('Timed out waiting for saved zones')};
 const click=async(element)=>{check(element,'missing button');flushSync(()=>element.click());await wait()};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const set=async(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);flushSync(()=>element.dispatchEvent(new Event('input',{bubbles:true})));await wait()};
 const mount=key=>flushSync(()=>root.render(<PendingTestCenter key={key} athletes={[{name:'Aluno'}]} openCalendar={()=>{}}/>));
 (async()=>{try{
 mount('first');await until(()=>document.querySelector('.current-training-zones')?.textContent.includes('6:40 – 6:00/km')); 
 check(document.querySelector('.current-training-zones').textContent.includes('6:40 – 6:00/km'),'saved zones displayed instead of calculator');
 await click(button('Editar ritmos individuais'));await until(()=>document.querySelectorAll('.review-zone-grid input').length===10);
 check(!button('Salvar rascunho'),'approved ranges cannot be demoted accidentally');
 let fields=document.querySelectorAll('.review-zone-grid input');
 await set(fields[0],'8:10');await set(fields[1],'7:25');
 check(fields[0].value==='8:10'&&fields[1].value==='7:25','typed custom ranges retained');
 await click(button('Salvar e usar ritmos personalizados ✓'));await until(()=>!document.querySelector('.test-release-editor')&&document.querySelector('.current-training-zones')?.textContent.includes('8:10 – 7:25/km'));
 check(posts[0].zones[0].slow===490&&posts[0].zones[0].fast===445,'custom numbers sent');
 check(reads>=2,'canonical data read after save, including duplicate acknowledgement');
 check(document.querySelector('.current-training-zones').textContent.includes('8:10 – 7:25/km'),'custom ranges visible after approval');
 mount('reload');await until(()=>document.querySelector('.current-training-zones')?.textContent.includes('8:10 – 7:25/km')); 
 await click(button('Editar ritmos individuais'));await until(()=>document.querySelectorAll('.review-zone-grid input').length===10);
 fields=document.querySelectorAll('.review-zone-grid input');check(fields[0].value==='8:10'&&fields[1].value==='7:25','reopening preserves saved custom ranges');
 await set(fields[0],'8:99');await click(button('Salvar e usar ritmos personalizados ✓'));await until(()=>document.querySelector('[role=alert]'));
 check(posts.length===1,'invalid seconds rejected without applying another range');
 check(document.querySelector('[role=alert]').textContent.includes('min:seg'),'clear validation feedback');
 await click(document.querySelector('.test-release-editor header button'));
 tests=[{...tests[0],id:'new-draft',test_date:'2026-11-01',status:'Aguardando revisão'},...tests];
 window.dispatchEvent(new Event('zonasapp:test-saved'));await until(()=>button('Revisar e liberar zonas →'));
 await click(button('Revisar e liberar zonas →'));await until(()=>document.querySelectorAll('.review-zone-grid input').length===10);
 fields=document.querySelectorAll('.review-zone-grid input');await set(fields[0],'9:00');
 await click(button('Salvar rascunho'));await until(()=>document.body.textContent.includes('Rascunho salvo. Os ritmos em uso continuam sendo os aprovados.'));
 check(document.querySelector('.current-training-zones').textContent.includes('8:10 – 7:25/km'),'draft does not replace approved ranges');
 check(document.body.textContent.includes('Rascunho salvo. Os ritmos em uso continuam sendo os aprovados.'),'draft versus active status is explicit');
 document.getElementById('results').textContent=JSON.stringify({passed:true});
 }catch(error){document.getElementById('results').textContent=JSON.stringify({passed:false,error:String(error)})}})();
 `;
 try{
  const compiled=await build({stdin:{contents:script,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
  await writeFile(join(dir,'test.js'),compiled.outputFiles[0].text);
  await writeFile(join(dir,'index.html'),'<div id="app"></div><pre id="results"></pre><script src="test.js"></script>');
  const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run',`--user-data-dir=${join(dir,'profile')}`,'--virtual-time-budget=10000','--dump-dom',`file://${join(dir,'index.html')}`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const match=result.stdout?.match(/<pre id="results">(.*?)<\/pre>/);
  assert.ok(match?.[1],`browser did not finish: ${result.error||result.stderr?.slice(-500)}`);
  const outcome=JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
  assert.equal(outcome.passed,true,outcome.error);
 }finally{await rm(dir,{recursive:true,force:true})}
});
