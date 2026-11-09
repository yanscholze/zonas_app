import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const chrome='/usr/bin/google-chrome';
const available=await access(chrome).then(()=>true,()=>false);

test('real mobile editor moves, duplicates, removes, edits, saves and reopens stages in the selected order', {skip:!available}, async()=>{
 const source=await readFile('app/ZonasAppClient.tsx','utf8');
 const parser=source.slice(source.indexOf('type ParsedWorkoutBlock ='),source.indexOf('/* As dez planilhas'));
 const drawer=source.slice(source.indexOf('function WorkoutDrawer('),source.indexOf('\nfunction completeSessionForStudent'));
 const dir=await mkdtemp(join(tmpdir(),'zonas-editor-'));
 const script=`
 import {useEffect,useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {FREE_ZONE,readEditorSteps,saveEditorSteps,moveEditorStep} from './shared/workout-editor';
 const avise=()=>{};const parsedList=value=>Array.isArray(value)?value:[];const paceInput=value=>String(value);
 window.fetch=async()=>({ok:true,json:async()=>({tests:[],trainingZones:[]})});
 ${parser}
 ${drawer}
 const initial={type:'Treino estruturado',description:'',title:'Misto',steps:[
 {kind:'simple',label:'Aquecimento',meters:1234,distanceUnit:'km',zone:null},
 {kind:'repeat',label:'Série A',repetitions:2,effortMeters:400,effortZone:'Z4',recoverySeconds:30,recoveryZone:'Z1'},
 {kind:'simple',label:'Desaquecimento',minutes:5,zone:null},
 {kind:'repeat',label:'Série B',repetitions:3,effortSeconds:60,effortZone:'Z3',recoveryMinutes:2,recoveryZone:'Z1'},
 {kind:'simple',label:'Aquecimento',minutes:3,zone:'Z1'}]};
 const root=createRoot(document.getElementById('app'));let saved;
 const mount=(value,key)=>root.render(<WorkoutDrawer key={key} initial={value} athleteName="Aluno de teste" day="SEG" weekLabel="09/11" close={()=>{}} onSave={value=>saved=value}/>);
 const wait=()=>new Promise(resolve=>setTimeout(resolve,30));
 const check=(value,message)=>{if(!value)throw new Error(message)};
 const blocks=()=>[...document.querySelectorAll('.workout-builder>.fixed-block,.workout-builder>.series-builder')];
 const click=async(element)=>{check(element,'missing button');element.click();await wait()};
 const set=async(element,value)=>{check(element,'missing field');Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?HTMLSelectElement.prototype:element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));await wait()};
 const labels=()=>blocks().map(block=>block.querySelector('small input').value);
 const button=(container,text)=>[...container.querySelectorAll('button')].find(button=>button.textContent===text);
 (async()=>{try{
 mount(initial,'first');await wait();
 check(blocks().length===5,'all mixed stages loaded');
 check(labels().join('|')==='Aquecimento|Série A|Desaquecimento|Série B|Aquecimento','initial order');
 const control=blocks()[2].querySelector('.stage-order-controls select');
 check(control.getBoundingClientRect().height>=44,'mobile position control is visible and touch sized');
 await set(control,'0');
 check(labels()[0]==='Desaquecimento','move to arbitrary position');
 await click(button(blocks()[0],'Duplicar'));
 await click(button(blocks().at(-1),'Remover'));
 check(labels().join('|')==='Desaquecimento|Desaquecimento|Aquecimento|Série A|Série B','duplicate and remove');
 await click(document.querySelector('.mobile-editor-toggle'));
 check(document.querySelector('.workout-drawer').scrollWidth<=document.querySelector('.workout-drawer').clientWidth+1,'no detailed mobile horizontal overflow');
 await set(blocks()[2].querySelector('input[type=number]'),'1.75');
 await set(blocks()[2].querySelector('label select'),'km');
 await set(blocks()[2].querySelector('input[type=number]'),'1.75');
 check(!document.querySelector('footer .gold').disabled,'can save');
 await click(document.querySelector('footer .gold'));
 check(saved.steps[2].meters===1750,'edited distance persisted');
 check(saved.steps[2].zone===null,'Livre stays target-free');
 check(saved.steps[3].label==='Série A'&&saved.steps[3].effortMeters===400,'repeat preserved');
 mount(saved,'reopened');await wait();
 check(labels().join('|')==='Desaquecimento|Desaquecimento|Aquecimento|Série A|Série B','saved order restored');
 const preview=[...document.querySelectorAll('.student-builder-preview article small')].map(element=>element.textContent);
 check(preview[0]==='Desaquecimento'&&preview[3].startsWith('Série A'),'preview follows execution order');
 await click(document.querySelector('.stage-order-controls button[aria-label*="baixo"]'));
 await set(document.querySelector('.written-workout-converter textarea'),'2 x 1 min Z4 / 1 min Z1 + desaquecimento 3 min Livre + aquecimento 2 min Z2 + 3 x 20 s Z5 / 40 s Z1');
 await click(button(document,'Transformar em etapas ↓'));
 check(labels().join('|')==='Série principal|Desaquecimento|Aquecimento|Série principal','written mixed sequence preserved');
 check(document.querySelector('.workout-drawer').scrollWidth<=document.querySelector('.workout-drawer').clientWidth+1,'no mobile horizontal overflow: '+document.querySelector('.workout-drawer').scrollWidth+'/'+document.querySelector('.workout-drawer').clientWidth+' '+[...document.querySelectorAll('.workout-drawer *')].filter(el=>el.getBoundingClientRect().right>document.querySelector('.workout-drawer').getBoundingClientRect().right).slice(0,5).map(el=>el.tagName+'.'+el.className).join(','));
 while(blocks().length)await click(button(blocks()[0],'Remover'));
 check(document.querySelector('footer .gold').disabled,'empty workout is blocked');
 await click(document.querySelector('.mobile-editor-toggle'));
 await click(button(document,'＋ Adicionar desaquecimento'));
 check(!document.querySelector('footer .gold').disabled,'single optional stage can be saved');
 await click(document.querySelector('footer .gold'));
 check(saved.steps.length===1&&saved.steps[0].label==='Desaquecimento','no compulsory main or warmup');
 document.getElementById('results').textContent=JSON.stringify({passed:true,stages:labels()});
 }catch(error){document.getElementById('results').textContent=JSON.stringify({passed:false,error:String(error)})}})();
 `;
 try{
  const compiled=await build({stdin:{contents:script,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
  await writeFile(join(dir,'editor.js'),compiled.outputFiles[0].text);
  await writeFile(join(dir,'editor.css'),await readFile('app/globals.css'));
  await writeFile(join(dir,'overrides.css'),await readFile('app/overrides.css'));
  await writeFile(join(dir,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="editor.css"><div id="app"></div><pre id="results"></pre><script src="editor.js"></script>');
  const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run',`--user-data-dir=${join(dir,'profile')}`,'--window-size=390,844','--virtual-time-budget=10000','--dump-dom',`file://${join(dir,'index.html')}`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const match=result.stdout?.match(/<pre id="results">(.*?)<\/pre>/);
  assert.ok(match?.[1],`browser did not finish: ${result.error||result.stderr?.slice(-400)}`);
  const outcome=JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
  assert.equal(outcome.passed,true,outcome.error);
 }finally{await rm(dir,{recursive:true,force:true})}
});
