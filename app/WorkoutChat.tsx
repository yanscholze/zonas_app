"use client";
import { useEffect, useRef, useState } from "react";
import { api, describeError } from "./api-client";
type Message={id:string;author_role:string;body:string;created_at:number};
function ChatTranscript({messages,student,loading,open}:{messages:Message[];student:boolean;loading:boolean;open:boolean}){
  const transcript=useRef<HTMLDivElement>(null),lastMessageId=messages.at(-1)?.id;
  useEffect(()=>{if(open&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight},[open,lastMessageId]);
  return <div className="workout-chat-messages" ref={transcript} role="log" aria-label="Mensagens deste treino" aria-live="polite">
    {messages.length?messages.map(message=><article key={message.id} className={message.author_role===(student?"student":"coach")?"mine":""}><small>{message.author_role==="coach"?"Treinador":"Aluno"} · {new Date(message.created_at).toLocaleString("pt-BR")}</small><p>{message.body}</p></article>):<p>{loading?"Carregando conversa…":"Comece a conversa sobre este treino. As mensagens ficarão salvas aqui."}</p>}
  </div>;
}
export default function WorkoutChat({executionId,student=false,enabled=true,initiallyOpen=false}:{executionId:string;student?:boolean;enabled?:boolean;initiallyOpen?:boolean}){
  const [open,setOpen]=useState(initiallyOpen),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState("");
  const [sending,setSending]=useState(false);
  const [readState,setReadState]=useState({status:"ready",error:""});
  const [sendError,setSendError]=useState(""),[retry,setRetry]=useState(0);
  const epoch=useRef(0),busy=useRef(false);
  const endpoint=student?"/api/student/workout-messages":"/api/workout-messages";
  useEffect(()=>{
    if(!open||!enabled)return;
    let active=true;
    const load=async()=>{
      if(busy.current)return;
      const version=++epoch.current;
      setReadState({status:"loading",error:""});
      try{
        const data=await api.get<{messages:Message[]}>(`${endpoint}?executionId=${encodeURIComponent(executionId)}`);
        if(active&&version===epoch.current){setMessages(data.messages||[]);setReadState({status:"ready",error:""})}
      }catch(error){if(active&&version===epoch.current)setReadState({status:"error",error:describeError(error,"Não foi possível carregar a conversa.")})}
    };
    void load();const timer=setInterval(()=>{if(!document.hidden)void load()},15000);
    return()=>{active=false;clearInterval(timer)};
  },[open,enabled,endpoint,executionId,retry]);
  const send=async(event:React.FormEvent)=>{
    event.preventDefault();if(!enabled||!text.trim()||busy.current)return;
    busy.current=true;epoch.current++;setSending(true);setSendError("");
    try{
      const response=await api.post<{messages?:Message[]}>(endpoint,{executionId,message:text.trim()});
      const data=response.messages?response:await api.get<{messages:Message[]}>(`${endpoint}?executionId=${encodeURIComponent(executionId)}`);
      setMessages(data.messages||[]);setText("");setReadState({status:"ready",error:""});
    }catch(error){setSendError(describeError(error,"Não foi possível enviar. Sua mensagem foi mantida para tentar novamente."))}
    finally{busy.current=false;setSending(false);setReadState(current=>({...current,status:current.status==="loading"?"ready":current.status}))}
  };
  return <details className="workout-chat" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{student?"Responder ao treinador · Chat do treino":"Conversar com o aluno · Chat do treino"}</summary>
    {!enabled?<p>Entre na conta do aluno para conversar com o treinador.</p>:<>
      <p className="workout-chat-intro">{student?"Responda ao feedback ou conte como foi este treino. O treinador verá sua mensagem na revisão.":"Envie orientações e acompanhe as respostas do aluno neste treino."}</p>
      <ChatTranscript messages={messages} student={student} loading={readState.status==="loading"} open={open}/>
      {readState.error&&<p role="alert">{readState.error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button></p>}
      <form onSubmit={send}><label>{student?"Sua resposta ao treinador":"Mensagem ao aluno"}<textarea maxLength={2000} rows={2} disabled={sending} value={text} onChange={event=>setText(event.target.value)} placeholder="Escreva sua mensagem…"/></label>{sendError&&<p role="alert">{sendError} Sua mensagem continua no campo acima.</p>}<button disabled={!text.trim()||sending}>{sending?"Enviando…":"Enviar mensagem"}</button></form>
    </>}
  </details>;
}
