import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const chrome='/usr/bin/google-chrome',available=await access(chrome).then(()=>true,()=>false);
test('manual individual editor loads saved ranges, saves exact seconds, reloads and never pre-fills another student with defaults',{skip:!available},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zonas-manual-'));
 try{
  const script=`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import Editor from './app/AthletePaceZoneEditor';
   let saved=Array.from({length:5},(_,i)=>({z:'Z'+(i+1),label:'Individual',slow:480-i*30,fast:420-i*30,source:'individual'})),posted;
   window.fetch=async(path,options={})=>{if(options.method==='POST'){posted=JSON.parse(options.body);saved=posted.zones.map(z=>({...z,source:'individual'}));return Response.json({saved:true})}return Response.json({zones:path.includes('Sem%20zonas')?saved.map(z=>({...z,source:'default'})):saved})};
   const root=createRoot(document.getElementById('app')),wait=()=>new Promise(r=>setTimeout(r,30));
   const until=async(f)=>{for(let i=0;i<100;i++){if(f())return;await wait()}throw Error('UI not ready')};
   const check=(v,msg)=>{if(!v)throw Error(msg)};
   const open=async()=>{flushSync(()=>document.querySelector('summary').click());await until(()=>document.querySelectorAll('input').length===10)};
   const mount=(name,key)=>flushSync(()=>root.render(<Editor key={key} athleteName={name}/>));
   (async()=>{try{mount('Aluno','first');await open();check(document.querySelector('input').value==='8:00','saved values loaded');
   const field=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'8:10');flushSync(()=>field.dispatchEvent(new Event('input',{bubbles:true})));
   flushSync(()=>document.querySelector('button').click());await until(()=>document.querySelector('[role=status]'));check(posted.zones[0].slow===490,'seconds saved exactly');
   mount('Aluno','reload');await open();check(document.querySelector('input').value==='8:10','saved manual ranges restored after reopening');
   mount('Sem zonas','empty');await open();check([...document.querySelectorAll('input')].every(input=>input.value===''),'defaults cannot silently become individual ranges');
   document.getElementById('result').textContent=JSON.stringify({passed:true})}catch(error){document.getElementById('result').textContent=JSON.stringify({passed:false,error:String(error)})}})();`;
  const bundle=await build({stdin:{contents:script,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
  await writeFile(join(directory,'test.js'),bundle.outputFiles[0].text);
  await writeFile(join(directory,'index.html'),'<div id="app"></div><pre id="result"></pre><script src="test.js"></script>');
  const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run',`--user-data-dir=${join(directory,'profile')}`,'--virtual-time-budget=10000','--dump-dom',`file://${join(directory,'index.html')}`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const value=result.stdout?.match(/<pre id="result">(.*?)<\/pre>/)?.[1];assert.ok(value,'browser did not finish');const outcome=JSON.parse(value.replace(/&quot;/g,'"').replace(/&amp;/g,'&'));assert.equal(outcome.passed,true,outcome.error);
 }finally{await rm(directory,{recursive:true,force:true})}
});
