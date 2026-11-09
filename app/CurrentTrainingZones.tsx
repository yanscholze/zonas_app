import type { PaceZone } from '../shared/training-zones';

const pace=(value:number)=>{const seconds=Math.round(value);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};

export default function CurrentTrainingZones({zones,onReview}:{zones:PaceZone[];onReview?:()=>void}){
 return <section className="current-training-zones" aria-label="Zonas em uso nos treinos">
  <header><div><span className="overline">RITMOS SALVOS</span><h2>Zonas em uso nos treinos</h2></div>{onReview&&<button className="outline" onClick={onReview}>Editar ritmos individuais</button>}</header>
  {zones.length?<><div className="current-zone-grid">{zones.map(zone=><article key={zone.z}><b>{zone.z} · {zone.label}</b><strong>{pace(zone.slow)} – {pace(zone.fast)}/km</strong><small>{zone.source==='individual'?'Individual aprovada':'Padrão do professor'}</small></article>)}</div><p>Estes são os ritmos usados nos treinos. Uma nova simulação ou um rascunho não substitui as zonas aprovadas.</p></>:<p>Ainda não há zonas individuais aprovadas nem padrão do professor disponível para este aluno. Revise e aprove uma avaliação para liberar os ritmos.</p>}
 </section>;
}
