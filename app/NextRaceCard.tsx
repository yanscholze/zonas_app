"use client";
import {useEffect,useState} from 'react';
import {api,describeError} from './api-client';
import {nextUpcomingRace,raceDateLabel,daysUntilRace,saoPauloDate,type AthleteRace} from '../shared/races';

export default function NextRaceCard({athleteName}:{athleteName:string}){
 const [data,setData]=useState<{races:AthleteRace[];today:string}|null>(null);
 const [error,setError]=useState('');const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;
  api.get<{races:AthleteRace[]}>(`/api/races-records?athlete=${encodeURIComponent(athleteName)}`).then(result=>{
   if(active){setData({races:result.races||[],today:saoPauloDate(new Date())});setError('')}
  }).catch(error=>{if(active)setError(describeError(error,'Não foi possível consultar a próxima prova.'))});
  return()=>{active=false};
 },[athleteName,retry]);
 const race=data?nextUpcomingRace(data.races,data.today):undefined;
 const days=race&&data?daysUntilRace(race.race_date,data.today):null;
 return <section className="next-race-card" aria-label="Próxima prova do aluno"><span className="overline">PRÓXIMA PROVA DE {athleteName.toUpperCase()}</span>
  {error?<p role="alert">{error} <button onClick={()=>{setError('');setData(null);setRetry(value=>value+1)}}>Tentar novamente</button></p>:!data?<p role="status">Consultando provas…</p>:race?<>
   <header><h3>{race.name}</h3><b>{days===0?'Hoje':days===1?'Amanhã':`Em ${days} dias`}</b></header>
   <dl><div><dt>Dia</dt><dd>{raceDateLabel(race.race_date)}</dd></div><div><dt>Distância</dt><dd>{race.distance}</dd></div>{race.city&&<div><dt>Local</dt><dd>{race.city}</dd></div>}</dl>
   <p>{race.priority||'Prioridade a definir'} · {race.status||'Aguardando análise'}</p>{race.goal&&<p>Objetivo: {race.goal}</p>}
  </>:<p>Nenhuma prova futura cadastrada para este aluno.</p>}
 </section>;
}
