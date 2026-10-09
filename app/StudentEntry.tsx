"use client";

import { useEffect, useState } from "react";
import { StudentView } from "./ZonasAppClient";
import InstallApp from "./InstallApp";
import { signOut, type Session } from "./AuthGate";

type Registration = { id:string;name:string;phone?:string;objective?:string;distance:string;training_days:string;integration:string;status:"Pendente"|"Aprovado"|"Recusado" };
type RegistrationError = { field?:string; message:string };
const days=["SEG","TER","QUA","QUI","SEX","SÁB","DOM"];

/* O código do treinador vem no link que ele enviou. Sem ele o pedido chega sem
   dono e vai para a lista de todos os treinadores — que é o que acontecia antes
   de o link carregar o convite, e o que continua valendo para quem tiver um link
   antigo salvo. */
const conviteDoLink = () => {
  try { return new URLSearchParams(window.location.search).get("convite") || undefined; }
  catch { return undefined; }
};

export default function StudentEntry({ session: account }: { session: Session }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [request,setRequest]=useState<Registration|null|undefined>(undefined);
  const [form,setForm]=useState({name:account.name,phone:"",objective:"",distance:"5 km",trainingDays:["TER","QUI","SÁB"],integration:"Garmin"});
  const [state,setState]=useState<"idle"|"saving"|"error"|"pendente">("idle");
  const [registrationError,setRegistrationError]=useState<RegistrationError|null>(null);
  const [inviteWarning,setInviteWarning]=useState(false);
  const load=()=>Promise.all([
    fetch("/api/session",{cache:"no-store"}).then(async response=>response.ok?response.json():null),
    fetch("/api/access-request",{cache:"no-store"}).then(async response=>response.ok?response.json():{request:null}),
  ]).then(([sessionData,requestData])=>{setSession(sessionData?.role==="student"?sessionData:null);setRequest(requestData.request||null)}).catch(()=>{setSession(null);setRequest(null)});
  useEffect(()=>{load()},[]);
  const toggleDay=(day:string)=>{setForm(value=>({...value,trainingDays:value.trainingDays.includes(day)?value.trainingDays.filter(item=>item!==day):[...value.trainingDays,day]}));setRegistrationError(null)};
  const submit=async()=>{setState("saving");try{
    const response=await fetch("/api/access-request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,invite:conviteDoLink()})});
    if(!response.ok){
      /* "Confira os campos" para um pedido já aprovado manda o aluno procurar
         erro em dados que estão certos. O 409 de já-aprovado quer dizer que a
         área dele existe e é só recarregar. */
      const corpo=await response.json().catch(()=>({}));
      if(corpo.error==="already_approved"){window.location.reload();return}
      const messages:Record<string,string>={
        invalid_name:"Informe seu nome completo com pelo menos 3 caracteres.",
        invalid_distance:"Escolha uma das opções de distância disponíveis.",
        invalid_training_days:"Escolha pelo menos um dia da semana para treinar.",
        invalid_integration:"Escolha um relógio ou aplicativo da lista, ou selecione “Sem integração”.",
        invalid_json:"Não conseguimos ler os dados enviados. Atualize a página e tente novamente.",
        invalid_payload:"Os dados do formulário estão incompletos. Confira os campos e tente novamente.",
        unexpected_field:"O formulário está desatualizado. Atualize a página e tente enviar novamente.",
        json_content_type_required:"O envio não foi reconhecido. Atualize a página e tente novamente.",
        payload_too_large:"O formulário ficou grande demais. Remova caracteres extras das observações e tente novamente.",
        too_many_requests:"Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
        duplicate_submission:"Este cadastro já foi recebido. Aguarde a confirmação antes de enviar novamente.",
        database_unavailable:"Não foi possível salvar seu cadastro agora. Seus dados continuam nesta tela; aguarde um pouco e tente novamente.",
        student_request_only:"Esta conta não pode solicitar cadastro de aluno. Saia e entre com a conta do aluno.",
      };
      const message=messages[corpo.error]||(response.status===401?"Sua sessão expirou. Entre novamente para enviar o cadastro.":response.status===403?"Esta conta não tem permissão para solicitar cadastro de aluno.":response.status===409?"Já existe um cadastro para esta conta. Atualize a página para ver a situação.":response.status===429?messages.too_many_requests:response.status>=500?messages.database_unavailable:"Confira os campos e tente novamente. Se o problema continuar, avise seu professor.");
      setRegistrationError({field:typeof corpo.field==="string"?corpo.field:undefined,message});
      setState("error");return;
    }
    const resultado=await response.json().catch(()=>({}));
    setInviteWarning(resultado.inviteValid===false);
    setRegistrationError(null);
    setRequest({id:String(resultado.id||""),name:form.name,phone:form.phone,objective:form.objective,distance:form.distance,training_days:JSON.stringify(form.trainingDays),integration:form.integration,status:"Pendente"});
    setState("idle")}catch{setRegistrationError({message:"Não foi possível conectar ao ZonasApp. Confira sua internet e tente novamente; seus dados continuam nesta tela."});setState("error")}};
  if (session === undefined || request === undefined) return <main className="secure-access-denied"><section><span>Z</span><small>ACESSO PROTEGIDO</small><h1>Verificando seu acesso…</h1></section></main>;
  if (session && session.role === "student") return <StudentView athleteName={session.athleteName} />;
  if(request?.status==="Pendente") return <main className="student-registration"><section className="registration-status"><span>Z</span><small>CADASTRO ENVIADO</small><h1>Aguardando liberação do professor</h1><p>Seu cadastro chegou ao treinador. Você receberá acesso somente depois que ele conferir e aprovar.</p>{inviteWarning&&<p className="registration-invite-warning" role="status">O link usado estava vencido. Seu cadastro foi recebido, mas pode não ter sido associado diretamente ao seu professor. Envie uma mensagem a ele para confirmar.</p>}<div><b>{request.name}</b><small>{request.distance} · {request.integration}</small></div><InstallApp inline/><button onClick={load}>Verificar novamente</button><button className="registration-signout" onClick={()=>void signOut()}>Sair desta conta</button></section></main>;
  return <main className="student-registration"><section className="registration-card"><header><span>Z</span><div><small>PRIMEIRO ACESSO</small><h1>Solicite seu cadastro</h1><p>Preencha somente o essencial. O professor revisará tudo antes de liberar sua área.</p></div></header>{request?.status==="Recusado"&&<div className="registration-rejected"><b>Cadastro ainda não liberado</b><span>Você pode corrigir os dados e enviar uma nova solicitação.</span></div>}<div className="registration-grid"><label>Nome completo<input aria-invalid={registrationError?.field==="name"} value={form.name} onChange={e=>{setForm({...form,name:e.target.value});setRegistrationError(null)}} placeholder="Seu nome completo"/></label><label>Telefone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="(47) 99999-0000"/></label><label>Objetivo principal<input value={form.objective} onChange={e=>setForm({...form,objective:e.target.value})} placeholder="Ex.: correr meus primeiros 5 km"/></label><label>Distância atual<select aria-invalid={registrationError?.field==="distance"} value={form.distance} onChange={e=>{setForm({...form,distance:e.target.value});setRegistrationError(null)}}>{["Iniciantes","5 km","10 km","Meia","Maratona"].map(item=><option key={item}>{item}</option>)}</select></label><label>Relógio ou aplicativo<select aria-invalid={registrationError?.field==="integration"} value={form.integration} onChange={e=>{setForm({...form,integration:e.target.value});setRegistrationError(null)}}><option>Strava</option><option>Garmin</option><option>Amazfit / Zepp</option><option>Apple Saúde / Apple Watch</option><option>Sem integração</option></select></label></div><label className="registration-days">Dias disponíveis para treinar<div>{days.map(day=><button type="button" key={day} className={form.trainingDays.includes(day)?"selected":""} onClick={()=>toggleDay(day)}>{day}</button>)}</div></label>{registrationError&&<p className="registration-error" role="alert" aria-live="polite">{registrationError.message}</p>}{state==="pendente"&&<p className="registration-error" role="status">Seu cadastro já foi enviado e está aguardando a liberação do professor.</p>}<button className="registration-submit" disabled={state==="saving"} onClick={submit}>{state==="saving"?"Enviando cadastro…":"Enviar para aprovação do professor →"}</button><p className="registration-security">Seus treinos e dados só serão liberados após a aprovação do treinador. Ao enviar, você declara ter lido a <a href="/privacy">Política de Privacidade</a> e os <a href="/terms">Termos de Uso</a>. Menores de 18 anos precisam do consentimento de um responsável.</p><button className="registration-signout" onClick={()=>void signOut()}>Entrar com outra conta</button></section></main>;
}
