"use client";

import { useEffect, useState } from "react";
import { StudentView } from "./ZonasAppClient";
import InstallApp from "./InstallApp";
import { signOut, type Session } from "./AuthGate";

type Registration = { id:string;name:string;phone?:string;objective?:string;distance:string;training_days:string;integration:string;status:"Pendente"|"Aprovado"|"Recusado" };
const days=["SEG","TER","QUA","QUI","SEX","SÁB","DOM"];

export default function StudentEntry({ session: account }: { session: Session }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [request,setRequest]=useState<Registration|null|undefined>(undefined);
  const [form,setForm]=useState({name:account.name,phone:"",objective:"",distance:"5 km",trainingDays:["TER","QUI","SÁB"],integration:"Garmin"});
  const [state,setState]=useState<"idle"|"saving"|"error">("idle");
  const load=()=>Promise.all([
    fetch("/api/session",{cache:"no-store"}).then(async response=>response.ok?response.json():null),
    fetch("/api/access-request",{cache:"no-store"}).then(async response=>response.ok?response.json():{request:null}),
  ]).then(([sessionData,requestData])=>{setSession(sessionData?.role==="student"?sessionData:null);setRequest(requestData.request||null)}).catch(()=>{setSession(null);setRequest(null)});
  useEffect(()=>{load()},[]);
  const toggleDay=(day:string)=>setForm(value=>({...value,trainingDays:value.trainingDays.includes(day)?value.trainingDays.filter(item=>item!==day):[...value.trainingDays,day]}));
  const submit=async()=>{setState("saving");try{const response=await fetch("/api/access-request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});if(!response.ok)throw new Error();await load();setState("idle")}catch{setState("error")}};
  if (session === undefined || request === undefined) return <main className="secure-access-denied"><section><span>Z</span><small>ACESSO PROTEGIDO</small><h1>Verificando seu acesso…</h1></section></main>;
  if (session && session.role === "student") return <StudentView athleteName={session.athleteName} />;
  if(request?.status==="Pendente") return <main className="student-registration"><section className="registration-status"><span>Z</span><small>CADASTRO ENVIADO</small><h1>Aguardando liberação do professor</h1><p>Seu cadastro chegou ao treinador. Você receberá acesso somente depois que ele conferir e aprovar.</p><div><b>{request.name}</b><small>{request.distance} · {request.integration}</small></div><InstallApp inline/><button onClick={load}>Verificar novamente</button><button className="registration-signout" onClick={()=>void signOut()}>Sair desta conta</button></section></main>;
  return <main className="student-registration"><section className="registration-card"><header><span>Z</span><div><small>PRIMEIRO ACESSO</small><h1>Solicite seu cadastro</h1><p>Preencha somente o essencial. O professor revisará tudo antes de liberar sua área.</p></div></header>{request?.status==="Recusado"&&<div className="registration-rejected"><b>Cadastro ainda não liberado</b><span>Você pode corrigir os dados e enviar uma nova solicitação.</span></div>}<div className="registration-grid"><label>Nome completo<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Seu nome completo"/></label><label>Telefone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="(47) 99999-0000"/></label><label>Objetivo principal<input value={form.objective} onChange={e=>setForm({...form,objective:e.target.value})} placeholder="Ex.: correr meus primeiros 5 km"/></label><label>Distância atual<select value={form.distance} onChange={e=>setForm({...form,distance:e.target.value})}>{["Iniciantes","5 km","10 km","Meia","Maratona"].map(item=><option key={item}>{item}</option>)}</select></label><label>Relógio ou aplicativo<select value={form.integration} onChange={e=>setForm({...form,integration:e.target.value})}><option>Strava</option><option>Garmin</option><option>Amazfit</option><option>Apple Saúde / Apple Watch</option><option>Sem integração</option></select></label></div><label className="registration-days">Dias disponíveis para treinar<div>{days.map(day=><button type="button" key={day} className={form.trainingDays.includes(day)?"selected":""} onClick={()=>toggleDay(day)}>{day}</button>)}</div></label>{state==="error"&&<p className="registration-error">Não foi possível enviar. Confira os campos e tente novamente.</p>}<button className="registration-submit" disabled={state==="saving"||form.name.trim().length<3||!form.trainingDays.length} onClick={submit}>{state==="saving"?"Enviando cadastro…":"Enviar para aprovação do professor →"}</button><p className="registration-security">Seus treinos e dados só serão liberados após a aprovação do treinador. Ao enviar, você declara ter lido a <a href="/privacy">Política de Privacidade</a> e os <a href="/terms">Termos de Uso</a>. Menores de 18 anos precisam do consentimento de um responsável.</p><button className="registration-signout" onClick={()=>void signOut()}>Entrar com outra conta</button></section></main>;
}
