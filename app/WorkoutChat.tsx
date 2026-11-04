"use client";
import { useEffect, useState } from "react";
type Message={id:string;author_role:string;body:string;created_at:number};
export default function WorkoutChat({executionId,student=false,enabled=true}:{executionId:string;student?:boolean;enabled?:boolean}){
  const [open,setOpen]=useState(false),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState("");
  const [state,setState]=useState(""),[error,setError]=useState("");
  const endpoint=student?"/api/student/workout-messages":"/api/workout-messages";
  useEffect(()=>{
    if(!open||!enabled)return;
    let active=true;
    const load=async()=>{try{const response=await fetch(`${endpoint}?executionId=${encodeURIComponent(executionId)}`,{cache:"no-store"});if(!response.ok)throw new Error();const data=await response.json();if(active){setMessages(data.messages);setError("")}}catch{if(active)setError("Não foi possível carregar a conversa.")}};
    void load();const timer=setInterval(()=>{if(!document.hidden)void load()},15000);
    return()=>{active=false;clearInterval(timer)};
  },[open,enabled,endpoint,executionId]);
  const send=async(event:React.FormEvent)=>{event.preventDefault();if(!text.trim()||state==="sending")return;setState("sending");setError("");try{const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({executionId,message:text.trim()})});if(!response.ok)throw new Error();const data=await response.json();setMessages(data.messages);setText("")}catch{setError("Não foi possível enviar. Sua mensagem foi mantida para tentar novamente.")}finally{setState("")}};
  return <details className="workout-chat" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Conversa sobre este treino</summary>{!enabled?<p>Entre na conta do aluno para conversar com o treinador.</p>:<><div className="workout-chat-messages" aria-live="polite">{messages.length?messages.map(message=><article key={message.id} className={message.author_role===(student?"student":"coach")?"mine":""}><small>{message.author_role==="coach"?"Treinador":"Aluno"} · {new Date(message.created_at).toLocaleString("pt-BR")}</small><p>{message.body}</p></article>):<p>Envie uma mensagem sobre este treino. O histórico ficará salvo aqui.</p>}</div><form onSubmit={send}><label>Mensagem<textarea maxLength={2000} rows={2} value={text} onChange={event=>setText(event.target.value)} placeholder="Escreva sua mensagem…"/></label>{error&&<p role="alert">{error}</p>}<button disabled={!text.trim()||state==="sending"}>{state==="sending"?"Enviando…":"Enviar mensagem"}</button></form></>}</details>;
}
