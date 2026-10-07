import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildActivityResult } from '../shared/activity-results.ts';

const compiled=await build({entryPoints:['app/WorkoutResultDetails.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react/jsx-runtime']});
// Módulo em disco dentro do projeto para resolver a mesma instalação React.
const {writeFile,unlink}=await import('node:fs/promises');
const file=new URL('../.sites-runtime/tmp/workout-result-ui.mjs',import.meta.url);
await writeFile(file,compiled.outputFiles[0].text);
const {WorkoutResultDetails}=await import(file.href);await unlink(file);

test('renders actual metrics, planned steps and visibly missing measurements in Portuguese',()=>{
 const result=buildActivityResult({provider:'Garmin',activityId:'123',startedAt:Date.parse('2026-10-07T12:00:00Z'),workoutMatch:'date',plannedSteps:[{kind:'simple',label:'Aquecimento',minutes:5}],
  raw:{duration:300,distance:1000,averageHR:140,splits:{lapDTOs:[{duration:300,distance:1000,averageHR:140}]}}});
 const html=renderToStaticMarkup(createElement(WorkoutResultDetails,{result,expanded:true}));
 assert.match(html,/Resultado de Garmin/);assert.match(html,/140 bpm/);assert.match(html,/5:00 \/km/);
 assert.match(html,/Aquecimento/);assert.match(html,/não enviou uma volta identificável/);assert.match(html,/Voltas registradas no relógio/);
 assert.match(html,/Relacionado ao treino desta data/);assert.doesNotMatch(html,/FC máxima/);
});
