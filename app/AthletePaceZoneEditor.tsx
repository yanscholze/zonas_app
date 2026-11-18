"use client";
import {useEffect,useState} from 'react';
import {api,describeError} from './api-client';
import type {PaceZone} from '../shared/training-zones';

const format=(v:number)=>{const seconds=Math.round(v);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
const parse=(v:string)=>{const match=v.match(/^(\d{1,2}):([0-5]\d)$/);return match?Number(match[1])*60+Number(match[2]):NaN};
export default function AthletePaceZoneEditor({athleteName}:{athleteName:string}){
 const [rows,setRows]=useState<Array<{z:string;label:string;slow:string;fast:string}>>([]),[state,setState]=useState('loading'),[error,setError]=useState('');
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(!open)return;let active=true;api.get<{zones:PaceZone[]}>(`/api/athlete-pace-zones?athlete=${encodeURIComponent(athleteName)}`).then(data=>{if(active){setRows(Array.from({length:5},(_,index)=>{const z=`Z${index+1}`,zone=data.zones.find(zone=>zone.z===z&&zone.source==='individual');return {z,label:zone?.label||z,slow:zone?format(zone.slow):'',fast:zone?format(zone.fast):''}}));setState('ready')}}).catch(e=>{if(active){setError(describeError(e,'Não foi possível carregar as zonas individuais.'));setState('error')}});return()=>{active=false}},[athleteName,open]);
 const save=async(event:React.FormEvent)=>{
  event.preventDefault();setState('saving');setError('');
  const zones=rows.map(row=>({...row,slow:parse(row.slow),fast:parse(row.fast)}));
  try{await api.post('/api/athlete-pace-zones',{athleteName,zones});setState('saved');window.dispatchEvent(new Event('zonasapp:test-saved'))}
  catch(e){setError(describeError(e,'Não foi possível salvar. Os valores foram mantidos.'));setState('error')}
 };
 return <details className="current-training-zones" onToggle={event=>{const value=event.currentTarget.open;if(value){setState('loading');setError('')}setOpen(value)}}><summary>Cadastro manual de zonas individuais · {athleteName}</summary><p>Estas faixas são exclusivas deste aluno e têm prioridade sobre o padrão. Não são recalculadas ao cadastrar um teste. Uma revisão aprovada pode atualizá-las.</p>{state==='loading'?<p>Carregando…</p>:<form onSubmit={save}><div className="review-zone-grid">{rows.map((row,index)=><article key={row.z}><b>{row.z}</b><label>Mais lento<input required placeholder="min:seg" value={row.slow} onChange={event=>{const value=event.target.value;setRows(current=>current.map((r,i)=>i===index?{...r,slow:value}:r))}}/></label><label>Mais rápido<input required placeholder="min:seg" value={row.fast} onChange={event=>{const value=event.target.value;setRows(current=>current.map((r,i)=>i===index?{...r,fast:value}:r))}}/></label></article>)}</div><button className="gold" disabled={rows.length!==5||state==='saving'}>{state==='saving'?'Salvando…':'Salvar zonas individuais'}</button></form>}{error&&<p role="alert">{error} Feche e abra este cadastro para consultar novamente.</p>}{state==='saved'&&<p role="status">Zonas individuais salvas. Os próximos envios usam estas faixas.</p>}</details>;
}
