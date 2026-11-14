import {raceDateLabel,type AthleteRace} from '../shared/races';

export default function StudentRaceList({races}:{races:AthleteRace[]}){
 const ordered=[...races].sort((a,b)=>a.race_date.localeCompare(b.race_date)||a.id.localeCompare(b.id));
 return <section className="student-race-list" aria-label="Minhas provas"><header><h2>Minhas provas</h2><span>{races.length} {races.length===1?'prova cadastrada':'provas cadastradas'}</span></header>
  {!ordered.length?<p>Você pode cadastrar várias provas. Elas ficam salvas aqui para acompanhar a análise do treinador.</p>:ordered.map(race=><article key={race.id}><header><h3>{race.name}</h3><span>{race.status||'Aguardando análise'}</span></header><p>{raceDateLabel(race.race_date)} · {race.distance}{race.city?` · ${race.city}`:''}</p>{race.goal&&<p>Objetivo: {race.goal}</p>}<small>{race.priority||'Prioridade a definir'}</small></article>)}
 </section>;
}
