import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

const chrome='/usr/bin/google-chrome';
const available=await access(chrome).then(()=>true,()=>false);
test('browser registers multiple student races, shows the next race and exchanges workout replies without losing drafts',{skip:!available},async()=>{
 const source=await readFile('app/ZonasAppClient.tsx','utf8');
 const save=source.slice(source.indexOf('  const saveRaceRecord=async('),source.indexOf('\n  const saveIntegration=',source.indexOf('  const saveRaceRecord=async(')));
 const racePage=source.slice(source.indexOf('    {tab==="Mais"&&moreView==="races"'),source.indexOf('\n    {tab==="Hoje"&&showTraining'));
 const dir=await mkdtemp(join(tmpdir(),'zonas-races-chat-'));
 const script=`
 import {useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import {api,describeError} from './app/api-client';import NextRaceCard from './app/NextRaceCard';import StudentRaceList from './app/StudentRaceList';import WorkoutChat from './app/WorkoutChat';
 import {nextUpcomingRace} from './shared/races';
 let raceDataOnServer=[],messages=[{id:'legacy',author_role:'coach',body:'Controle o ritmo no início.',created_at:1000}],calls=[],failRace=false,failMessage=false,duplicateAck=false,failCard=false,holdMessages=false,resolveOldMessages;
 const avise=()=>{};
 window.fetch=async(path,options={})=>{
  calls.push({path,options});
  if(path.includes('workout-messages')){
   if(options.method==='POST'){
    if(failMessage)return Response.json({error:'database_unavailable'},{status:503});
    const body=JSON.parse(options.body);messages.push({id:'m'+messages.length,author_role:path.includes('/student/')?'student':'coach',body:body.message,created_at:2000+messages.length});
    if(duplicateAck)return Response.json({error:'duplicate_submission'},{status:409});
   }else if(holdMessages){holdMessages=false;return new Promise(resolve=>resolveOldMessages=()=>resolve(Response.json({messages:[]})))}
   return Response.json({messages:[...messages]});
  }
  if(path.includes('races-records')){
   if(options.method==='POST'){
    const body=JSON.parse(options.body);
    if('athleteName' in body||failRace)return Response.json({error:'unexpected_field'},{status:400});
    raceDataOnServer.push({id:'race'+raceDataOnServer.length,name:body.name,race_date:body.raceDate,distance:body.distance,city:body.city,status:'Aguardando análise'});
    return Response.json({id:raceDataOnServer.at(-1).id},{status:201});
   }
   if(failCard){failCard=false;return Response.json({error:'database_unavailable'},{status:503})}
   return Response.json({races:[...raceDataOnServer],records:[]});
  }
  throw new Error('Unexpected route '+path);
 };
 function StudentRacePage(){
  const secureStudentMode=true,athleteName='Aluno Teste',tab='Mais';const [moreView,setMoreView]=useState('races');
  const [raceData,setRaceData]=useState({races:[],records:[]});
  const [raceForm,setRaceForm]=useState({name:'',raceDate:'',distance:'10 km',city:'',goal:''});
  const [recordForm,setRecordForm]=useState({distance:'10 km',resultTime:'',raceDate:'',eventName:''});
  const [raceState,setRaceState]=useState('');const nextRace=nextUpcomingRace(raceData.races,'2026-11-14');
  ${save}
  return <>${racePage}</>;
 }
 const root=createRoot(document.getElementById('app')),wait=()=>new Promise(resolve=>setTimeout(resolve,40));
 const check=(value,message)=>{if(!value)throw new Error(message)};
 const until=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await wait()}throw new Error('UI did not become ready')};
 const mount=element=>flushSync(()=>root.render(element));
 const click=async(element)=>{check(element,'missing action');flushSync(()=>element.click());await wait()};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const set=async(element,value)=>{check(element,'missing input');Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);flushSync(()=>element.dispatchEvent(new Event('input',{bubbles:true})));await wait()};
 let stage='races';
 (async()=>{try{
  mount(<StudentRacePage/>);
  let fields=document.querySelectorAll('.race-record-form:not(.compact) input');
  await set(fields[0],'Prova de janeiro');await set(fields[1],'2099-01-10');
  await click(button('Enviar prova ao treinador'));await until(()=>document.querySelectorAll('.student-race-list article').length===1);
  check(fields[0].value===''&&fields[1].value==='','form resets for another race');
  fields=document.querySelectorAll('.race-record-form:not(.compact) input');
  await set(fields[0],'Meia de fevereiro');await set(fields[1],'2099-02-14');
  await click(button('Enviar prova ao treinador'));await until(()=>document.querySelectorAll('.student-race-list article').length===2);
  check(document.querySelector('.student-race-list').textContent.includes('Prova de janeiro')&&document.querySelector('.student-race-list').textContent.includes('Meia de fevereiro'),'both races visible');
  check(document.querySelector('.race-record-head').textContent.includes('Prova de janeiro'),'next race remains nearest date');
  failRace=true;await set(fields[0],'Rascunho preservado');await set(fields[1],'2099-03-10');await click(button('Enviar prova ao treinador'));
  check(fields[0].value==='Rascunho preservado','failed race submit retains fields');failRace=false;
  stage='next race card';
  raceDataOnServer.push({id:'past',name:'Prova antiga',race_date:'2000-01-01',distance:'5 km'}, {id:'discarded',name:'Descartada',race_date:'2098-12-01',distance:'5 km',status:'Descartada'});
  failCard=true;mount(<NextRaceCard key="race-card" athleteName="Aluno Teste"/>);
  await until(()=>button('Tentar novamente'));await click(button('Tentar novamente'));
  await until(()=>document.querySelector('.next-race-card h3'));
  const card=document.querySelector('.next-race-card');check(card.textContent.includes('Prova de janeiro')&&card.textContent.includes('10/01/2099')&&card.textContent.includes('10 km'),'card shows next eligible race date, name, distance');
  check(!card.textContent.includes('Prova antiga')&&!card.textContent.includes('Descartada'),'past and discarded excluded');
  check(calls.some(call=>call.path.includes('athlete=Aluno%20Teste')),'card scoped to selected athlete');
  check(card.scrollWidth<=card.clientWidth+1,'race card fits mobile viewport');
  stage='workout chat';holdMessages=true;
  mount(<WorkoutChat key="student" executionId="execution-1" student initiallyOpen/>);
  await until(()=>resolveOldMessages&&document.querySelector('.workout-chat textarea'));
  await set(document.querySelector('textarea'),'Consegui controlar o início.');await click(button('Enviar mensagem'));
  await until(()=>document.querySelector('.workout-chat-messages .mine'));
  resolveOldMessages();await wait();
  check(document.querySelector('.workout-chat-messages').textContent.includes('Consegui controlar o início.'),'late GET cannot erase sent reply');
  check(document.querySelector('.workout-chat-messages').textContent.includes('Controle o ritmo no início.'),'original coach feedback retained');
  failMessage=true;await set(document.querySelector('textarea'),'Minha mensagem para tentar de novo');await click(button('Enviar mensagem'));
  await until(()=>document.querySelector('[role=alert]'));
  check(document.querySelector('textarea').value==='Minha mensagem para tentar de novo','failed send keeps draft');
  failMessage=false;duplicateAck=true;await click(button('Enviar mensagem'));await until(()=>document.querySelector('textarea').value==='');
  check(document.querySelector('.workout-chat-messages').textContent.includes('Minha mensagem para tentar de novo'),'duplicate acknowledgement reloads canonical history');duplicateAck=false;
  mount(<WorkoutChat key="coach" executionId="execution-1" initiallyOpen/>);await until(()=>document.querySelectorAll('.workout-chat-messages article').length===3);
  check(document.querySelector('.workout-chat-messages').textContent.includes('Consegui controlar o início.'),'coach sees student replies');
  const before=calls.length;mount(<WorkoutChat key="preview" executionId="execution-1" student enabled={false} initiallyOpen/>);await wait();
  check(!document.querySelector('.workout-chat form')&&document.body.textContent.includes('Entre na conta do aluno'),'preview does not send as student');check(calls.length===before,'preview makes no chat request');
  document.getElementById('results').textContent=JSON.stringify({passed:true});
 }catch(error){document.getElementById('results').textContent=JSON.stringify({passed:false,stage,error:String(error)})}})();
 `;
 try{
  const compiled=await build({stdin:{contents:script,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
  await writeFile(join(dir,'test.js'),compiled.outputFiles[0].text);
  await writeFile(join(dir,'globals.css'),await readFile('app/globals.css'));await writeFile(join(dir,'overrides.css'),await readFile('app/overrides.css'));
  await writeFile(join(dir,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="globals.css"><div id="app"></div><pre id="results"></pre><script src="test.js"></script>');
  const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run',`--user-data-dir=${join(dir,'profile')}`,'--window-size=390,844','--virtual-time-budget=20000','--dump-dom',`file://${join(dir,'index.html')}`],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  const match=result.stdout?.match(/<pre id="results">(.*?)<\/pre>/);assert.ok(match?.[1],`browser did not finish: ${result.error||result.stderr?.slice(-400)}`);
  const outcome=JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));assert.equal(outcome.passed,true,`${outcome.stage}: ${outcome.error}`);
 }finally{await rm(dir,{recursive:true,force:true})}
});
