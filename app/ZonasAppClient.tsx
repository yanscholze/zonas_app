"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut, type Session } from "./AuthGate";
import { api, copyText, describeError } from "./api-client";

type Athlete = { name: string; initials: string; distance: string; plan?: string; phase: string; week: string; next: string; flag?: string; archivedAt?: number | null; archivedReason?: string | null };
type TrainingPlan = { name:string; distance:string; weeks:number; frequency:string; level:string; goal:string; phases:string[]; pending?:boolean; complete?:boolean };
type StructuredSession = { type:string; description:string; title?:string; tempoRun?:string; durationMinutes?:number; estimatedKm?:number; steps?:Array<any>; removed?:boolean };
type ParsedWorkoutBlock = { kind:"simple"; amount:number; unit:"s"|"min"|"m"; zone:string; label:string } | { kind:"repeat"; repetitions:number; effort:number; effortUnit:"s"|"min"|"m"; effortZone:string; recovery:number; recoveryUnit:"s"|"min"; recoveryZone:string };
function parseWrittenWorkout(value:string):{blocks:ParsedWorkoutBlock[];error?:string}{
  const clean=value.replace(/\u00d7/g,"x").replace(/,/g,".").replace(/\s+/g," ").trim();
  if(!clean)return{blocks:[],error:"Digite ou cole o treino antes de transformar."};
  const zonePattern="(Tempo Run (?:5 km|10 km|Meia maratona|Maratona)|Z[1-5])";
  const repeatPattern=new RegExp(`(\\d+)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s*(s|min|m)\\s*(?:em\\s*)?${zonePattern}\\s*(?:\\+|\\/|com)\\s*(\\d+(?:\\.\\d+)?)\\s*(s|min)\\s*(?:em\\s*)?${zonePattern}`,"ig");
  const simplePattern=new RegExp(`(?:aquecimento\\s*:?\\s*|desaquecimento\\s*:?\\s*|corrida\\s*:?\\s*|depois\\s*:?\\s*)?(\\d+(?:\\.\\d+)?)\\s*(s|min|m)\\s*(?:em\\s*)?${zonePattern}`,"ig");
  const found:Array<{index:number;length:number;block:ParsedWorkoutBlock}>=[];
  for(const match of clean.matchAll(repeatPattern))found.push({index:match.index||0,length:match[0].length,block:{kind:"repeat",repetitions:Number(match[1]),effort:Number(match[2]),effortUnit:match[3].toLowerCase() as "s"|"min"|"m",effortZone:match[4],recovery:Number(match[5]),recoveryUnit:match[6].toLowerCase() as "s"|"min",recoveryZone:match[7]}});
  const insideRepeat=(index:number)=>found.some(item=>index>=item.index&&index<item.index+item.length);
  for(const match of clean.matchAll(simplePattern)){if(insideRepeat(match.index||0))continue;const before=clean.slice(Math.max(0,(match.index||0)-18),match.index||0).toLowerCase();const label=before.includes("aquecimento")?"Aquecimento":before.includes("desaquecimento")?"Desaquecimento":"Parte principal";found.push({index:match.index||0,length:match[0].length,block:{kind:"simple",amount:Number(match[1]),unit:match[2].toLowerCase() as "s"|"min"|"m",zone:match[3],label}})}
  const blocks=found.sort((a,b)=>a.index-b.index).map(item=>item.block);
  if(!blocks.length)return{blocks:[],error:"Não reconheci as etapas. Use exemplos como: 15 min Z1 + 6 x 1 min Z4 / 1 min Z1 + 10 min Z1."};
  return{blocks};
}
const trainingPlans: TrainingPlan[] = [
  {name:"Iniciantes",distance:"Começar",weeks:10,frequency:"3x por semana",level:"Entrada",goal:"Correr 5 km com segurança",phases:["Adaptação","Base","Evolução","Desafio 5 km"],complete:true},
  {name:"5 km Bronze",distance:"5 km",weeks:10,frequency:"3x por semana",level:"Bronze",goal:"Concluir e evoluir nos 5 km",phases:["Base","Desenvolvimento","Específica","Pré-prova"],complete:true},
  {name:"5 km Prata",distance:"5 km",weeks:13,frequency:"até 6x por semana",level:"Prata",goal:"Evolução de ritmo e resistência",phases:["Base","Limiar e VO₂","Específica","Polimento"],complete:true},
  {name:"5 km Ouro",distance:"5 km",weeks:14,frequency:"até 6x por semana",level:"Ouro",goal:"Performance avançada nos 5 km",phases:["Base","Desenvolvimento","Específica","Polimento"],complete:true},
  {name:"5 km Elite",distance:"5 km",weeks:15,frequency:"até 6x por semana",level:"Elite",goal:"Alto rendimento nos 5 km",phases:["Base","Carga 3:1","Específica","Polimento"],complete:true},
  {name:"10 km Lion",distance:"10 km",weeks:16,frequency:"4x por semana",level:"Lion",goal:"Evoluir dos 5 km para os 10 km",phases:["Base","Desenvolvimento","Específica","Pré-prova"],complete:true},
  {name:"Meia Start",distance:"21,1 km",weeks:14,frequency:"3–4x por semana",level:"Start",goal:"Primeira meia maratona",phases:["Base Z2","Evolução","Específica","Pré-prova"],complete:true},
  {name:"Meia Finish",distance:"21,1 km",weeks:18,frequency:"4–6x por semana",level:"Finish",goal:"Performance na meia maratona",phases:["Base","VO₂ e limiar","Ritmo específico","Pré-prova"],complete:true},
  {name:"One Marathon",distance:"42,2 km",weeks:20,frequency:"4–5x por semana",level:"One",goal:"Construção para a primeira maratona",phases:["Base","Desenvolvimento","Específica","Pré-prova"],complete:true},
  {name:"Full Marathon",distance:"42,2 km",weeks:25,frequency:"5–6x por semana",level:"Full",goal:"Evolução e performance na maratona",phases:["Base","Desenvolvimento","Específica","Pré-prova"],complete:true},
];
const simpleSession=(title:string,minutes:number,steps:Array<any>):StructuredSession=>({type:"Treino estruturado",title,description:`Treino contínuo · ${minutes} min`,durationMinutes:minutes,steps});
const walkRun=(title:string,repetitions:number,runMinutes:number,walkMinutes:number,warmup=5,cooldown=5):StructuredSession=>({type:"Treino estruturado",title,description:`${repetitions} repetições · corrida e caminhada`,durationMinutes:warmup+cooldown+repetitions*(runMinutes+walkMinutes),steps:[{kind:"simple",label:"Aquecimento",minutes:warmup,zone:"Z1"},{kind:"repeat",label:"Série principal",repetitions,effortMinutes:runMinutes,effortZone:"Z2",recoveryMinutes:walkMinutes,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:cooldown,zone:"Z1"}]});
const beginnerPlanWeeks:Record<number,StructuredSession[]>={
  1:[walkRun("Primeiros passos",8,0.5,1.5),walkRun("Adaptação à corrida",10,0.5,1.5),walkRun("Caminhada e corrida longa",10,1,2)],
  2:[walkRun("Corrida leve fracionada",8,1,1.5),walkRun("Construindo constância",10,1,1),walkRun("Treino contínuo alternado",10,1.5,1.5)],
  3:[walkRun("Blocos de 2 minutos",8,2,1.5),walkRun("Corrida controlada",7,3,1.5),walkRun("Resistência inicial",6,4,2)],
  4:[walkRun("Corrida de 4 minutos",6,4,1.5),walkRun("Blocos progressivos",5,5,2),walkRun("Primeiro bloco longo",4,7,2)],
  5:[walkRun("Corrida de 6 minutos",5,6,1.5),walkRun("Controle da respiração",4,8,2),walkRun("Resistência de 10 minutos",3,10,2)],
  6:[walkRun("Blocos de 10 minutos",3,10,1.5),walkRun("Corrida de 12 minutos",3,12,2),simpleSession("Corrida contínua leve",30,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:20,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}])],
  7:[simpleSession("Corrida contínua 25 minutos",35,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:25,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]),walkRun("Variações leves",6,3,1),simpleSession("Corrida contínua 30 minutos",40,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:30,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}])],
  8:[simpleSession("Corrida leve com acelerações",35,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"repeat",label:"Acelerações controladas",repetitions:6,effortMinutes:1,effortZone:"Z3",recoveryMinutes:2,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:7,zone:"Z1"}]),simpleSession("Corrida contínua 35 minutos",45,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:35,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]),simpleSession("Resistência para os 5 km",45,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:35,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}])],
  9:[simpleSession("Corrida leve",35,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:25,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]),simpleSession("Ritmo controlado",38,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"repeat",label:"Ritmo controlado",repetitions:4,effortMinutes:3,effortZone:"Z3",recoveryMinutes:2,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:8,zone:"Z1"}]),simpleSession("Simulado leve de 5 km",45,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:35,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}])],
  10:[simpleSession("Corrida leve pré-desafio",25,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida leve",minutes:15,zone:"Z2"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]),simpleSession("Ativação para os 5 km",24,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"repeat",label:"Acelerações",repetitions:4,effortMinutes:0.5,effortZone:"Z3",recoveryMinutes:1.5,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:6,zone:"Z1"}]),{type:"Desafio",title:"Desafio 5 km",description:"Correr 5 km de forma confortável e controlada",estimatedKm:5,steps:[{kind:"simple",label:"Desafio",distanceMeters:5000,zone:"Z2"}]}],
};
const repeatSession=(title:string,repetitions:number,effortMinutes:number,effortZone:string,recoveryMinutes:number,warmup=8,cooldown=8):StructuredSession=>({type:"Treino estruturado",title,description:`${repetitions} repetições · ${warmup+cooldown+repetitions*(effortMinutes+recoveryMinutes)} min`,durationMinutes:warmup+cooldown+repetitions*(effortMinutes+recoveryMinutes),steps:[{kind:"simple",label:"Aquecimento",minutes:warmup,zone:"Z1"},{kind:"repeat",label:"Série principal",repetitions,effortMinutes,effortZone,recoveryMinutes,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:cooldown,zone:"Z1"}]});
const steady=(title:string,total:number,mainZone="Z2"):StructuredSession=>simpleSession(title,total,[{kind:"simple",label:"Aquecimento",minutes:5,zone:"Z1"},{kind:"simple",label:"Corrida contínua",minutes:total-10,zone:mainZone},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]);
const bronzePlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem leve",30),repeatSession("Fartlek de 1 minuto",8,1,"Z3",2),steady("Resistência leve",35)],
  2:[steady("Rodagem leve",35),repeatSession("Fartlek de 2 minutos",6,2,"Z3",2),steady("Corrida contínua",40)],
  3:[steady("Regenerativo",30,"Z1"),repeatSession("Blocos de 3 minutos",5,3,"Z3",2,8,7),simpleSession("Progressivo controlado",40,[{kind:"simple",label:"Início leve",minutes:10,zone:"Z1"},{kind:"simple",label:"Parte principal",minutes:20,zone:"Z2"},{kind:"simple",label:"Final controlado",minutes:10,zone:"Z3"}])],
  4:[steady("Semana leve",30),repeatSession("Acelerações curtas",8,1,"Z4",2),steady("Rodagem confortável",35)],
  5:[steady("Rodagem leve com técnica",35),repeatSession("Tempo fracionado",3,5,"Z3",2),steady("Resistência aeróbia",40)],
  6:[steady("Regenerativo",30,"Z1"),repeatSession("Intervalado de 2 minutos",6,2,"Z4",2),simpleSession("Progressivo de 40 minutos",40,[{kind:"simple",label:"Início",minutes:10,zone:"Z1"},{kind:"simple",label:"Meio",minutes:20,zone:"Z2"},{kind:"simple",label:"Final",minutes:10,zone:"Z3"}])],
  7:[steady("Rodagem leve",35),repeatSession("Intervalado de 3 minutos",5,3,"Z4",2,8,7),repeatSession("Ritmo controlado",4,4,"Z3",2)],
  8:[steady("Semana de recuperação",30,"Z1"),repeatSession("Velocidade controlada",10,1,"Z4",1),steady("Rodagem confortável",35)],
  9:[steady("Rodagem leve",30),repeatSession("Blocos específicos",4,4,"Z4",2),simpleSession("Ritmo sustentável",35,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Ritmo controlado",minutes:15,zone:"Z3"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  10:[steady("Corrida leve pré-desafio",25),repeatSession("Ativação curta",6,0.5,"Z4",1.5),{type:"Desafio",title:"Desafio ou prova de 5 km",description:"Correr 5 km com controle e evolução de ritmo",estimatedKm:5,steps:[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Prova ou desafio",distanceMeters:5000,zone:"Tempo Run 5 km"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}],tempoRun:"5 km"}],
};
const meterSession=(title:string,repetitions:number,effortMeters:number,effortZone:string,recoveryMinutes:number,warmup=10,cooldown=8):StructuredSession=>({type:"Treino estruturado",title,description:`${repetitions} × ${effortMeters} m · recuperação entre cada série`,durationMinutes:Math.round(warmup+cooldown+repetitions*(effortMeters/200+recoveryMinutes)),estimatedKm:Number(((warmup+cooldown)/6+repetitions*(effortMeters/1000+recoveryMinutes/6)).toFixed(1)),steps:[{kind:"simple",label:"Aquecimento",minutes:warmup,zone:"Z1"},{kind:"repeat",label:"Série principal",repetitions,effortMeters,effortZone,recoveryMinutes,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:cooldown,zone:"Z1"}]});
const tempoBlock=(title:string,minutes:number,zone="Z3"):StructuredSession=>simpleSession(title,minutes+20,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Ritmo sustentado",minutes,zone},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}]);
const prataPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem leve",30),repeatSession("Fartlek 8 × 1 minuto",8,1,"Z3",1.5),steady("Corrida leve",25),repeatSession("Limiar fracionado",2,8,"Z3",3),steady("Regenerativo",20,"Z1"),steady("Longão leve",45)],
  2:[steady("Rodagem leve",35),meterSession("Velocidade 10 × 200 m",10,200,"Z4",1.5),steady("Corrida leve",25),tempoBlock("Tempo Run controlado",20),steady("Regenerativo",20,"Z1"),steady("Longão leve",50)],
  3:[steady("Rodagem leve",35),meterSession("Intervalado 8 × 300 m",8,300,"Z4",1.5),steady("Corrida leve",30),repeatSession("Limiar 3 × 8 minutos",3,8,"Z3",2),steady("Regenerativo",20,"Z1"),steady("Longão progressivo",55)],
  4:[steady("Rodagem leve de recuperação",30),meterSession("Técnica e velocidade 6 × 200 m",6,200,"Z4",1.5),steady("Corrida muito leve",20,"Z1"),tempoBlock("Ritmo contínuo curto",15),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",45)],
  5:[steady("Rodagem leve",35),meterSession("Intervalado 6 × 400 m",6,400,"Z4",2),steady("Corrida leve",25),repeatSession("Limiar 2 × 10 minutos",2,10,"Z3",3),steady("Regenerativo",20,"Z1"),steady("Longão leve",55)],
  6:[steady("Rodagem aeróbia",40),meterSession("Intervalado 5 × 600 m",5,600,"Z4",2),steady("Corrida leve",25),repeatSession("Limiar 3 × 8 minutos",3,8,"Z3",2),steady("Regenerativo",20,"Z1"),steady("Longão progressivo",60)],
  7:[steady("Rodagem leve de recuperação",30),meterSession("Velocidade 8 × 200 m",8,200,"Z5",1.5),steady("Corrida muito leve",20,"Z1"),repeatSession("Fartlek 6 × 2 minutos",6,2,"Z3",2),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",50)],
  8:[steady("Rodagem leve",35),meterSession("Intervalado 5 × 800 m",5,800,"Z4",2.5),steady("Corrida leve",25),tempoBlock("Tempo Run contínuo",20),steady("Regenerativo",20,"Z1"),steady("Longão aeróbio",60)],
  9:[steady("Rodagem aeróbia",40),meterSession("Intervalado 4 × 1000 m",4,1000,"Z4",3),steady("Corrida leve",25),repeatSession("Limiar 2 × 12 minutos",2,12,"Z3",3),steady("Regenerativo",20,"Z1"),steady("Longão progressivo",55)],
  10:[steady("Rodagem leve",35),meterSession("Intervalado específico 3 × 1000 m",3,1000,"Z4",3),steady("Corrida leve",25),simpleSession("Fartlek pirâmide",40,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"repeat",label:"Pirâmide 1–2–3–2–1 min",repetitions:1,effortMinutes:9,effortZone:"Z3",recoveryMinutes:3,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}]),steady("Regenerativo",20,"Z1"),steady("Longão leve",50)],
  11:[steady("Rodagem leve",30),meterSession("Ritmo 6 × 400 m",6,400,"Z4",2),steady("Corrida muito leve",20,"Z1"),tempoBlock("Ritmo específico curto",12,"Tempo Run 5 km"),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",45)],
  12:[steady("Rodagem leve",25),meterSession("Ativação 4 × 400 m",4,400,"Z4",2),steady("Corrida muito leve",20,"Z1"),meterSession("Velocidade 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida contínua leve",35)],
  13:[steady("Corrida leve",25),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida leve curta",20),simpleSession("Soltura pré-prova",15,[{kind:"simple",label:"Corrida muito leve",minutes:15,zone:"Z1"}]),{type:"Prova",title:"Prova-alvo de 5 km",description:"Executar a estratégia definida pelo treinador",estimatedKm:5,tempoRun:"5 km",steps:[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:5000,zone:"Tempo Run 5 km"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]}],
};
const ouroPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem aeróbia",40),meterSession("Velocidade 12 × 200 m",12,200,"Z4",1.25),steady("Corrida leve",30),repeatSession("Limiar 3 × 8 minutos",3,8,"Z3",2),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",60)],
  2:[steady("Rodagem leve",45),meterSession("Intervalado 10 × 300 m",10,300,"Z4",1.5),steady("Corrida leve",30),repeatSession("Limiar 2 × 12 minutos",2,12,"Z3",3),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",65)],
  3:[steady("Rodagem aeróbia",45),meterSession("Intervalado 8 × 400 m",8,400,"Z4",1.5),steady("Corrida leve",30),tempoBlock("Tempo Run contínuo",25),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",70)],
  4:[steady("Rodagem leve de recuperação",35),meterSession("Técnica 8 × 200 m",8,200,"Z4",1.5),steady("Corrida muito leve",25,"Z1"),tempoBlock("Limiar curto",15),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",55)],
  5:[steady("Rodagem aeróbia",45),meterSession("VO₂ 6 × 500 m",6,500,"Z5",2),steady("Corrida leve",30),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",70)],
  6:[steady("Rodagem leve",45),meterSession("Intervalado 6 × 600 m",6,600,"Z4",2),steady("Corrida leve",30),tempoBlock("Tempo Run de 30 minutos",30),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",75)],
  7:[steady("Rodagem aeróbia",45),meterSession("VO₂ 5 × 800 m",5,800,"Z5",2.5),steady("Corrida leve",30),repeatSession("Limiar 2 × 15 minutos",2,15,"Z3",3),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",70)],
  8:[steady("Rodagem leve de recuperação",35),meterSession("Velocidade 10 × 200 m",10,200,"Z5",1.5),steady("Corrida muito leve",25,"Z1"),repeatSession("Fartlek 6 × 2 minutos",6,2,"Z3",2),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",55)],
  9:[steady("Rodagem aeróbia",45),meterSession("Específico 5 × 1000 m",5,1000,"Z4",2.5),steady("Corrida leve",30),repeatSession("Ritmo de prova fracionado",3,8,"Tempo Run 5 km",3),steady("Regenerativo",25,"Z1"),simpleSession("Longão com final em Z3",70,[{kind:"simple",label:"Início leve",minutes:15,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:45,zone:"Z2"},{kind:"simple",label:"Final controlado",minutes:10,zone:"Z3"}])],
  10:[steady("Rodagem leve",40),meterSession("VO₂ 12 × 400 m",12,400,"Z5",1.5),steady("Corrida leve",30),repeatSession("Limiar longo",2,15,"Z3",3),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",65)],
  11:[steady("Rodagem aeróbia",40),meterSession("Específico 4 × 1200 m",4,1200,"Tempo Run 5 km",3),steady("Corrida leve",25),simpleSession("Pirâmide de velocidade",45,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"repeat",label:"Pirâmide 200–400–600–400–200 m",repetitions:1,effortMinutes:12,effortZone:"Z5",recoveryMinutes:5,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}]),steady("Regenerativo",20,"Z1"),steady("Longão progressivo",60)],
  12:[steady("Rodagem leve",35),meterSession("Ritmo 6 × 600 m",6,600,"Z4",2),steady("Corrida muito leve",25,"Z1"),tempoBlock("Ritmo específico curto",15,"Tempo Run 5 km"),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",50)],
  13:[steady("Rodagem leve",30),meterSession("Ativação 5 × 400 m",5,400,"Z4",2),steady("Corrida muito leve",20,"Z1"),meterSession("Velocidade 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida contínua curta",40)],
  14:[steady("Corrida leve",25),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida leve curta",20),simpleSession("Soltura pré-prova",15,[{kind:"simple",label:"Corrida muito leve",minutes:15,zone:"Z1"}]),{type:"Prova",title:"Prova-alvo de 5 km Ouro",description:"Executar ritmo individual e estratégia aprovada",estimatedKm:5,tempoRun:"5 km",steps:[{kind:"simple",label:"Aquecimento",minutes:12,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:5000,zone:"Tempo Run 5 km"},{kind:"simple",label:"Desaquecimento",minutes:8,zone:"Z1"}]}],
};
const elitePlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem aeróbia",45),meterSession("Velocidade 15 × 200 m",15,200,"Z5",1),steady("Corrida leve",35),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",70)],
  2:[steady("Rodagem aeróbia",50),meterSession("Intervalado 12 × 300 m",12,300,"Z5",1.25),steady("Corrida leve",35),repeatSession("Limiar 2 × 15 minutos",2,15,"Z3",3),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",75)],
  3:[steady("Rodagem leve",45),meterSession("VO₂ 10 × 400 m",10,400,"Z5",1.5),steady("Corrida leve",35),tempoBlock("Tempo Run forte",30),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",80)],
  4:[steady("Rodagem leve de recuperação",35),meterSession("Técnica 10 × 200 m",10,200,"Z4",1.25),steady("Corrida muito leve",25,"Z1"),tempoBlock("Limiar curto",18),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",60)],
  5:[steady("Rodagem aeróbia",50),meterSession("VO₂ 8 × 500 m",8,500,"Z5",1.75),steady("Corrida leve",35),repeatSession("Limiar 4 × 8 minutos",4,8,"Z3",2),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",80)],
  6:[steady("Rodagem leve",45),meterSession("Intervalado 7 × 600 m",7,600,"Z5",2),steady("Corrida leve",35),tempoBlock("Tempo Run de 35 minutos",35),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",85)],
  7:[steady("Rodagem aeróbia",50),meterSession("VO₂ 6 × 800 m",6,800,"Z5",2.25),steady("Corrida leve",30),repeatSession("Subidas fortes 10 × 1 minuto",10,1,"Z4",1.5),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",80)],
  8:[steady("Rodagem leve de recuperação",35),meterSession("Velocidade 12 × 200 m",12,200,"Z5",1.25),steady("Corrida muito leve",25,"Z1"),repeatSession("Fartlek 8 × 2 minutos",8,2,"Z3",1.5),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",60)],
  9:[steady("Rodagem aeróbia",50),meterSession("Específico 6 × 1000 m",6,1000,"Z4",2.5),steady("Corrida leve",35),repeatSession("Ritmo de prova 4 × 6 minutos",4,6,"Tempo Run 5 km",3),steady("Regenerativo",25,"Z1"),simpleSession("Longão com final controlado",75,[{kind:"simple",label:"Início",minutes:15,zone:"Z1"},{kind:"simple",label:"Aeróbio",minutes:45,zone:"Z2"},{kind:"simple",label:"Final",minutes:15,zone:"Z3"}])],
  10:[steady("Rodagem leve",45),meterSession("VO₂ 15 × 400 m",15,400,"Z5",1.25),steady("Corrida leve",30),repeatSession("Limiar 3 × 12 minutos",3,12,"Z3",2.5),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",70)],
  11:[steady("Rodagem aeróbia",45),meterSession("Específico 5 × 1200 m",5,1200,"Tempo Run 5 km",3),steady("Corrida leve",30),meterSession("Velocidade 8 × 300 m",8,300,"Z5",1.5),steady("Regenerativo",25,"Z1"),steady("Longão progressivo",70)],
  12:[steady("Rodagem leve de recuperação",35),meterSession("Intervalado 6 × 400 m",6,400,"Z4",1.75),steady("Corrida muito leve",25,"Z1"),tempoBlock("Ritmo específico curto",18,"Tempo Run 5 km"),steady("Regenerativo",20,"Z1"),steady("Longão reduzido",55)],
  13:[steady("Rodagem leve",35),meterSession("Específico 4 × 1000 m",4,1000,"Tempo Run 5 km",3),steady("Corrida muito leve",25,"Z1"),meterSession("VO₂ 8 × 400 m",8,400,"Z5",1.5),steady("Regenerativo",20,"Z1"),steady("Corrida contínua",50)],
  14:[steady("Rodagem leve",30),meterSession("Ativação 5 × 400 m",5,400,"Z4",2),steady("Corrida muito leve",20,"Z1"),meterSession("Velocidade 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida contínua curta",40)],
  15:[steady("Corrida leve",25),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida leve curta",20),simpleSession("Soltura pré-prova",15,[{kind:"simple",label:"Corrida muito leve",minutes:15,zone:"Z1"}]),{type:"Prova",title:"Prova-alvo de 5 km Elite",description:"Executar estratégia de alto rendimento aprovada pelo treinador",estimatedKm:5,tempoRun:"5 km",steps:[{kind:"simple",label:"Aquecimento",minutes:15,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:5000,zone:"Tempo Run 5 km"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}]}],
};
const lion10kPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem leve",40),repeatSession("Fartlek 8 × 1 minuto",8,1,"Z3",2),tempoBlock("Ritmo contínuo",15),steady("Longão leve",60)],
  2:[steady("Rodagem aeróbia",45),meterSession("Intervalado 10 × 300 m",10,300,"Z4",1.5),repeatSession("Limiar 2 × 10 minutos",2,10,"Z3",3),steady("Longão progressivo",65)],
  3:[steady("Rodagem leve",45),meterSession("Intervalado 8 × 400 m",8,400,"Z4",1.5),tempoBlock("Tempo Run controlado",22),steady("Longão aeróbio",70)],
  4:[steady("Rodagem leve de recuperação",35),meterSession("Técnica 8 × 200 m",8,200,"Z4",1.5),steady("Regenerativo",30,"Z1"),steady("Longão reduzido",55)],
  5:[steady("Rodagem aeróbia",45),meterSession("Intervalado 6 × 600 m",6,600,"Z4",2),repeatSession("Limiar 3 × 8 minutos",3,8,"Z3",2),steady("Longão progressivo",70)],
  6:[steady("Rodagem leve",50),meterSession("Intervalado 5 × 800 m",5,800,"Z4",2.5),tempoBlock("Tempo Run de 25 minutos",25),steady("Longão aeróbio",75)],
  7:[steady("Rodagem aeróbia",50),meterSession("VO₂ 4 × 1000 m",4,1000,"Z5",3),repeatSession("Limiar 2 × 15 minutos",2,15,"Z3",3),steady("Longão progressivo",80)],
  8:[steady("Rodagem leve de recuperação",35),meterSession("Velocidade 10 × 200 m",10,200,"Z5",1.5),steady("Regenerativo",30,"Z1"),steady("Longão reduzido",60)],
  9:[steady("Rodagem aeróbia",50),meterSession("Específico 5 × 1000 m",5,1000,"Z4",2.5),repeatSession("Ritmo de 10 km fracionado",3,8,"Tempo Run 10 km",3),steady("Longão progressivo",80)],
  10:[steady("Rodagem leve",45),meterSession("Intervalado 4 × 1200 m",4,1200,"Z4",3),tempoBlock("Tempo Run de 30 minutos",30),simpleSession("Longão com final em Z3",80,[{kind:"simple",label:"Início",minutes:15,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:50,zone:"Z2"},{kind:"simple",label:"Final",minutes:15,zone:"Z3"}])],
  11:[steady("Rodagem aeróbia",50),meterSession("Específico 3 × 1600 m",3,1600,"Tempo Run 10 km",3),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Longão aeróbio",75)],
  12:[steady("Rodagem leve de recuperação",35),meterSession("Intervalado 6 × 400 m",6,400,"Z4",2),steady("Regenerativo",30,"Z1"),steady("Longão reduzido",60)],
  13:[steady("Rodagem leve",45),meterSession("Específico 4 × 1200 m",4,1200,"Tempo Run 10 km",3),tempoBlock("Ritmo específico contínuo",20,"Tempo Run 10 km"),steady("Longão progressivo",70)],
  14:[steady("Rodagem leve",40),meterSession("Ritmo 5 × 800 m",5,800,"Z4",2.5),steady("Regenerativo",30,"Z1"),steady("Longão reduzido",55)],
  15:[steady("Rodagem leve",35),meterSession("Ativação 5 × 400 m",5,400,"Z4",2),steady("Corrida muito leve",25,"Z1"),steady("Corrida contínua curta",45)],
  16:[steady("Corrida leve",30),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Soltura pré-prova",20,"Z1"),{type:"Prova",title:"Prova-alvo de 10 km",description:"Executar a estratégia e o ritmo individual de 10 km",estimatedKm:10,tempoRun:"10 km",steps:[{kind:"simple",label:"Aquecimento",minutes:12,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:10000,zone:"Tempo Run 10 km"},{kind:"simple",label:"Desaquecimento",minutes:8,zone:"Z1"}]}],
};
const meiaStartPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem leve",40),repeatSession("Fartlek 6 × 2 minutos",6,2,"Z3",2),steady("Corrida complementar",30,"Z1"),steady("Longão leve",70)],
  2:[steady("Rodagem aeróbia",45),meterSession("Intervalado 6 × 400 m",6,400,"Z4",2),steady("Corrida complementar",30),steady("Longão progressivo",75)],
  3:[steady("Rodagem leve",45),repeatSession("Limiar 3 × 8 minutos",3,8,"Z3",2),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",80)],
  4:[steady("Rodagem leve de recuperação",35),meterSession("Técnica 6 × 200 m",6,200,"Z4",1.5),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",65)],
  5:[steady("Rodagem aeróbia",45),meterSession("Intervalado 5 × 600 m",5,600,"Z4",2),tempoBlock("Ritmo contínuo",20),steady("Longão progressivo",85)],
  6:[steady("Rodagem leve",50),repeatSession("Limiar 2 × 12 minutos",2,12,"Z3",3),steady("Corrida complementar",30),steady("Longão aeróbio",90)],
  7:[steady("Rodagem aeróbia",50),meterSession("Intervalado 4 × 800 m",4,800,"Z4",2.5),tempoBlock("Tempo Run controlado",25),steady("Longão progressivo",100)],
  8:[steady("Rodagem leve de recuperação",40),repeatSession("Fartlek 6 × 2 minutos",6,2,"Z3",2),steady("Regenerativo",30,"Z1"),steady("Longão reduzido",80)],
  9:[steady("Rodagem aeróbia",50),meterSession("Intervalado 4 × 1000 m",4,1000,"Z4",3),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Longão aeróbio",105)],
  10:[steady("Rodagem leve",50),repeatSession("Ritmo de meia fracionado",3,8,"Tempo Run Meia maratona",3),steady("Corrida complementar",35),simpleSession("Longão com final em Z3",110,[{kind:"simple",label:"Início",minutes:20,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:70,zone:"Z2"},{kind:"simple",label:"Final",minutes:20,zone:"Z3"}])],
  11:[steady("Rodagem aeróbia",50),meterSession("Intervalado 3 × 1600 m",3,1600,"Z4",3),tempoBlock("Ritmo específico",25,"Tempo Run Meia maratona"),steady("Longão progressivo",120)],
  12:[steady("Rodagem leve de recuperação",40),meterSession("Ritmo 5 × 600 m",5,600,"Z4",2),steady("Regenerativo",30,"Z1"),steady("Longão reduzido",90)],
  13:[steady("Rodagem leve",40),meterSession("Ativação 5 × 400 m",5,400,"Z4",2),tempoBlock("Ritmo de meia curto",15,"Tempo Run Meia maratona"),steady("Longão leve",70)],
  14:[steady("Corrida leve",30),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Soltura pré-prova",20,"Z1"),{type:"Prova",title:"Primeira meia maratona",description:"Completar 21,1 km com estratégia e ritmo individual aprovados",estimatedKm:21.1,tempoRun:"Meia maratona",steps:[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:21100,zone:"Tempo Run Meia maratona"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]}],
};
const meiaFinishPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem aeróbia",45),meterSession("Velocidade 12 × 200 m",12,200,"Z5",1),steady("Corrida leve",35),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Regenerativo",30,"Z1"),steady("Longão progressivo",90)],
  2:[steady("Rodagem leve",50),meterSession("Intervalado 10 × 400 m",10,400,"Z4",1.5),steady("Corrida complementar",35),tempoBlock("Tempo Run contínuo",30,"Z3"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",100)],
  3:[steady("Rodagem aeróbia",50),meterSession("VO₂ 8 × 600 m",8,600,"Z5",2),steady("Corrida leve",35),repeatSession("Limiar 2 × 15 minutos",2,15,"Z3",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão com final em Z3",105,[{kind:"simple",label:"Início leve",minutes:20,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:70,zone:"Z2"},{kind:"simple",label:"Final controlado",minutes:15,zone:"Z3"}])],
  4:[steady("Rodagem de recuperação",40),meterSession("Técnica 10 × 200 m",10,200,"Z4",1.25),steady("Corrida muito leve",30,"Z1"),repeatSession("Fartlek 8 × 2 minutos",8,2,"Z3",1.5),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",80)],
  5:[steady("Rodagem aeróbia",50),meterSession("VO₂ 6 × 800 m",6,800,"Z5",2.5),steady("Corrida leve",35),repeatSession("Limiar 3 × 12 minutos",3,12,"Z3",2.5),steady("Regenerativo",30,"Z1"),steady("Longão progressivo",110)],
  6:[steady("Rodagem leve",55),meterSession("Intervalado 5 × 1000 m",5,1000,"Z4",2.5),steady("Corrida complementar",35),tempoBlock("Tempo Run de 35 minutos",35,"Z3"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",115)],
  7:[steady("Rodagem aeróbia",55),meterSession("VO₂ 12 × 400 m",12,400,"Z5",1.5),steady("Corrida leve",35),repeatSession("Limiar 2 × 18 minutos",2,18,"Z3",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão progressivo com ritmo",120,[{kind:"simple",label:"Início leve",minutes:20,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:80,zone:"Z2"},{kind:"simple",label:"Final progressivo",minutes:20,zone:"Z3"}])],
  8:[steady("Rodagem de recuperação",40),meterSession("Velocidade 12 × 200 m",12,200,"Z5",1.25),steady("Corrida muito leve",30,"Z1"),repeatSession("Fartlek 10 × 1 minuto",10,1,"Z4",1.5),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",90)],
  9:[steady("Rodagem aeróbia",55),meterSession("Específico 4 × 1600 m",4,1600,"Z4",3),steady("Corrida leve",35),repeatSession("Ritmo de meia 3 × 12 minutos",3,12,"Tempo Run Meia maratona",3),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",125)],
  10:[steady("Rodagem leve",50),meterSession("VO₂ 8 × 600 m",8,600,"Z5",2),steady("Corrida complementar",35),simpleSession("Tempo Run combinado 5 km e meia",45,[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Tempo Run 5 km",minutes:10,zone:"Tempo Run 5 km"},{kind:"simple",label:"Recuperação",minutes:3,zone:"Z1"},{kind:"simple",label:"Tempo Run meia maratona",minutes:5,zone:"Tempo Run Meia maratona"},{kind:"simple",label:"Desaquecimento",minutes:17,zone:"Z1"}]),steady("Regenerativo",30,"Z1"),simpleSession("Longão com final em ritmo de meia",130,[{kind:"simple",label:"Início leve",minutes:20,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:85,zone:"Z2"},{kind:"simple",label:"Ritmo de meia",minutes:15,zone:"Tempo Run Meia maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  11:[steady("Rodagem aeróbia",55),meterSession("Específico 3 × 2000 m",3,2000,"Tempo Run 10 km",3),steady("Corrida leve",35),repeatSession("Limiar 3 × 15 minutos",3,15,"Z3",2.5),steady("Regenerativo",30,"Z1"),steady("Longão progressivo",135)],
  12:[steady("Rodagem de recuperação",40),meterSession("Técnica 8 × 300 m",8,300,"Z4",1.5),steady("Corrida muito leve",30,"Z1"),tempoBlock("Ritmo específico curto",20,"Tempo Run Meia maratona"),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",100)],
  13:[steady("Rodagem aeróbia",55),meterSession("VO₂ 10 × 500 m",10,500,"Z5",1.75),steady("Corrida leve",35),repeatSession("Ritmo de meia 4 × 10 minutos",4,10,"Tempo Run Meia maratona",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão específico",140,[{kind:"simple",label:"Início leve",minutes:20,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:85,zone:"Z2"},{kind:"repeat",label:"Blocos em ritmo de meia",repetitions:3,effortMinutes:8,effortZone:"Tempo Run Meia maratona",recoveryMinutes:3,recoveryZone:"Z1"},{kind:"simple",label:"Desaquecimento",minutes:2,zone:"Z1"}])],
  14:[steady("Rodagem leve",50),meterSession("Específico 4 × 2000 m",4,2000,"Tempo Run 10 km",3),steady("Corrida complementar",35),tempoBlock("Tempo Run meia maratona",35,"Tempo Run Meia maratona"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",130)],
  15:[steady("Rodagem aeróbia",50),meterSession("VO₂ 6 × 800 m",6,800,"Z5",2.5),steady("Corrida leve",30),repeatSession("Limiar 2 × 15 minutos",2,15,"Z3",3),steady("Regenerativo",25,"Z1"),simpleSession("Último longão com ritmo",120,[{kind:"simple",label:"Início leve",minutes:20,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:75,zone:"Z2"},{kind:"simple",label:"Ritmo de meia",minutes:15,zone:"Tempo Run Meia maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  16:[steady("Rodagem de recuperação",40),meterSession("Ritmo 6 × 600 m",6,600,"Z4",2),steady("Corrida muito leve",25,"Z1"),tempoBlock("Ritmo de meia curto",20,"Tempo Run Meia maratona"),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",90)],
  17:[steady("Rodagem leve",40),meterSession("Específico 4 × 1000 m",4,1000,"Tempo Run 10 km",2.5),steady("Corrida muito leve",25,"Z1"),tempoBlock("Ritmo de meia controlado",15,"Tempo Run Meia maratona"),steady("Regenerativo",20,"Z1"),steady("Longão leve pré-prova",65)],
  18:[steady("Corrida leve",25),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida leve curta",20,"Z1"),simpleSession("Soltura pré-prova",15,[{kind:"simple",label:"Corrida muito leve",minutes:15,zone:"Z1"}]),{type:"Prova",title:"Prova-alvo de meia maratona",description:"Executar a estratégia de performance aprovada pelo treinador",estimatedKm:21.1,tempoRun:"Meia maratona",steps:[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:21100,zone:"Tempo Run Meia maratona"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]}],
};
const oneMarathonPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem leve",45),repeatSession("Fartlek 8 × 2 minutos",8,2,"Z3",2),steady("Corrida complementar",35),tempoBlock("Ritmo contínuo",20,"Z3"),steady("Longão leve",100)],
  2:[steady("Rodagem aeróbia",50),meterSession("Intervalado 8 × 400 m",8,400,"Z4",2),steady("Regenerativo",35,"Z1"),repeatSession("Limiar 2 × 12 minutos",2,12,"Z3",3),steady("Longão progressivo",110)],
  3:[steady("Rodagem leve",50),meterSession("Intervalado 6 × 600 m",6,600,"Z4",2),steady("Corrida complementar",35),tempoBlock("Tempo Run controlado",25,"Z3"),steady("Longão aeróbio",120)],
  4:[steady("Rodagem de recuperação",40),meterSession("Técnica 8 × 200 m",8,200,"Z4",1.5),steady("Regenerativo",30,"Z1"),repeatSession("Fartlek leve 6 × 2 minutos",6,2,"Z3",2),steady("Longão reduzido",90)],
  5:[steady("Rodagem aeróbia",55),meterSession("Intervalado 5 × 800 m",5,800,"Z4",2.5),steady("Corrida complementar",40),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Longão progressivo",130)],
  6:[steady("Rodagem leve",55),meterSession("Intervalado 4 × 1000 m",4,1000,"Z4",3),steady("Regenerativo",35,"Z1"),tempoBlock("Tempo Run de 30 minutos",30,"Z3"),steady("Longão aeróbio",140)],
  7:[steady("Rodagem aeróbia",55),repeatSession("Subidas 10 × 2 minutos",10,2,"Z4",2),steady("Corrida complementar",40),repeatSession("Limiar 2 × 15 minutos",2,15,"Z3",3),simpleSession("Longão com final em Z3",150,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:105,zone:"Z2"},{kind:"simple",label:"Final controlado",minutes:20,zone:"Z3"}])],
  8:[steady("Rodagem de recuperação",40),meterSession("Velocidade 10 × 200 m",10,200,"Z4",1.5),steady("Regenerativo",30,"Z1"),tempoBlock("Ritmo contínuo curto",20,"Z3"),steady("Longão reduzido",110)],
  9:[steady("Rodagem aeróbia",60),meterSession("Intervalado 5 × 1000 m",5,1000,"Z4",3),steady("Corrida complementar",40),repeatSession("Limiar 3 × 12 minutos",3,12,"Z3",2.5),steady("Longão progressivo",160)],
  10:[steady("Rodagem leve",55),meterSession("Intervalado 3 × 1600 m",3,1600,"Z4",3),steady("Regenerativo",35,"Z1"),tempoBlock("Ritmo de maratona",30,"Tempo Run Maratona"),simpleSession("Longão com ritmo de maratona",170,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:110,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:25,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  11:[steady("Rodagem aeróbia",60),meterSession("Intervalado 6 × 800 m",6,800,"Z4",2.5),steady("Corrida complementar",40),repeatSession("Ritmo de maratona 3 × 15 minutos",3,15,"Tempo Run Maratona",3),steady("Longão aeróbio",180)],
  12:[steady("Rodagem de recuperação",45),meterSession("Técnica 8 × 300 m",8,300,"Z4",1.5),steady("Regenerativo",30,"Z1"),tempoBlock("Ritmo de maratona curto",20,"Tempo Run Maratona"),steady("Longão reduzido",130)],
  13:[steady("Rodagem aeróbia",60),meterSession("Intervalado 4 × 1200 m",4,1200,"Z4",3),steady("Corrida complementar",40),repeatSession("Limiar 2 × 18 minutos",2,18,"Z3",3),simpleSession("Longão específico",185,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:125,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:25,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  14:[steady("Rodagem leve",60),meterSession("Intervalado 3 × 2000 m",3,2000,"Tempo Run Meia maratona",3),steady("Regenerativo",35,"Z1"),tempoBlock("Tempo Run maratona",40,"Tempo Run Maratona"),steady("Longão aeróbio",190)],
  15:[steady("Rodagem aeróbia",60),meterSession("VO₂ 8 × 600 m",8,600,"Z5",2),steady("Corrida complementar",40),repeatSession("Ritmo de maratona 4 × 12 minutos",4,12,"Tempo Run Maratona",3),simpleSession("Longão principal com ritmo",200,[{kind:"simple",label:"Início leve",minutes:30,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:125,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:35,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  16:[steady("Rodagem de recuperação",45),meterSession("Ritmo 6 × 600 m",6,600,"Z4",2),steady("Regenerativo",30,"Z1"),tempoBlock("Ritmo de maratona curto",25,"Tempo Run Maratona"),steady("Longão reduzido",145)],
  17:[steady("Rodagem aeróbia",55),meterSession("Específico 4 × 1600 m",4,1600,"Tempo Run Meia maratona",3),steady("Corrida complementar",35),repeatSession("Ritmo de maratona 3 × 15 minutos",3,15,"Tempo Run Maratona",3),simpleSession("Último longão específico",180,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:115,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:30,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  18:[steady("Rodagem leve",50),meterSession("Intervalado 5 × 800 m",5,800,"Z4",2.5),steady("Regenerativo",30,"Z1"),tempoBlock("Ritmo de maratona",25,"Tempo Run Maratona"),steady("Longão reduzido",120)],
  19:[steady("Rodagem leve",40),meterSession("Ativação 5 × 400 m",5,400,"Z4",2),steady("Regenerativo",25,"Z1"),tempoBlock("Ritmo de maratona curto",15,"Tempo Run Maratona"),steady("Longão leve pré-prova",70)],
  20:[steady("Corrida leve",25),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),simpleSession("Soltura pré-prova",15,[{kind:"simple",label:"Corrida muito leve",minutes:15,zone:"Z1"}]),{type:"Prova",title:"Primeira maratona",description:"Completar 42,2 km com estratégia, hidratação e ritmo aprovados pelo treinador",estimatedKm:42.2,tempoRun:"Maratona",steps:[{kind:"simple",label:"Aquecimento",minutes:8,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:42195,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]}],
};
const fullMarathonPlanWeeks:Record<number,StructuredSession[]>={
  1:[steady("Rodagem aeróbia",55),meterSession("Velocidade 12 × 200 m",12,200,"Z5",1),steady("Corrida leve",40),repeatSession("Limiar 3 × 10 minutos",3,10,"Z3",2),steady("Regenerativo",30,"Z1"),steady("Longão progressivo",120)],
  2:[steady("Rodagem leve",60),meterSession("Intervalado 10 × 400 m",10,400,"Z4",1.5),steady("Corrida complementar",40),tempoBlock("Tempo Run contínuo",30,"Z3"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",130)],
  3:[steady("Rodagem aeróbia",60),meterSession("VO₂ 8 × 600 m",8,600,"Z5",2),steady("Corrida leve",40),repeatSession("Limiar 2 × 18 minutos",2,18,"Z3",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão com final em Z3",140,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:95,zone:"Z2"},{kind:"simple",label:"Final controlado",minutes:20,zone:"Z3"}])],
  4:[steady("Rodagem de recuperação",45),meterSession("Técnica 10 × 200 m",10,200,"Z4",1.25),steady("Corrida muito leve",30,"Z1"),repeatSession("Fartlek 8 × 2 minutos",8,2,"Z3",1.5),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",105)],
  5:[steady("Rodagem aeróbia",60),meterSession("VO₂ 6 × 800 m",6,800,"Z5",2.5),steady("Corrida leve",40),repeatSession("Limiar 3 × 12 minutos",3,12,"Z3",2.5),steady("Regenerativo",30,"Z1"),steady("Longão progressivo",150)],
  6:[steady("Rodagem leve",60),meterSession("Intervalado 5 × 1000 m",5,1000,"Z4",2.5),steady("Corrida complementar",40),tempoBlock("Tempo Run de 35 minutos",35,"Z3"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",160)],
  7:[steady("Rodagem aeróbia",65),repeatSession("Subidas 12 × 2 minutos",12,2,"Z4",2),steady("Corrida leve",40),repeatSession("Limiar 2 × 20 minutos",2,20,"Z3",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão progressivo",170,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:120,zone:"Z2"},{kind:"simple",label:"Final controlado",minutes:25,zone:"Z3"}])],
  8:[steady("Rodagem de recuperação",45),meterSession("Velocidade 12 × 200 m",12,200,"Z5",1.25),steady("Corrida muito leve",30,"Z1"),repeatSession("Fartlek 10 × 1 minuto",10,1,"Z4",1.5),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",120)],
  9:[steady("Rodagem aeróbia",65),meterSession("Específico 5 × 1200 m",5,1200,"Z4",3),steady("Corrida leve",40),repeatSession("Limiar 3 × 15 minutos",3,15,"Z3",2.5),steady("Regenerativo",30,"Z1"),steady("Longão progressivo",180)],
  10:[steady("Rodagem leve",60),meterSession("Intervalado 4 × 1600 m",4,1600,"Z4",3),steady("Corrida complementar",40),tempoBlock("Ritmo de maratona",35,"Tempo Run Maratona"),steady("Regenerativo",30,"Z1"),simpleSession("Longão com ritmo de maratona",185,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:120,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:30,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  11:[steady("Rodagem aeróbia",65),meterSession("VO₂ 10 × 600 m",10,600,"Z5",2),steady("Corrida leve",40),repeatSession("Ritmo de maratona 3 × 18 minutos",3,18,"Tempo Run Maratona",3),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",190)],
  12:[steady("Rodagem de recuperação",45),meterSession("Técnica 8 × 300 m",8,300,"Z4",1.5),steady("Corrida muito leve",30,"Z1"),tempoBlock("Ritmo de maratona curto",25,"Tempo Run Maratona"),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",135)],
  13:[steady("Rodagem aeróbia",65),meterSession("Específico 4 × 2000 m",4,2000,"Tempo Run Meia maratona",3),steady("Corrida leve",40),repeatSession("Limiar 2 × 20 minutos",2,20,"Z3",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão específico",195,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:125,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:35,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  14:[steady("Rodagem leve",65),meterSession("VO₂ 8 × 800 m",8,800,"Z5",2.5),steady("Corrida complementar",40),tempoBlock("Tempo Run maratona",45,"Tempo Run Maratona"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",200)],
  15:[steady("Rodagem aeróbia",65),meterSession("Específico 3 × 3000 m",3,3000,"Tempo Run Meia maratona",4),steady("Corrida leve",40),repeatSession("Ritmo de maratona 4 × 15 minutos",4,15,"Tempo Run Maratona",3),steady("Regenerativo",30,"Z1"),simpleSession("Longão principal com ritmo",210,[{kind:"simple",label:"Início leve",minutes:30,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:125,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:45,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  16:[steady("Rodagem de recuperação",50),meterSession("Ritmo 8 × 600 m",8,600,"Z4",2),steady("Corrida muito leve",30,"Z1"),tempoBlock("Ritmo de maratona curto",30,"Tempo Run Maratona"),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",150)],
  17:[steady("Rodagem aeróbia",65),meterSession("VO₂ 12 × 500 m",12,500,"Z5",1.75),steady("Corrida leve",40),repeatSession("Limiar 3 × 15 minutos",3,15,"Z3",2.5),steady("Regenerativo",30,"Z1"),simpleSession("Longão específico progressivo",215,[{kind:"simple",label:"Início leve",minutes:30,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:130,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:45,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  18:[steady("Rodagem leve",65),meterSession("Específico 5 × 2000 m",5,2000,"Tempo Run Meia maratona",3),steady("Corrida complementar",40),tempoBlock("Tempo Run maratona",50,"Tempo Run Maratona"),steady("Regenerativo",30,"Z1"),steady("Longão aeróbio",205)],
  19:[steady("Rodagem aeróbia",65),meterSession("VO₂ 6 × 1000 m",6,1000,"Z5",3),steady("Corrida leve",40),repeatSession("Ritmo de maratona 3 × 20 minutos",3,20,"Tempo Run Maratona",4),steady("Regenerativo",30,"Z1"),simpleSession("Maior longão específico",220,[{kind:"simple",label:"Início leve",minutes:30,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:130,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:50,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  20:[steady("Rodagem de recuperação",50),meterSession("Técnica 10 × 300 m",10,300,"Z4",1.5),steady("Corrida muito leve",30,"Z1"),tempoBlock("Ritmo de maratona controlado",30,"Tempo Run Maratona"),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",155)],
  21:[steady("Rodagem aeróbia",60),meterSession("Específico 4 × 2000 m",4,2000,"Tempo Run Meia maratona",3),steady("Corrida leve",35),repeatSession("Ritmo de maratona 3 × 18 minutos",3,18,"Tempo Run Maratona",3),steady("Regenerativo",30,"Z1"),simpleSession("Último longão específico",190,[{kind:"simple",label:"Início leve",minutes:25,zone:"Z1"},{kind:"simple",label:"Parte aeróbia",minutes:120,zone:"Z2"},{kind:"simple",label:"Ritmo de maratona",minutes:35,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}])],
  22:[steady("Rodagem leve",55),meterSession("VO₂ 6 × 800 m",6,800,"Z5",2.5),steady("Corrida complementar",35),tempoBlock("Tempo Run maratona",35,"Tempo Run Maratona"),steady("Regenerativo",25,"Z1"),steady("Longão aeróbio",145)],
  23:[steady("Rodagem leve",50),meterSession("Ritmo 5 × 1000 m",5,1000,"Z4",3),steady("Corrida muito leve",30,"Z1"),tempoBlock("Ritmo de maratona curto",25,"Tempo Run Maratona"),steady("Regenerativo",25,"Z1"),steady("Longão reduzido",105)],
  24:[steady("Rodagem leve",40),meterSession("Ativação 5 × 400 m",5,400,"Z4",2),steady("Regenerativo",25,"Z1"),tempoBlock("Ritmo de maratona leve",15,"Tempo Run Maratona"),steady("Corrida muito leve",20,"Z1"),steady("Soltura pré-prova",45)],
  25:[steady("Corrida leve",25),meterSession("Ativação 8 × 100 m",8,100,"Z5",1.5,8,6),steady("Regenerativo",20,"Z1"),steady("Corrida leve curta",20,"Z1"),simpleSession("Soltura pré-prova",15,[{kind:"simple",label:"Corrida muito leve",minutes:15,zone:"Z1"}]),{type:"Prova",title:"Maratona-alvo Full",description:"Executar a estratégia de performance, hidratação e ritmo aprovada pelo treinador",estimatedKm:42.2,tempoRun:"Maratona",steps:[{kind:"simple",label:"Aquecimento",minutes:8,zone:"Z1"},{kind:"simple",label:"Prova",distanceMeters:42195,zone:"Tempo Run Maratona"},{kind:"simple",label:"Desaquecimento",minutes:5,zone:"Z1"}]}],
};
const planWeekTemplates:Record<string,Record<number,StructuredSession[]>>={"Iniciantes":beginnerPlanWeeks,"5 km Bronze":bronzePlanWeeks,"5 km Prata":prataPlanWeeks,"5 km Ouro":ouroPlanWeeks,"5 km Elite":elitePlanWeeks,"10 km Lion":lion10kPlanWeeks,"Meia Start":meiaStartPlanWeeks,"Meia Finish":meiaFinishPlanWeeks,"One Marathon":oneMarathonPlanWeeks,"Full Marathon":fullMarathonPlanWeeks};
const sessionPriority=(session:StructuredSession)=>{const text=`${session.type} ${session.title||""}`.toLowerCase();if(/prova|desafio|longão/.test(text))return 100;if(/tempo|limiar|específico|intervalado|fartlek|vo₂|ritmo|ativação/.test(text))return 80;if(/rodagem|aeróbia|contínua/.test(text))return 40;return 20};
const sessionsForPlanWeek=(planName:string,weekNumber:number,days:string[])=>{const template=planWeekTemplates[planName]?.[weekNumber]||[];if(!template.length)return{};const chosen=template.map((session,index)=>({session,index})).sort((a,b)=>sessionPriority(b.session)-sessionPriority(a.session)).slice(0,days.length).sort((a,b)=>a.index-b.index).map(item=>item.session);return Object.fromEntries(days.slice(0,chosen.length).map((day,index)=>[day,chosen[index]]))};
const sessionsForSavedPlanWeek=async(planName:string,weekNumber:number,days:string[])=>{let template=planWeekTemplates[planName]?.[weekNumber]||[];try{const response=await fetch(`/api/plan-template-overrides?plan=${encodeURIComponent(planName)}&week=${weekNumber}`);if(response.ok){const data=await response.json();if(Array.isArray(data.override?.sessions)&&data.override.sessions.length)template=data.override.sessions}}catch{}if(!template.length)return{};const chosen=template.map((session,index)=>({session,index})).sort((a,b)=>sessionPriority(b.session)-sessionPriority(a.session)).slice(0,days.length).sort((a,b)=>a.index-b.index).map(item=>item.session);return Object.fromEntries(days.slice(0,chosen.length).map((day,index)=>[day,chosen[index]]))};
const phaseForPlanWeek=(planName:string,weekNumber:number)=>{const plan=trainingPlans.find(item=>item.name===planName);if(!plan)return"Base";const value=plan.phases[Math.min(plan.phases.length-1,Math.floor((weekNumber-1)/(plan.weeks/plan.phases.length)))];if(value.includes("Adaptação"))return"Adaptação";if(value.includes("Base"))return"Base";if(value.includes("Pré")||value.includes("Polimento")||value.includes("Desafio"))return"Pré-prova";if(value.includes("Específica")||value.includes("Ritmo específico"))return"Específica";return"Desenvolvimento"};
/** A lista de alunos vem sempre do banco. Não há dados de demonstração. */
const athletes: Athlete[] = [];

const distances = ["Todos", "Iniciantes", "5 km", "10 km", "Meia", "Maratona"];
const phases = ["Todas", "Adaptação", "Base", "Desenvolvimento", "Específica", "Pré-prova"];
const planNames = ["Todas","Iniciantes","5 km Bronze","5 km Prata","5 km Ouro","5 km Elite","10 km Lion","Meia Start","Meia Finish","One Marathon","Full Marathon"];
const defaultPlanForDistance = (distance:string) => distance === "Iniciantes" ? "Iniciantes" : distance === "5 km" ? "5 km Bronze" : distance === "10 km" ? "10 km Lion" : distance === "Meia" ? "Meia Start" : distance === "Maratona" ? "One Marathon" : "Sem base";
const athletePlan = (athlete:Athlete) => athlete.plan || defaultPlanForDistance(athlete.distance);
const nav = ["Painel", "Cadastros", "Alunos", "Calendário", "Planilhas", "Testes e zonas", "Provas", "Financeiro", "Integrações", "Contas", "Segurança"];

/** Um provedor de integração como a área do aluno o exibe. */
type ProviderCard = {
  id: string; label: string; available?: boolean; authType?: string; notes?: string;
  connection?: { status?: string; last_sync_at?: number } | null;
};

/**
 * Usado apenas quando a lista real ainda não chegou do servidor — na prévia do
 * professor, por exemplo. Nenhum provedor é dado como disponível aqui: afirmar
 * isso sem ter consultado o servidor seria anunciar uma conexão que pode não
 * existir.
 */
const PROVIDER_PREVIEW = [
  {id:"strava",label:"Strava",available:false,notes:"Importa atividades concluídas."},
  {id:"garmin",label:"Garmin",available:false,notes:"Envia treinos estruturados e importa atividades."},
  {id:"zepp",label:"Amazfit / Zepp",available:false,notes:"Importa atividades registradas pelo relógio."},
  {id:"apple",label:"Apple Saúde / Apple Watch",available:false,notes:"Envio pelo iPhone, por um Atalho do iOS."},
];

/** Iniciais para o avatar do treinador, a partir do nome da conta. */
const initialsOf = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase() || "ZA";

/** Saudação conforme a hora em Brasília, onde o treinador usa o sistema. */
function greeting(): string {
  const hora = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
}

/** No celular a barra inferior mostra apenas os quatro primeiros itens de `nav`. */
const MOBILE_VISIBLE_NAV = 4;
const navIcon = (item: string) => item === "Painel" ? "⌂" : item === "Alunos" ? "◉" : item === "Calendário" ? "□" : item === "Planilhas" ? "▤" : item === "Provas" ? "⚑" : item === "Financeiro" ? "$" : item === "Integrações" ? "⌚" : item === "Contas" ? "☰" : item === "Segurança" ? "◇" : "↗";

function pace(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}/km`;
}

function paceInput(seconds:number){const rounded=Math.round(Number(seconds)||0);return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,"0")}`}
function paceSeconds(value:string){const match=value.trim().match(/^(\d{1,2}):(\d{2})$/);if(!match)return NaN;return Number(match[1])*60+Number(match[2])}

function duration(seconds: number) {
  const rounded = Math.round(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function mondayOf(value:string){const date=new Date(`${value}T12:00:00Z`);const day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10)}
function shiftIsoDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
function weekDateLabel(start:string){const end=shiftIsoDate(start,6);const format=(value:string,withYear=false)=>new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short",...(withYear?{year:"numeric"}:{}) ,timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`)).replace(" de "," ");return `${format(start)} – ${format(end,true)}`}
function brazilCalendar(){const now=new Date(Date.now()-3*60*60*1000);const day=now.getUTCDay();const keys=["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];return{key:keys[day],label:new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"2-digit",month:"long",timeZone:"America/Sao_Paulo"}).format(new Date())}}

export default function ZonasAppClient({ session, onLeaveDev, visitando }: { session: Session; onLeaveDev?: () => void; visitando?: { name: string; email: string } | null }) {
  const [active, setActive] = useState("Painel");
  const [mobileMenu, setMobileMenu] = useState(false);
  const coachInitials = initialsOf(session.name);
  const [distanceFilter, setDistanceFilter] = useState("Todos");
  const [phaseFilter, setPhaseFilter] = useState("Todas");
  const [planFilter, setPlanFilter] = useState("Todas");
  const [student, setStudent] = useState(false);
  const [previewAthleteName,setPreviewAthleteName]=useState("");
  const [testDistance, setTestDistance] = useState(3);
  const [minutes, setMinutes] = useState(12);
  const [seconds, setSeconds] = useState(0);
  const [age, setAge] = useState(30);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  /** Lesão aberta para acompanhamento, venha do aviso ou da ficha do aluno. */
  const [painCase, setPainCase] = useState<{ id: string; athleteName: string } | null>(null);
  const [newAthlete, setNewAthlete] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TrainingPlan | null>(null);
  const [athleteRecords, setAthleteRecords] = useState(athletes);
  const [situationFilter, setSituationFilter] = useState<"Ativos" | "Inativos" | "Todos">("Ativos");
  const [athleteCounts, setAthleteCounts] = useState({ active: 0, archived: 0 });
  const [painReports,setPainReports]=useState<any[]>([]);
  const [pendingRaces,setPendingRaces]=useState<any[]>([]);
  const [pendingTests,setPendingTests]=useState<any[]>([]);
  const [pendingAccess,setPendingAccess]=useState<any[]>([]);
  const [sessionLocked,setSessionLocked]=useState(false);
  const [unlocking,setUnlocking]=useState(false);

  useEffect(()=>{
    if(sessionLocked)return;
    let timer:number;
    const reset=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>setSessionLocked(true),30*60*1000)};
    const events=["pointerdown","keydown","scroll","touchstart"] as const;
    events.forEach(event=>window.addEventListener(event,reset,{passive:true}));
    const previewLock=()=>{if(["terminal.local","localhost"].includes(window.location.hostname))setSessionLocked(true)};
    window.addEventListener("zonasapp:test-session-lock",previewLock);
    reset();
    return()=>{window.clearTimeout(timer);events.forEach(event=>window.removeEventListener(event,reset));window.removeEventListener("zonasapp:test-session-lock",previewLock)};
  },[sessionLocked]);

  const confirmAccess=async()=>{
    setUnlocking(true);
    try{const response=await fetch("/api/session",{cache:"no-store"});if(!response.ok)throw new Error("session_invalid");setSessionLocked(false)}
    catch{window.location.reload()}
    finally{setUnlocking(false)}
  };

  const refreshAthleteRecords=(situacao=situationFilter)=>{
    const parametro=situacao==="Inativos"?"?include=archived":situacao==="Todos"?"?include=all":"";
    fetch(`/api/athletes${parametro}`).then(r => r.ok ? r.json() : { athletes: [] }).then(data => {
      const saved = (data.athletes || []).map((a: any) => ({ name: a.name, initials: a.initials, distance: a.distance, plan:a.saved_plan || defaultPlanForDistance(a.distance), phase: a.planning_phase || a.phase, week:a.planning_week_number?`${a.planning_week_number} de ${a.planning_total_weeks}`:a.week, next: a.next_workout, flag: a.status || undefined, archivedAt: a.archived_at || null, archivedReason: a.archived_reason || null }));
      setAthleteRecords(saved);
      if(data.counts)setAthleteCounts(data.counts);
    }).catch(() => undefined);
  };
  useEffect(() => {refreshAthleteRecords();const refresh=()=>refreshAthleteRecords();window.addEventListener("zonasapp:athletes-refresh",refresh);return()=>window.removeEventListener("zonasapp:athletes-refresh",refresh)}, [situationFilter]);
  const refreshPainReports=()=>fetch("/api/pain-reports").then(r=>r.ok?r.json():{reports:[]})
    .then(data=>setPainReports((data.reports||[]).filter((item:any)=>item.status!=="Resolvido")))
    .catch(()=>undefined);
  useEffect(()=>{refreshPainReports();const atualiza=()=>refreshPainReports();window.addEventListener("zonasapp:pain-refresh",atualiza);return()=>window.removeEventListener("zonasapp:pain-refresh",atualiza)},[student]);
  useEffect(()=>{fetch("/api/races-records").then(r=>r.ok?r.json():{races:[]}).then(data=>setPendingRaces(data.races||[])).catch(()=>undefined)},[student]);
  useEffect(()=>{const refresh=()=>fetch("/api/performance-tests").then(r=>r.ok?r.json():{tests:[]}).then(data=>setPendingTests(data.tests||[])).catch(()=>undefined);refresh();window.addEventListener("zonasapp:test-saved",refresh);return()=>window.removeEventListener("zonasapp:test-saved",refresh)},[student]);
  useEffect(()=>{fetch("/api/access-requests").then(r=>r.ok?r.json():{requests:[]}).then(data=>setPendingAccess((data.requests||[]).filter((item:any)=>item.status==="Pendente"))).catch(()=>undefined)},[student]);
  useEffect(()=>{if(!athleteRecords.length)return;setPreviewAthleteName(current=>athleteRecords.some(athlete=>athlete.name===current)?current:athleteRecords[0].name)},[athleteRecords]);
  useEffect(()=>{const openTests=(event:Event)=>{const name=(event as CustomEvent<string>).detail;if(name)sessionStorage.setItem("zonasapp:tests-athlete",name);setSelectedAthlete(null);setActive("Testes e zonas")};window.addEventListener("zonasapp:open-tests",openTests);return()=>window.removeEventListener("zonasapp:open-tests",openTests)},[]);
  useEffect(()=>{const openCalendar=(event:Event)=>{const name=(event as CustomEvent<string>).detail;if(name)sessionStorage.setItem("zonasapp:calendar-athlete",name);setSelectedAthlete(null);setActive("Calendário")};window.addEventListener("zonasapp:open-calendar",openCalendar);return()=>window.removeEventListener("zonasapp:open-calendar",openCalendar)},[]);
  useEffect(()=>{const previewAthlete=(event:Event)=>{const name=(event as CustomEvent<string>).detail;if(name)setPreviewAthleteName(name);setSelectedAthlete(null);setStudent(true)};window.addEventListener("zonasapp:preview-athlete",previewAthlete);return()=>window.removeEventListener("zonasapp:preview-athlete",previewAthlete)},[]);

  const filtered = athleteRecords.filter(a => (distanceFilter === "Todos" || a.distance === distanceFilter) && (phaseFilter === "Todas" || a.phase === phaseFilter) && (planFilter === "Todas" || athletePlan(a) === planFilter));
  const calc = useMemo(() => {
    const total = Math.max(1, minutes * 60 + seconds);
    const vam = testDistance / (total / 3600);
    const vo2 = vam * 3.5;
    const paceSeconds = total / testDistance;
    const fcMax = 220 - age;
    const zones = [
      ["Z1", "Recuperação", .60, .70], ["Z2", "Aeróbio", .70, .80], ["Z3", "Tempo Run", .80, .90],
      ["Z4", "Limiar", .90, 1], ["Z5", "VO₂ máximo", 1, 1.10],
    ].map(([z, label, low, high]) => ({ z, label, slow: paceSeconds / Number(low), fast: paceSeconds / Number(high) }));
    const tempoRuns = [
      ["5 km", 5], ["10 km", 10], ["Meia maratona", 21.0975], ["Maratona", 42.195],
    ].map(([label, km]) => {
      const targetKm = Number(km);
      const projectedTotal = total * Math.pow(targetKm / testDistance, 1.06);
      return { label, projectedTotal, targetPace: projectedTotal / targetKm };
    });
    return { total, vam, vo2, paceSeconds, fcMax, zones, tempoRuns };
  }, [testDistance, minutes, seconds, age]);

  if(sessionLocked)return <div className="session-lock" role="dialog" aria-modal="true" aria-labelledby="session-lock-title"><section><span>Z</span><small>SESSÃO PROTEGIDA</small><h1 id="session-lock-title">Tela bloqueada por inatividade</h1><p>O ZonasApp ficou 30 minutos sem uso. Confirme seu acesso para voltar a visualizar alunos e treinos.</p><button onClick={confirmAccess} disabled={unlocking}>{unlocking?"Confirmando...":"Confirmar acesso"}</button></section></div>;

  if (student) return <><aside className="coach-student-preview"><div><small>PRÉVIA DO PROFESSOR</small><b>Visualizando como aluno</b></div><label>Aluno<select value={previewAthleteName} onChange={event=>setPreviewAthleteName(event.target.value)}>{athleteRecords.map(athlete=><option key={athlete.name}>{athlete.name}</option>)}</select></label><button onClick={()=>setStudent(false)}>Voltar ao professor</button></aside><StudentView onBack={() => setStudent(false)} athleteName={previewAthleteName||athleteRecords[0]?.name||"Aluno"} /></>;

  return (
    <div className={`shell${visitando ? " com-visita" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span>Z</span><div><strong>ZONASAPP</strong><small>PLATAFORMA DE TREINO</small></div></div>
        <nav>{nav.map(item => <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}><i>{navIcon(item)}</i>{item}</button>)}
          {/* No celular a barra inferior só comporta quatro atalhos; este botão
              abre as demais seções, que de outro modo ficariam inalcançáveis. */}
          <button className="coach-nav-more" aria-expanded={mobileMenu} onClick={() => setMobileMenu(value => !value)}><i>⋯</i>Mais</button>
        </nav>
        <button className="student-switch" onClick={() => setStudent(true)}>↔ Ver como aluno</button>
        <div className="coach"><b>{coachInitials}</b><span><strong>{session.name}</strong><small>Treinador</small></span></div>
      </aside>

      {visitando && <div className="dev-visiting-banner">
        <span>Você está na área de <b>{visitando.name}</b> · {visitando.email}</span>
        {onLeaveDev && <button onClick={onLeaveDev}>Voltar ao diagnóstico</button>}
      </div>}
      {mobileMenu && <div className="coach-more-sheet" onClick={() => setMobileMenu(false)}>
        <section onClick={event => event.stopPropagation()}>
          <header><b>Outras seções</b><button aria-label="Fechar" onClick={() => setMobileMenu(false)}>×</button></header>
          {nav.slice(MOBILE_VISIBLE_NAV).map(item =>
            <button key={item} className={active === item ? "active" : ""} onClick={() => { setActive(item); setMobileMenu(false); }}>
              <i>{navIcon(item)}</i><span>{item}</span><em>›</em>
            </button>)}
          <button className="coach-more-preview" onClick={() => { setStudent(true); setMobileMenu(false); }}><i>↔</i><span>Ver como aluno</span><em>›</em></button>
          <button className="coach-more-signout" onClick={() => void signOut()}><i>⏻</i><span>Sair da conta</span><em>›</em></button>
        </section>
      </div>}

      <main className="content">
        <header className="top"><div><small>{brazilCalendar().label.toUpperCase()}</small><h1>{active === "Painel" ? `${greeting()}, ${session.name.split(" ")[0]}` : active}</h1></div><div className="top-actions">{active === "Alunos" && <button className="gold" onClick={() => setNewAthlete(true)}>+ Novo aluno</button>}<button className="coach-alert-button" onClick={()=>setActive("Painel")} aria-label="Abrir avisos do professor">🔔 <b>{painReports.length+pendingRaces.filter(race=>race.status==="Aguardando análise").length+pendingTests.filter(test=>test.status!=="Aprovado").length+pendingAccess.length}</b><span>avisos</span></button>{onLeaveDev&&<button className="coach-signout" onClick={onLeaveDev}>← Diagnóstico</button>}<button className="coach-signout" onClick={()=>void signOut()} title={session.email}>Sair</button></div></header>
        {active === "Painel" && <><MobileCoachHome go={setActive} athletes={athleteRecords} painReports={painReports} pendingRaces={pendingRaces} coachName={session.name}/><CoachNotificationCenter go={setActive} openPain={setPainCase} painReports={painReports} pendingRaces={pendingRaces} pendingTests={pendingTests} pendingAccess={pendingAccess}/><Dashboard go={setActive} openPain={setPainCase} chooseDistance={(d) => { setDistanceFilter(d); setActive("Alunos"); }} athletes={athleteRecords} painReports={painReports} pendingRaces={pendingRaces} pendingTests={pendingTests}/><PendingTestShortcut tests={pendingTests} open={()=>setActive("Testes e zonas")}/><WorkoutAccuracy/><TrainingFeedbacks/></>}
        {active === "Cadastros" && <><InviteLink/><AccessRequests onApproved={()=>{setPendingAccess(current=>current.slice(1));fetch("/api/athletes").then(r=>r.ok?r.json():{athletes:[]}).then(data=>{const saved=(data.athletes||[]).map((a:any)=>({name:a.name,initials:a.initials,distance:a.distance,plan:a.saved_plan||defaultPlanForDistance(a.distance),phase:a.planning_phase||a.phase,week:a.planning_week_number?`${a.planning_week_number} de ${a.planning_total_weeks}`:a.week,next:a.next_workout,flag:a.status||undefined}));setAthleteRecords(current=>[...saved,...current.filter(a=>!saved.some((s:Athlete)=>s.name===a.name))])})}}/></>} 
        {active === "Alunos" && <Athletes filtered={filtered} allAthletes={athleteRecords} distance={distanceFilter} phase={phaseFilter} plan={planFilter} setDistance={setDistanceFilter} setPhase={setPhaseFilter} setPlan={setPlanFilter} openProfile={setSelectedAthlete} situation={situationFilter} setSituation={setSituationFilter} counts={athleteCounts} onArchiveChange={()=>refreshAthleteRecords()} />}
        {active === "Testes e zonas" && <PendingTestCenter athletes={athleteRecords} openCalendar={(name)=>{sessionStorage.setItem("zonasapp:calendar-athlete",name);setActive("Calendário")}} />}
        {active === "Testes e zonas" && <TestCalculator athletes={athleteRecords} testDistance={testDistance} setTestDistance={setTestDistance} minutes={minutes} setMinutes={setMinutes} seconds={seconds} setSeconds={setSeconds} age={age} setAge={setAge} calc={calc} />}
        {active === "Calendário" && <Calendar />}
        {active === "Planilhas" && <PlanLibrary open={setSelectedTemplate} />}
        {active === "Provas" && <Races races={pendingRaces} onChange={setPendingRaces} />}
        {active === "Financeiro" && <><FinancialQuickSetup/><FinancialCenter /></>}
        {active === "Integrações" && <CoachIntegrations />}
        {active === "Contas" && <AccountsCenter athletes={athleteRecords} />}
        {active === "Segurança" && <><SecurityCenter /><ErrorMonitor /></>}
      </main>
      {selectedAthlete && <AthleteProfile athlete={selectedAthlete} close={() => setSelectedAthlete(null)} onOpenPain={id => setPainCase({ id, athleteName: selectedAthlete.name })} />}
      {painCase && <PainCaseScreen reportId={painCase.id} athleteName={painCase.athleteName} close={() => { setPainCase(null); window.dispatchEvent(new Event("zonasapp:athletes-refresh")); }} />}
      {newAthlete && <NewAthlete close={() => setNewAthlete(false)} save={async (athlete, details) => { const response = await fetch("/api/athletes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...athlete, nextWorkout: athlete.next, status: athlete.flag, ...details }) }); if (!response.ok) throw new Error("save_failed");const totalWeeks=Number(athlete.week.match(/de (\d+)/)?.[1]||12);const planning=await fetch("/api/athlete-planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:athlete.name,plan:athletePlan(athlete),phase:athlete.phase,weekNumber:1,totalWeeks})});if(!planning.ok)throw new Error("planning_failed"); setAthleteRecords(current => [athlete, ...current]); setNewAthlete(false); }} />}
      {selectedTemplate && <PlanDetails plan={selectedTemplate} close={()=>setSelectedTemplate(null)} />}
    </div>
  );
}

function FinancialQuickSetup(){
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7));const [pixKey,setPixKey]=useState("");const [pixName,setPixName]=useState("");const [amount,setAmount]=useState("110,00");const [dueDay,setDueDay]=useState(15);const [configured,setConfigured]=useState(false);const [state,setState]=useState("");
  const money=(value:string)=>Number(value.replace(/R\$|\s/g,"").replace(/\./g,"").replace(",","."));
  useEffect(()=>{fetch(`/api/financial?month=${month}`).then(response=>response.ok?response.json():Promise.reject()).then(data=>{if(data.settings){setPixKey(data.settings.pix_key||"");setPixName(data.settings.pix_name||"");setAmount((Number(data.settings.default_amount_cents||11000)/100).toLocaleString("pt-BR",{minimumFractionDigits:2}));setDueDay(Number(data.settings.due_day)||15);setConfigured(true)}}).catch(()=>setState("error"))},[month]);
  const save=async()=>{const value=money(amount);if(!Number.isFinite(value)||value<=0){setState("invalid");return}setState("saving");try{await api.post("/api/financial",{action:"save_settings",pixKey,pixName,defaultAmount:value,dueDay});setConfigured(true);setState("saved")}catch{setState("error")}};
  const generate=async()=>{if(!configured)return;setState("generating");try{await api.post("/api/financial",{action:"generate_month",referenceMonth:month});setState("generated");window.location.reload()}catch{setState("error")}};
  return <section className="financial-quick-setup"><header><div><span className="overline">PASSO A PASSO FINANCEIRO</span><h2>Prepare as cobranças do mês</h2><p>Defina o padrão, salve e gere. Valores individuais existentes não serão substituídos.</p></div><label>Mês<input type="month" value={month} onChange={event=>setMonth(event.target.value)}/></label></header><div><label>Valor padrão (R$)<input inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value.replace(/[^0-9.,]/g,""))}/></label><label>Vencimento<input type="number" min="1" max="28" value={dueDay} onChange={event=>setDueDay(Math.min(28,Math.max(1,Number(event.target.value)||1)))}/></label><label>Chave Pix<input value={pixKey} onChange={event=>setPixKey(event.target.value)}/></label><label>Recebedor<input value={pixName} onChange={event=>setPixName(event.target.value)}/></label></div><footer><button className="outline" disabled={state==="saving"} onClick={save}>{state==="saving"?"Salvando…":"1. Salvar padrão"}</button><button className="gold" disabled={!configured||state==="generating"} onClick={generate}>{state==="generating"?"Gerando…":"2. Gerar cobranças do mês"}</button></footer>{state==="saved"&&<p className="request-success">Padrão salvo. Agora gere as cobranças do mês →</p>}{state==="invalid"&&<p className="registration-error">Digite um valor válido, por exemplo 110,00.</p>}{state==="error"&&<p className="registration-error">Não foi possível concluir agora.</p>}</section>;
}

function FinancialCenter(){
  type Row={athlete_name:string;reference_month?:string;amount_cents?:number;due_date?:string;status?:string};type Draft={amount:string;dueDate:string};
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [paymentFilter,setPaymentFilter]=useState<"Todos"|"Vencidos"|"Pendentes"|"Pagos"|"Sem cobrança">("Todos");
  const shiftMonth=(delta:number)=>{const [year,value]=month.split("-").map(Number);const date=new Date(year,value-1+delta,1);setMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`)};
  const parseMoney=(value:string)=>{const clean=value.replace(/R\$|\s/g,"");const normalized=clean.includes(",")?clean.replace(/\./g,"").replace(",","."):clean;return Number(normalized)};
  const formatMoneyInput=(value:number)=>value.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const [data,setData]=useState<any>({settings:null,payments:[]});const [pixKey,setPixKey]=useState("");const [pixName,setPixName]=useState("");const [defaultAmount,setDefaultAmount]=useState("110,00");const [dueDay,setDueDay]=useState(15);const [drafts,setDrafts]=useState<Record<string,Draft>>({});const [state,setState]=useState("");const [savingAthlete,setSavingAthlete]=useState("");const [deleteAthlete,setDeleteAthlete]=useState("");
  const load=()=>fetch(`/api/financial?month=${month}`).then(r=>r.ok?r.json():Promise.reject()).then(value=>{setData({...value,payments:(value.payments||[]).map((row:Row)=>({...row,amount_cents:(row.amount_cents||0)/100}))});if(value.settings){setPixKey(value.settings.pix_key||"");setPixName(value.settings.pix_name||"");setDefaultAmount(formatMoneyInput(Number(value.settings.default_amount_cents||11000)/100));setDueDay(Number(value.settings.due_day)||15)}setDrafts(Object.fromEntries((value.payments||[]).map((row:Row)=>[row.athlete_name,{amount:row.amount_cents?formatMoneyInput(row.amount_cents/100):"",dueDate:row.due_date||`${month}-${String(value.settings?.due_day||15).padStart(2,"0")}`}])));setState("")}).catch(()=>setState("error"));useEffect(()=>{load()},[month]);
  const saveSettings=async()=>{const amount=parseMoney(defaultAmount);if(!Number.isFinite(amount)||amount<=0){setState("invalid-money");return}setState("saving");try{const r=await fetch("/api/financial",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save_settings",pixKey,pixName,defaultAmount:amount,dueDay})});if(!r.ok)throw new Error();await load();setState("saved")}catch{setState("error")}};
  const generateMonth=async()=>{if(!data.settings)return;setState("generating");try{await api.post("/api/financial",{action:"generate_month",referenceMonth:month});await load();setState("month-generated")}catch{setState("error")}};
  const savePayment=async(row:Row,status=row.status||"Pendente")=>{const draft=drafts[row.athlete_name];const amount=parseMoney(draft?.amount||"");if(!Number.isFinite(amount)||amount<=0||!draft?.dueDate){setState("invalid-money");return}setSavingAthlete(row.athlete_name);setState("");try{await api.post("/api/financial",{action:"update_payment",athleteName:row.athlete_name,referenceMonth:month,amount,dueDate:draft.dueDate,status});await load();setState("payment-saved")}catch{setState("error")}finally{setSavingAthlete("")}};
  const removePayment=async(row:Row)=>{setSavingAthlete(row.athlete_name);setState("");try{await api.post("/api/financial",{action:"delete_payment",athleteName:row.athlete_name,referenceMonth:month});setDeleteAthlete("");await load();setState("payment-deleted")}catch{setState("error")}finally{setSavingAthlete("")}};
  const rows=data.payments as Row[];const todayKey=new Date().toISOString().slice(0,10);const paymentTiming=(row:Row)=>{if(row.status!=="Pendente"||!row.due_date)return row.status||"Sem cobrança";if(row.due_date<todayKey)return "Vencido";const days=Math.ceil((new Date(`${row.due_date}T12:00:00`).getTime()-new Date(`${todayKey}T12:00:00`).getTime())/86400000);return days<=5?"Vence em breve":"Pendente"};const pending=rows.filter(row=>row.status==="Pendente");const overdue=pending.filter(row=>paymentTiming(row)==="Vencido");const paid=rows.filter(row=>row.status==="Pago");const noCharge=rows.filter(row=>!row.status);const visibleRows=paymentFilter==="Vencidos"?overdue:paymentFilter==="Pendentes"?pending:paymentFilter==="Pagos"?paid:paymentFilter==="Sem cobrança"?noCharge:rows;const monthLabel=new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});const monthControls=<section className="financial-month-controls"><button onClick={()=>shiftMonth(-1)}>← Mês anterior</button><label>Mês das cobranças<input type="month" value={month} onChange={event=>setMonth(event.target.value)}/><b>{monthLabel}</b></label><button onClick={()=>shiftMonth(1)}>Próximo mês →</button><div>{(["Todos","Vencidos","Pendentes","Pagos","Sem cobrança"] as const).map(filter=><button key={filter} className={paymentFilter===filter?"selected":""} onClick={()=>setPaymentFilter(filter)}>{filter}</button>)}</div></section>;return <>{monthControls}<section className="financial-summary"><article className="urgent"><small>VENCIDOS</small><b>{overdue.length}</b><span>{overdue.reduce((sum,row)=>sum+(row.amount_cents||0),0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</span></article><article><small>PENDENTES</small><b>{pending.length}</b><span>{pending.reduce((sum,row)=>sum+(row.amount_cents||0),0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</span></article><article><small>PAGOS</small><b>{paid.length}</b><span>{paid.reduce((sum,row)=>sum+(row.amount_cents||0),0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</span></article><article><small>MÊS</small><b>{month.split("-").reverse().join("/")}</b><span>Valores individuais por aluno</span></article></section><section className="financial-settings"><header><div><span className="overline">DADOS PARA PAGAMENTO</span><h2>Chave Pix</h2><p>A chave aparece apenas para o aluno que possui uma pendência lançada.</p></div><button className="gold" onClick={saveSettings} disabled={state==="saving"}>Salvar Pix</button></header><div><label>Chave Pix<input value={pixKey} onChange={event=>setPixKey(event.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória"/></label><label>Nome do recebedor<input value={pixName} onChange={event=>setPixName(event.target.value)} placeholder="Nome que aparecerá ao aluno"/></label></div>{state==="saved"&&<p className="request-success">Dados do Pix salvos ✓</p>}</section><section className="financial-list individual"><header><div><span className="overline">COBRANÇAS INDIVIDUAIS</span><h2>Valor e vencimento de cada aluno</h2><p>Edite em poucos passos. Vencidos e próximos do vencimento são destacados automaticamente, sem bloquear os treinos.</p></div></header>{!data.settings&&<p className="financial-warning">Salve a chave Pix antes de lançar a primeira pendência.</p>}<div>{visibleRows.map(row=>{const draft=drafts[row.athlete_name]||{amount:"",dueDate:`${month}-15`};return <article key={row.athlete_name}><b>{row.athlete_name}</b><label>Valor (R$)<input type="text" inputMode="decimal" value={draft.amount} onChange={event=>setDrafts(current=>({...current,[row.athlete_name]:{...draft,amount:event.target.value.replace(/[^0-9.,]/g,"")}}))} onBlur={()=>{const parsed=parseMoney(draft.amount);if(Number.isFinite(parsed)&&parsed>0)setDrafts(current=>({...current,[row.athlete_name]:{...draft,amount:formatMoneyInput(parsed)}}))}} placeholder="Ex.: 95,00"/></label><label>Vencimento<input type="date" value={draft.dueDate} onChange={event=>setDrafts(current=>({...current,[row.athlete_name]:{...draft,dueDate:event.target.value}}))}/></label><em className={paymentTiming(row)==="Pago"?"paid":paymentTiming(row)==="Vencido"?"overdue":paymentTiming(row)==="Vence em breve"?"due-soon":paymentTiming(row)==="Pendente"?"pending":"empty"}>{paymentTiming(row)}</em><div><button disabled={!data.settings||!draft.amount||!draft.dueDate||savingAthlete===row.athlete_name} onClick={()=>savePayment(row,row.status||"Pendente")}>{savingAthlete===row.athlete_name?"Salvando…":row.status?"Atualizar cobrança":"Lançar pendência"}</button>{row.status&&<button className="payment-status-button" onClick={()=>savePayment(row,row.status==="Pago"?"Pendente":"Pago")}>{row.status==="Pago"?"Marcar pendente":"Marcar pago"}</button>}{row.status&&<button className="payment-delete-button" onClick={()=>setDeleteAthlete(row.athlete_name)}>Remover</button>}</div>{deleteAthlete===row.athlete_name&&<aside className="payment-delete-confirm"><span>Remover a cobrança de {row.athlete_name} em {month.split("-").reverse().join("/")}?</span><button onClick={()=>setDeleteAthlete("")}>Cancelar</button><button className="danger-confirm" disabled={savingAthlete===row.athlete_name} onClick={()=>removePayment(row)}>{savingAthlete===row.athlete_name?"Removendo…":"Sim, remover"}</button></aside>}</article>})}</div>{state==="payment-saved"&&<p className="request-success">Cobrança individual atualizada ✓</p>}{state==="payment-deleted"&&<p className="request-success">Cobrança removida. O aluno não verá mais essa pendência ✓</p>}{state==="invalid-money"&&<p className="registration-error">Digite o valor em reais. Exemplo: 95,00.</p>}{state==="error"&&<p className="registration-error">Não foi possível atualizar o financeiro.</p>}</section></>;
}


/**
 * Contas de acesso. Cada aluno tem o seu próprio login: o treinador cria a
 * conta a partir do aluno já cadastrado, e o sistema devolve uma senha
 * temporária que aparece uma única vez, aqui nesta tela.
 */
function AccountsCenter({ athletes }: { athletes: Athlete[] }) {
  type Account = {
    id: string; email: string; name: string; role: "coach" | "student";
    athlete_name: string | null; status: string; must_change_password: number;
    last_login_at: number | null; created_at: number;
  };
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [form, setForm] = useState({ athleteName: "", name: "", email: "" });
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [error, setError] = useState("");

  const load = () => fetch("/api/accounts")
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(data => { setAccounts(data.accounts || []); setState("ready"); })
    .catch(() => setState("error"));
  useEffect(() => { load(); }, []);

  const linked = new Set(accounts.map(account => account.athlete_name).filter(Boolean));
  const availableAthletes = athletes.filter(athlete => !linked.has(athlete.name));

  const send = async (body: Record<string, string>) => {
    setState("saving"); setError("");
    try {
      const response = await fetch("/api/accounts", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error === "email_already_registered" ? "Este e-mail já está em uso por outra conta." : "Não foi possível concluir a ação.");
        setState("ready"); return null;
      }
      await load();
      return payload as { temporaryPassword?: string; email?: string };
    } catch { setError("Sem conexão com o servidor."); setState("ready"); return null; }
  };

  const create = async () => {
    const chosen = form.athleteName || availableAthletes[0]?.name || "";
    if (!chosen || !form.email.includes("@") || form.name.trim().length < 3) { setError("Preencha aluno, nome e e-mail."); return; }
    const result = await send({ action: "create", athleteName: chosen, name: form.name, email: form.email });
    if (result?.temporaryPassword) {
      setIssued({ email: result.email || form.email, password: result.temporaryPassword });
      setForm({ athleteName: "", name: "", email: "" });
    }
  };

  const reset = async (email: string) => {
    const result = await send({ action: "reset_password", email });
    if (result?.temporaryPassword) setIssued({ email, password: result.temporaryPassword });
  };

  return <>
    <section className="accounts-intro">
      <div>
        <span className="overline">ACESSO INDIVIDUAL</span>
        <h2>Contas dos alunos</h2>
        <p>Cada aluno entra com o próprio e-mail e senha. A senha temporária aparece uma única vez — anote e passe para o aluno.</p>
      </div>
      <div><b>{accounts.filter(account => account.role === "student").length}</b><span>alunos com acesso</span></div>
    </section>

    {issued && <div className="account-issued">
      <b>Senha temporária criada</b>
      <p>Passe para <strong>{issued.email}</strong>. Ela não será mostrada de novo e o aluno troca no primeiro acesso.</p>
      <code>{issued.password}</code>
      <div className="account-issued-actions">
        <button onClick={async () => setCopyState(await copyText(issued.password) ? "copied" : "failed")}>
          {copyState === "copied" ? "Senha copiada ✓" : "Copiar senha"}
        </button>
        <button onClick={() => { setIssued(null); setCopyState("idle"); }}>Já anotei</button>
      </div>
      {copyState === "failed" && <small className="account-issued-manual">Não foi possível copiar automaticamente. Selecione a senha acima e copie à mão.</small>}
    </div>}

    <section className="account-create">
      <header><b>Criar acesso para um aluno</b><span>{availableAthletes.length} aluno(s) ainda sem conta</span></header>
      <div className="account-create-grid">
        <label>Aluno
          <select value={form.athleteName} onChange={event => setForm({ ...form, athleteName: event.target.value })}>
            <option value="">Selecione…</option>
            {availableAthletes.map(athlete => <option key={athlete.name}>{athlete.name}</option>)}
          </select>
        </label>
        <label>Nome para o login
          <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Nome completo" />
        </label>
        <label>E-mail
          <input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="aluno@email.com" />
        </label>
      </div>
      {error && <p className="registration-error">{error}</p>}
      <button className="gold" disabled={state === "saving" || !availableAthletes.length} onClick={create}>
        {state === "saving" ? "Criando…" : "Criar acesso e gerar senha"}
      </button>
    </section>

    <section className="account-list">
      <header><span>PESSOA</span><span>E-MAIL</span><span>ALUNO VINCULADO</span><span>SITUAÇÃO</span><span>AÇÕES</span></header>
      {state === "loading" ? <div className="feedback-empty">Carregando contas…</div>
        : accounts.length === 0 ? <div className="feedback-empty">Nenhuma conta criada ainda.</div>
        : accounts.map(account => <article key={account.id}>
            <b>{account.name}{account.role === "coach" && <em> · professor</em>}</b>
            <span>{account.email}</span>
            <span>{account.athlete_name || "—"}</span>
            <em className={account.status === "Ativo" ? "synced" : account.status === "Bloqueado" ? "off" : "waiting"}>
              {account.status}{Number(account.must_change_password) === 1 && " · senha temporária"}
            </em>
            <div className="account-actions">
              {account.role === "student" && <>
                <button onClick={() => reset(account.email)}>Redefinir senha</button>
                <button onClick={() => send({ action: account.status === "Bloqueado" ? "unblock" : "block", email: account.email })}>
                  {account.status === "Bloqueado" ? "Desbloquear" : "Bloquear"}
                </button>
              </>}
            </div>
          </article>)}
    </section>
  </>;
}


/**
 * Acompanhamento de uma lesão.
 *
 * Uma queixa não é um assunto solto: ela pertence a um atleta e só faz sentido
 * ao lado da ficha dele. Por isso não há seção própria — a tela abre a partir
 * do aviso no painel ou de dentro do aluno, e some quando o caso é encerrado,
 * ficando no histórico dele.
 */
function PainCaseScreen({ reportId, athleteName, close }: { reportId: string; athleteName: string; close: () => void }) {
  type Relato = {
    id: string; athlete_name: string; body_area: string; intensity: number;
    training_impact: string; note?: string; status: string; created_at: number;
    coach_note?: string; resolution?: string; linked_week_start?: string;
    contacted_at?: number; reviewed_at?: number; resolved_at?: number;
  };
  type Movimento = { id: string; actor_email: string; action: string; note?: string; created_at: number };

  const SITUACOES = ["Novo", "Em análise", "Verificado", "Resolvido"] as const;

  const [caso, setCaso] = useState<Relato | null>(null);
  const [historico, setHistorico] = useState<Movimento[]>([]);
  const [semanas, setSemanas] = useState<Array<{ week_start: string; week_label: string; status: string }>>([]);
  const [relato, setRelato] = useState("");
  const [situacao, setSituacao] = useState("");
  const [semana, setSemana] = useState("");
  const [estado, setEstado] = useState<"carregando" | "pronto" | "salvando">("carregando");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = async () => {
    try {
      const [detalhe, doAluno] = await Promise.all([
        api.get<{ report: Relato; history: Movimento[] }>(`/api/pain-reports?id=${encodeURIComponent(reportId)}`),
        api.get<{ weeks: Array<{ week_start: string; week_label: string; status: string }> }>(
          `/api/training-weeks?athlete=${encodeURIComponent(athleteName)}`).catch(() => ({ weeks: [] })),
      ]);
      setCaso(detalhe.report);
      setSituacao(detalhe.report.status);
      setHistorico(detalhe.history || []);
      setSemanas(doAluno.weeks || []);
      setEstado("pronto");
    } catch (error) { setErro(describeError(error)); setEstado("pronto"); }
  };
  useEffect(() => { void carregar(); }, [reportId]);

  const mudouSituacao = Boolean(caso && situacao && situacao !== caso.status);

  const enviar = async (extra: Record<string, unknown>, mensagem: string) => {
    setEstado("salvando"); setErro("");
    try {
      await api.post("/api/pain-reports", { id: reportId, ...(relato.trim() ? { note: relato.trim() } : {}), ...extra });
      await carregar();
      setRelato(""); setAviso(mensagem);
      window.dispatchEvent(new Event("zonasapp:pain-refresh"));
    } catch (error) { setErro(describeError(error)); }
    finally { setEstado("pronto"); }
  };

  const registrar = () => {
    if (!relato.trim() && !mudouSituacao) { setErro("Escreva o que aconteceu ou mude a situação do caso."); return; }
    void enviar({ action: "update", status: situacao || caso?.status }, "Registrado.");
  };

  const quando = (ms?: number) => ms ? new Date(Number(ms)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
  const soData = (ms?: number) => ms ? new Date(Number(ms)).toLocaleDateString("pt-BR") : "";
  const classeSituacao = (s: string) => s === "Resolvido" ? "ok" : s === "Verificado" ? "review" : s === "Em análise" ? "analise" : "pending";

  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}>
    <aside className="drawer pain-screen">
      <header>
        <div>
          <span className="overline">ACOMPANHAMENTO DE LESÃO</span>
          <h2>{caso ? `${caso.athlete_name} · ${caso.body_area}` : "Carregando…"}</h2>
          {caso && <p>{caso.training_impact} · intensidade {caso.intensity}/10 · relatado em {quando(caso.created_at)}</p>}
        </div>
        <button onClick={close}>×</button>
      </header>

      {estado === "carregando" ? <p className="pain-dash-empty">Carregando o caso…</p> : !caso ? <p className="registration-error">{erro || "Caso não encontrado."}</p> : <>
        {caso.note && <p className="pain-case-quote">“{caso.note}”</p>}

        <div className="pain-dash-facts">
          <span><small>CONVERSA</small>{caso.contacted_at ? soData(caso.contacted_at) : "ainda não"}</span>
          <span><small>AVALIAÇÃO</small>{caso.coach_note || "ainda não"}</span>
          <span><small>PLANILHA</small>{caso.linked_week_start ? `semana de ${caso.linked_week_start}` : "sem ajuste"}</span>
          <span><small>DESFECHO</small>{caso.resolution || "em aberto"}</span>
        </div>

        <div className="pain-dash-work">
          <label className="pain-dash-status">
            Situação do caso
            <div>
              {SITUACOES.map(s => (
                <button key={s} className={`${situacao === s ? "selected" : ""} ${classeSituacao(s)}`}
                  onClick={() => { setSituacao(s); setAviso(""); setErro(""); }}>{s}</button>
              ))}
            </div>
          </label>

          <label>
            O que aconteceu?
            <textarea value={relato} onChange={e => { setRelato(e.target.value); setErro(""); setAviso(""); }} maxLength={1000}
              placeholder="Ex.: conversei com ela, a dor aparece após 20 min e melhora com gelo. Reduzi o volume desta semana." />
          </label>

          {erro && <p className="registration-error">{erro}</p>}
          {aviso && <p className="pain-ok">{aviso}</p>}

          <div className="pain-dash-actions">
            <button className="gold" disabled={estado === "salvando"} onClick={registrar}>
              {estado === "salvando" ? "Salvando…" : mudouSituacao ? `Salvar como “${situacao}”` : "Salvar registro"}
            </button>
            <button disabled={estado === "salvando"} onClick={() => void enviar({ action: "contact" }, "Conversa registrada.")}>
              Marcar que falei com o atleta
            </button>
            <a className="pain-contact" href={`https://wa.me/?text=${encodeURIComponent(`Olá ${caso.athlete_name.split(" ")[0]}, vi seu relato de dor em ${caso.body_area}. Como você está?`)}`} target="_blank" rel="noreferrer">WhatsApp ↗</a>
          </div>

          <details className="pain-dash-week">
            <summary>Vincular a um ajuste na planilha</summary>
            {semanas.length === 0
              ? <p className="pain-sem-semana">Este aluno ainda não tem semana montada.</p>
              : <div>
                  <select value={semana} onChange={e => { setSemana(e.target.value); setErro(""); }}>
                    <option value="">Escolha a semana ajustada…</option>
                    {semanas.map(w => <option key={w.week_start} value={w.week_start}>
                      {new Date(`${w.week_start}T12:00:00Z`).toLocaleDateString("pt-BR")} · {w.week_label} · {w.status}
                    </option>)}
                  </select>
                  <button disabled={estado === "salvando" || !semana}
                    onClick={() => semana ? void enviar({ action: "link_week", weekStart: semana }, "Ajuste vinculado.") : setErro("Escolha a semana que você ajustou.")}>
                    Vincular
                  </button>
                </div>}
          </details>
        </div>

        {historico.length > 0 && <div className="pain-dash-history">
          <span className="overline">HISTÓRICO DO CASO</span>
          {historico.map(h => <article key={h.id}>
            <b>{h.action}</b>
            <small>{quando(h.created_at)} · {h.actor_email}</small>
            {h.note && <p>{h.note}</p>}
          </article>)}
        </div>}
      </>}
    </aside>
  </div>;
}

/**
 * Lesões de um atleta, dentro da ficha dele.
 *
 * Em aberto aparecem em destaque, porque mudam a decisão do treino da semana.
 * As encerradas ficam recolhidas: viram histórico, não pendência.
 */
function AthletePainList({ athleteName, onOpen }: { athleteName: string; onOpen: (id: string) => void }) {
  type Relato = { id: string; body_area: string; intensity: number; status: string; created_at: number; resolution?: string; resolved_at?: number };
  const [relatos, setRelatos] = useState<Relato[]>([]);
  const [carregado, setCarregado] = useState(false);

  const carregar = () => api.get<{ reports: Relato[] }>(`/api/pain-reports?athlete=${encodeURIComponent(athleteName)}`)
    .then(d => { setRelatos(d.reports || []); setCarregado(true); })
    .catch(() => setCarregado(true));
  useEffect(() => {
    carregar();
    const atualiza = () => carregar();
    window.addEventListener("zonasapp:pain-refresh", atualiza);
    return () => window.removeEventListener("zonasapp:pain-refresh", atualiza);
  }, [athleteName]);

  if (!carregado || relatos.length === 0) return null;

  const abertas = relatos.filter(r => r.status !== "Resolvido");
  const encerradas = relatos.filter(r => r.status === "Resolvido");
  const soData = (ms?: number) => ms ? new Date(Number(ms)).toLocaleDateString("pt-BR") : "";

  return <section className="athlete-pain">
    {abertas.length > 0 && <>
      <span className="overline">LESÃO EM ACOMPANHAMENTO</span>
      {abertas.map(r => (
        <button key={r.id} className={`athlete-pain-open ${r.intensity >= 7 ? "grave" : ""}`} onClick={() => onOpen(r.id)}>
          <span className="pain-dash-mark">{r.intensity}</span>
          <span>
            <b>{r.body_area}</b>
            <small>{r.status} · desde {soData(r.created_at)}</small>
          </span>
          <em>Registrar andamento →</em>
        </button>
      ))}
    </>}

    {encerradas.length > 0 && <details className="athlete-pain-past">
      <summary>Lesões encerradas ({encerradas.length})</summary>
      {encerradas.map(r => (
        <button key={r.id} onClick={() => onOpen(r.id)}>
          <b>{r.body_area}</b>
          <small>{soData(r.created_at)} → {soData(r.resolved_at)}</small>
          <p>{r.resolution || "Sem desfecho registrado."}</p>
        </button>
      ))}
    </details>}
  </section>;
}

function CoachIntegrations(){
  type Row={athlete_name:string;integration:string;access_status:string;connection_status:string;last_source?:string;last_import_at?:number};
  const [rows,setRows]=useState<Row[]>([]);const [filter,setFilter]=useState("Todos");const [state,setState]=useState("loading");const [readiness,setReadiness]=useState<any[]>([]);
  useEffect(()=>{Promise.all([fetch("/api/integration-overview").then(r=>r.ok?r.json():Promise.reject()),fetch("/api/integration-readiness").then(r=>r.ok?r.json():Promise.reject())]).then(([overview,setup])=>{setRows(overview.integrations||[]);setReadiness(setup.providers||[]);setState("ready")}).catch(()=>setState("error"))},[]);
  const visible=rows.filter(row=>filter==="Todos"||row.integration===filter);const waiting=rows.filter(row=>row.connection_status==="Aguardando conexão oficial").length;const synced=rows.filter(row=>row.connection_status==="Sincronizado").length;
  const siteOrigin=typeof window==="undefined"?"":window.location.origin;const applicationProfile=[{label:"Nome do aplicativo",value:"Zonas-App"},{label:"Site público",value:siteOrigin},{label:"Descrição curta",value:"Plataforma de corrida para planejamento, envio e análise individual de treinos."},{label:"Política de Privacidade",value:`${siteOrigin}/privacy`},{label:"Termos de Uso",value:`${siteOrigin}/terms`}];return <><section className="integration-application-profile"><header><div><span className="overline">CADASTRO NOS PORTAIS</span><h2>Ficha oficial da Zonas-App</h2><p>Use estes dados nos formulários Garmin e Zepp. As credenciais recebidas depois nunca devem ser coladas nesta tela.</p></div><b>PRONTA PARA COPIAR</b></header><div>{applicationProfile.map(item=><article key={item.label}><small>{item.label}</small><strong>{item.value}</strong><button onClick={()=>void copyText(item.value)}>Copiar</button></article>)}</div><footer><a href="/privacy" target="_blank">Ver Privacidade ↗</a><a href="/terms" target="_blank">Ver Termos ↗</a></footer></section><section className="provider-readiness"><header><div><span className="overline">PRIMEIRAS CONEXÕES</span><h2>Garmin e Amazfit</h2><p>Acompanhe a preparação oficial sem expor chaves ou afirmar uma conexão antes da aprovação.</p></div><b>ETAPA 1 DE 3</b></header><div>{readiness.map(provider=><article key={provider.id}><span className="provider-mark">{provider.id==="garmin"?"G":"A"}</span><div><h3>{provider.name}</h3><em className={provider.credentialsConfigured?"configured":"waiting"}>{provider.status}</em></div><ul><li className={provider.credentialsConfigured?"done":""}>Cadastro e credenciais oficiais</li><li className={provider.receiveActivities?"done":""}>Receber atividades realizadas</li><li className={provider.sendStructuredWorkouts?"done":""}>Enviar treinos estruturados</li></ul><a href={provider.id==="garmin"?"https://developer.garmin.com/gc-developer-program/overview/":"https://developer.zepp.com/"} target="_blank" rel="noreferrer">Abrir portal oficial ↗</a></article>)}</div><footer><b>Próxima ação</b><p>Cadastrar a Zonas-App nos portais oficiais. Depois, as credenciais protegidas ativarão os testes com contas reais.</p></footer></section><section className="integration-coach-summary"><article><small>ALUNOS COM PREFERÊNCIA</small><b>{rows.filter(row=>row.integration!=="Sem integração").length}</b><span>Strava, Garmin, Amazfit ou Apple</span></article><article><small>AGUARDANDO CONEXÃO</small><b>{waiting}</b><span>Dependem da API oficial</span></article><article><small>SINCRONIZADOS</small><b>{synced}</b><span>Importação automática ativa</span></article></section><section className="coach-integration-center"><header><div><span className="overline">CONTROLE DO PROFESSOR</span><h2>Integrações dos alunos</h2><p>Acompanhe a preferência escolhida e o estado real da conexão.</p></div><span className="honest-status">Sem conexão falsa: somente APIs autorizadas aparecem como sincronizadas.</span></header><div className="integration-filters">{["Todos","Strava","Garmin","Amazfit","Apple Saúde / Apple Watch","Sem integração"].map(item=><button key={item} className={filter===item?"selected":""} onClick={()=>setFilter(item)}>{item}</button>)}</div>{state==="loading"?<div className="feedback-empty">Carregando integrações…</div>:visible.length===0?<div className="feedback-empty">Nenhum aluno neste filtro.</div>:<div className="integration-table"><header><span>ALUNO</span><span>SERVIÇO</span><span>ACESSO</span><span>CONEXÃO</span><span>ÚLTIMA IMPORTAÇÃO</span></header>{visible.map(row=><article key={row.athlete_name}><b>{row.athlete_name}</b><span>{row.integration}</span><span>{row.access_status}</span><em className={row.connection_status==="Sincronizado"?"synced":row.connection_status==="Sem integração"?"off":"waiting"}>{row.connection_status}</em><span>{row.last_import_at?new Date(Number(row.last_import_at)).toLocaleString("pt-BR"):"Ainda não ocorreu"}</span></article>)}</div>}{state==="error"&&<p className="registration-error">Não foi possível carregar o controle de integrações.</p>}<footer><b>Integrações prioritárias: Garmin e Amazfit</b><p>A Garmin será preparada para receber atividades e enviar treinos estruturados. A Amazfit seguirá o fluxo permitido pelo Zepp OS e pelos modelos compatíveis.</p></footer></section></>;
}

function SecurityCenter() {
  type Backup = {id:string;label:string;record_count:number;created_by:string;created_at:number;restored_at?:number|null};
  type SecurityEvent = {id:string;actor_email:string;event_type:string;route:string;details:string;created_at:number};
  const [backups,setBackups]=useState<Backup[]>([]);
  const [events,setEvents]=useState<SecurityEvent[]>([]);
  const [state,setState]=useState<"idle"|"saving"|"restoring"|"done"|"error">("idle");
  const [confirmRestore,setConfirmRestore]=useState("");
  const load=()=>fetch("/api/backups").then(r=>r.ok?r.json():Promise.reject()).then(data=>setBackups(data.backups||[])).catch(()=>setState("error"));
  const loadEvents=()=>fetch("/api/security-events").then(r=>r.ok?r.json():Promise.reject()).then(data=>setEvents(data.events||[])).catch(()=>setState("error"));
  useEffect(()=>{load();loadEvents()},[]);
  const createBackup=async()=>{setState("saving");try{await api.post("/api/backups",{label:"Backup manual do treinador"});await load();setState("done")}catch{setState("error")}};
  const downloadBackup=(id:string)=>{const link=document.createElement("a");link.href=`/api/backups?download=${encodeURIComponent(id)}`;link.download="zonasapp-backup.json";document.body.appendChild(link);link.click();link.remove()};
  const restore=async(id:string)=>{if(confirmRestore!==id){setConfirmRestore(id);return}setState("restoring");try{await api.post("/api/backups",{action:"restore",id});setConfirmRestore("");await load();setState("done")}catch{setState("error")}};
  const latestBackup=backups[0];const backupAgeDays=latestBackup?Math.floor((Date.now()-Number(latestBackup.created_at))/86400000):null;const backupHealth=backupAgeDays===null?"Nenhum backup criado":backupAgeDays===0?"Proteção atualizada hoje":backupAgeDays===1?"Última cópia há 1 dia":`Última cópia há ${backupAgeDays} dias`;
  return <section className="security-center">
    <div className="security-summary"><div><span className="overline">PROTEÇÃO DOS DADOS</span><h2>Backup e recuperação</h2><p>Salve uma cópia de alunos, semanas, treinos, provas, recordes e relatos. Baixe uma cópia externa ou volte para um ponto anterior com confirmação dupla.</p><strong className={backupAgeDays===null||backupAgeDays>7?"backup-health warning":"backup-health"}>{backupHealth}</strong></div><button className="gold" disabled={state==="saving"||state==="restoring"} onClick={createBackup}>{state==="saving"?"Criando cópia...":"Criar backup agora"}</button></div>
    <div className="security-cards">
      <article><b>✓</b><span><strong>Dados persistentes</strong><small>As informações continuam salvas após fechar ou atualizar a plataforma.</small></span></article>
      <article><b>↶</b><span><strong>Restauração protegida</strong><small>Uma nova cópia automática é criada antes de qualquer restauração.</small></span></article>
      <article><b>⏱</b><span><strong>Proteção contra excesso</strong><small>Ações repetidas são bloqueadas temporariamente e registradas sem guardar senha ou IP.</small></span></article>
      <article><b>◷</b><span><strong>Bloqueio por inatividade</strong><small>A tela é protegida após 30 minutos sem uso e exige nova confirmação de acesso.</small></span></article>
    </div>
    {state==="done"&&<p className="backup-status success">Operação concluída com segurança ✓</p>}{state==="error"&&<p className="backup-status error">Não foi possível concluir agora. Nenhum dado foi alterado.</p>}
    <div className="backup-list"><header><div><span className="overline">CÓPIAS DISPONÍVEIS</span><h3>Histórico de backups</h3></div><span>{backups.length} cópias</span></header>{backups.length===0?<div className="backup-empty">Ainda não há cópias. Crie o primeiro backup antes de começar a usar dados reais.</div>:backups.map(backup=><article key={backup.id}><div><b>{backup.label}</b><small>{new Date(Number(backup.created_at)).toLocaleString("pt-BR")} · {backup.record_count} registros</small>{backup.restored_at?<em>Restaurado em {new Date(Number(backup.restored_at)).toLocaleString("pt-BR")}</em>:null}</div><aside className="backup-actions"><button onClick={()=>downloadBackup(backup.id)}>Baixar cópia</button><button className={confirmRestore===backup.id?"confirm-restore":""} disabled={state==="restoring"} onClick={()=>restore(backup.id)}>{state==="restoring"&&confirmRestore===backup.id?"Restaurando...":confirmRestore===backup.id?"Confirmar restauração":"Restaurar esta cópia"}</button></aside></article>)}</div>
    <div className="security-events"><header><div><span className="overline">ATIVIDADE DE SEGURANÇA</span><h3>Bloqueios recentes</h3></div><span>{events.length} registros</span></header>{events.length===0?<div className="backup-empty">Nenhum bloqueio por excesso foi registrado.</div>:events.map(event=><article key={event.id}><b>Proteção ativada</b><span>{new Date(Number(event.created_at)).toLocaleString("pt-BR")} · {event.actor_email}</span><small>{event.route} · ação temporariamente bloqueada</small></article>)}</div>
    <div className="recovery-note"><b>Importante</b><span>A restauração exige dois cliques e não exclui a cópia escolhida. O ZonasApp também cria uma cópia automática do estado atual antes de voltar no tempo.</span></div>
  </section>;
}

function ErrorMonitor() {
  type AppError = {id:string;area:string;error_code:string;method:string;status_code:number;created_at:number};
  const [errors,setErrors]=useState<AppError[]>([]);
  const [last24Hours,setLast24Hours]=useState(0);
  const [retentionDays,setRetentionDays]=useState(90);
  const [available,setAvailable]=useState(true);
  useEffect(()=>{fetch("/api/application-errors").then(r=>r.ok?r.json():Promise.reject()).then(data=>{setErrors(data.errors||[]);setLast24Hours(Number(data.last24Hours)||0);setRetentionDays(Number(data.retentionDays)||90)}).catch(()=>setAvailable(false))},[]);
  return <section className="error-monitor"><header><div><span className="overline">MONITORAMENTO DA PLATAFORMA</span><h3>Saúde do ZonasApp</h3><p>Registra apenas a área e o tipo da falha. Nenhum dado pessoal, treino, senha ou e-mail de aluno entra neste histórico. Registros técnicos são apagados automaticamente após {retentionDays} dias.</p></div><span className={available&&last24Hours===0?"healthy":"attention"}>{!available?"INDISPONÍVEL":last24Hours===0?"TUDO NORMAL":`${last24Hours} FALHAS EM 24H`}</span></header>{!available?<div className="backup-empty">Não foi possível consultar o monitoramento agora.</div>:errors.length===0?<div className="monitor-empty"><b>✓</b><span><strong>Nenhuma falha registrada</strong><small>A plataforma está operando normalmente.</small></span></div>:<div className="monitor-list">{errors.map(error=><article key={error.id}><b>{error.area}</b><span>{error.error_code.replaceAll("_"," ")}</span><small>{error.method} · {new Date(Number(error.created_at)).toLocaleString("pt-BR")}</small></article>)}</div>}</section>;
}

function PlanLibrary({open}:{open:(plan:TrainingPlan)=>void}) {
  return <><div className="library-intro"><div><span className="overline">BIBLIOTECA DE TREINAMENTO</span><h2>Suas planilhas-base</h2><p>Escolha uma estrutura, veja as semanas e depois aplique ao aluno. Os ritmos e a frequência cardíaca continuam individuais.</p></div><div><b>{trainingPlans.filter(plan=>plan.complete).length}/{trainingPlans.length}</b><span>planilhas completas</span></div></div><section className="plan-library">{trainingPlans.map((plan,index)=><button key={plan.name} className={plan.pending?"pending-plan":""} onClick={()=>open(plan)}><header><i>{String(index+1).padStart(2,"0")}</i><span>{plan.complete?"TREINOS COMPLETOS":plan.pending?"ATUALIZAÇÃO PENDENTE":"ESTRUTURA CADASTRADA"}</span></header><h3>{plan.name}</h3><p>{plan.goal}</p><div className="plan-meta"><span><b>{plan.weeks}</b> semanas</span><span>{plan.frequency}</span></div><div className="phase-strip">{plan.phases.map(phase=><small key={phase}>{phase}</small>)}</div><footer>{plan.complete?"Ver e aplicar treinos reais →":plan.pending?"Abrir para atualizar →":"Ver estrutura →"}</footer></button>)}</section></>;
}

function PlanDetails({plan,close}:{plan:TrainingPlan;close:()=>void}) {
  const [week,setWeek]=useState(1);
  const [eligibleAthletes,setEligibleAthletes]=useState<any[]>([]);
  const [targetAthlete,setTargetAthlete]=useState("");
  const [applyState,setApplyState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const [editingTemplateIndex,setEditingTemplateIndex]=useState<number|null>(null);
  const [templateEdits,setTemplateEdits]=useState<Record<number,StructuredSession[]>>({});
  const [targetWeekStart,setTargetWeekStart]=useState(()=>shiftIsoDate(mondayOf(new Date().toISOString().slice(0,10)),7));
  const allDays=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
  const [availableDays,setAvailableDays]=useState(plan.frequency.includes("6x")?["Seg","Ter","Qua","Qui","Sex","Sáb"]:plan.frequency.includes("4")?["Seg","Qua","Sex","Dom"]:["Ter","Qui","Sáb"]);
  const toggleDay=(day:string)=>setAvailableDays(current=>current.includes(day)?current.filter(d=>d!==day):allDays.filter(d=>current.includes(d)||d===day));
  const phaseFor=(n:number)=>plan.phases[Math.min(plan.phases.length-1,Math.floor((n-1)/(plan.weeks/plan.phases.length)))];
  const planningPhaseFor=(n:number)=>{const value=phaseFor(n);if(value.includes("Adaptação"))return"Adaptação";if(value.includes("Base"))return"Base";if(value.includes("Pré")||value.includes("Polimento")||value.includes("Desafio"))return"Pré-prova";if(value.includes("Específica")||value.includes("Ritmo específico"))return"Específica";return"Desenvolvimento"};
  const samples = plan.name === "Iniciantes" ? ["Caminhada + corrida","Corrida leve","Mobilidade"] : plan.name.includes("Meia") ? ["Rodagem Z2","Tempo Run","Leve Z1","Longão progressivo"] : ["Leve Z1","Intervalado","Tempo Run","Longão"];
  const sampleDays = plan.name === "Meia Finish" ? ["SEG","TER","QUI","SÁB"] : ["SEG","QUA","SEX","SÁB"];
  const weekSamples = week === plan.weeks ? (plan.name === "Iniciantes" ? ["Leve","Mobilidade","Desafio 5 km"] : ["Leve Z1","8 × 100 m","Leve curto","Prova-alvo"]) : samples;
  const realTemplate=planWeekTemplates[plan.name]?.[week]||null;
  const effectiveTemplate=templateEdits[week]||realTemplate;
  const selectedDays=allDays.filter(day=>availableDays.includes(day)).slice(0,effectiveTemplate?.length||4);
  const templatePriority=(session:StructuredSession)=>{const text=`${session.type} ${session.title||""}`.toLowerCase();if(/prova|desafio|longão/.test(text))return 100;if(/tempo|limiar|específico|intervalado|fartlek|vo₂|ritmo|ativação/.test(text))return 80;if(/rodagem|aeróbia|contínua/.test(text))return 40;return 20};
  const adaptedTemplate=effectiveTemplate?effectiveTemplate.map((session,index)=>({session,index})).sort((a,b)=>templatePriority(b.session)-templatePriority(a.session)).slice(0,selectedDays.length).sort((a,b)=>a.index-b.index).map(item=>item.session):[];
  const prioritySessions=selectedDays.length>=4?["Leve Z1","Ritmo/intervalado","Tempo Run","Longão"]:selectedDays.length===3?["Ritmo/intervalado","Tempo Run","Longão"]:selectedDays.length===2?["Treino de qualidade","Longão"]:["Longão"];
  useEffect(()=>{fetch("/api/athletes").then(response=>response.ok?response.json():{athletes:[]}).then(data=>{const rows=(data.athletes||[]).filter((athlete:any)=>athlete.access_status!=="Bloqueado");setEligibleAthletes(rows);setTargetAthlete(rows[0]?.name||"")}).catch(()=>setEligibleAthletes([]))},[]);
  useEffect(()=>{const athlete=eligibleAthletes.find(item=>item.name===targetAthlete);if(!athlete)return;try{const names:Record<string,string>={SEG:"Seg",TER:"Ter",QUA:"Qua",QUI:"Qui",SEX:"Sex",SÁB:"Sáb",SAB:"Sáb",DOM:"Dom"};const saved=JSON.parse(athlete.training_days||"[]").map((day:string)=>names[String(day).trim().toUpperCase()]||day).filter((day:string)=>allDays.includes(day));if(saved.length)setAvailableDays(saved)}catch{}},[targetAthlete,eligibleAthletes]);
  useEffect(()=>{let active=true;fetch(`/api/plan-template-overrides?plan=${encodeURIComponent(plan.name)}&week=${week}`).then(response=>response.ok?response.json():Promise.reject()).then(data=>{if(active&&data.override?.sessions)setTemplateEdits(current=>({...current,[week]:data.override.sessions}))}).catch(()=>{});return()=>{active=false}},[plan.name,week]);
  const saveTemplateEdit=async(session:StructuredSession)=>{if(editingTemplateIndex===null||!effectiveTemplate)return;const updated=effectiveTemplate.map((item,index)=>index===editingTemplateIndex?session:item);setTemplateEdits(current=>({...current,[week]:updated}));setEditingTemplateIndex(null);setApplyState("idle");if(!window.confirm(`Salvar esta alteração permanentemente na semana ${week} da planilha ${plan.name}?\n\nEla será usada nos próximos rascunhos. Semanas já liberadas não serão modificadas.`))return;try{await api.post("/api/plan-template-overrides",{plan:plan.name,weekNumber:week,sessions:updated});window.alert("Alteração salva na planilha-base. Ela será usada nos próximos rascunhos e aplicações.")}catch{window.alert("Não foi possível salvar a alteração na planilha-base. Tente novamente.")}};
  const applyPlan=async()=>{if(!targetAthlete||plan.pending)return;setApplyState("saving");try{await api.post("/api/athlete-planning",{athleteName:targetAthlete,plan:plan.name,phase:planningPhaseFor(week),weekNumber:week,totalWeeks:plan.weeks});if(effectiveTemplate){const chosenDays=selectedDays.slice(0,adaptedTemplate.length).map(day=>day.toUpperCase());const sessions=Object.fromEntries(chosenDays.map((day,index)=>[day,adaptedTemplate[index]]));const draft=await fetch("/api/training-weeks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:targetAthlete,weekStart:targetWeekStart,plan:plan.name,phase:planningPhaseFor(week),weekLabel:`${week} de ${plan.weeks}`,trainingDays:chosenDays,sessions,status:"Rascunho"})});if(!draft.ok)throw new Error()}setApplyState("saved")}catch{setApplyState("error")}};
  return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><aside className="drawer plan-details"><header><div><span className="overline">PLANILHA-BASE · {plan.distance}</span><h2>{plan.name}</h2><p>{plan.weeks} semanas · {plan.frequency} · {plan.goal}</p></div><button onClick={close}>×</button></header>{plan.pending&&<div className="profile-alert">Esta planilha está registrada, mas precisa ser atualizada antes de ser aplicada aos alunos.</div>}{plan.complete&&<div className="request-success">Treinos reais cadastrados em todas as semanas ✓</div>}<div className="plan-phase-summary">{plan.phases.map((phase,i)=><span key={phase}><b>{i+1}</b><small>{phase}</small></span>)}</div><section className="schedule-adapter"><div className="profile-title"><div><span className="overline">APLICAR AO ALUNO</span><h3>Aluno e dias disponíveis</h3></div><small>{availableDays.length} dias selecionados</small></div><label className="template-athlete-select">Aluno<select value={targetAthlete} onChange={event=>{setTargetAthlete(event.target.value);setApplyState("idle")}}><option value="">Selecione</option>{eligibleAthletes.map(athlete=><option key={athlete.name}>{athlete.name}</option>)}</select></label><label className="template-week-date">Semana no calendário<input type="date" value={targetWeekStart} onChange={event=>{if(event.target.value)setTargetWeekStart(mondayOf(event.target.value));setApplyState("idle")}}/><small>O rascunho será criado de {weekDateLabel(targetWeekStart)}.</small></label><p>Marque os dias reais do aluno. O ZonasApp distribui os treinos da semana nesses dias e cria um rascunho para sua revisão.</p><div className="availability-picker">{allDays.map(day=><button key={day} className={availableDays.includes(day)?"selected":""} onClick={()=>toggleDay(day)}>{day}</button>)}</div><div className="adapted-schedule">{selectedDays.map((day,i)=><article key={day}><b>{day.toUpperCase()}</b><span><strong>{adaptedTemplate[i]?.title||prioritySessions[i]}</strong><small>{realTemplate?"Treino adaptado da semana · revisar antes de liberar":prioritySessions[i]==="Longão"?"Prioridade alta · resistência":"Estrutura-base"}</small></span></article>)}</div></section><section><div className="profile-title"><h3>Escolha uma semana</h3><small>{effectiveTemplate?"Clique no treino para ver e editar":"Visualização da estrutura"}</small></div><div className="template-weeks">{Array.from({length:plan.weeks},(_,i)=>i+1).map(n=><button key={n} className={week===n?"selected":""} onClick={()=>{setWeek(n);setApplyState("idle")}}><b>{n}</b><small>{phaseFor(n)}</small></button>)}</div></section><section className="template-preview"><div><span className="overline">SEMANA {week} DE {plan.weeks}</span><h3>{phaseFor(week)}</h3></div><div>{(effectiveTemplate||weekSamples).map((item:any,i:number)=><article key={effectiveTemplate?item.title:item} className={effectiveTemplate?"editable-template-session":""}><b>{effectiveTemplate?`TREINO ${i+1}`:sampleDays[i]}</b><span><strong>{effectiveTemplate?item.title:item}</strong><small>{effectiveTemplate?`${item.durationMinutes||"Distância definida"}${item.durationMinutes?" min":""} · ${item.steps?.length||0} etapas`:"Estrutura-base · intensidade individual"}</small></span>{effectiveTemplate&&<button onClick={()=>setEditingTemplateIndex(i)}>Ver e editar treino →</button>}</article>)}</div><p>{effectiveTemplate?"Abra qualquer treino para conferir todas as etapas. As alterações serão usadas neste rascunho e você ainda decidirá quando liberar ao aluno.":"Ao aplicar, a base, a fase e a semana escolhida ficam salvas no cadastro."}</p></section><section className="plan-application-summary"><header><span className="overline">CONFIRA ANTES DE CRIAR</span><h3>Este será o rascunho no Calendário</h3></header><div><article><small>ALUNO</small><b>{targetAthlete||"Escolha um aluno"}</b></article><article><small>PLANILHA E SEMANA</small><b>{plan.name} · {week} de {plan.weeks}</b></article><article><small>DATA NO CALENDÁRIO</small><b>{weekDateLabel(targetWeekStart)}</b></article><article><small>DIAS ADAPTADOS</small><b>{selectedDays.join(", ")||"Nenhum dia"}</b></article></div><p>A semana ${week} da biblioteca será usada nestas datas. Ela ficará como rascunho até você conferir e liberar no Calendário.</p></section>{applyState==="saved"&&<div className="request-success">Planilha aplicada a {targetAthlete} ✓ Semana {week} criada como rascunho em {weekDateLabel(targetWeekStart)}.</div>}{applyState==="error"&&<div className="registration-error">Não foi possível aplicar a planilha.</div>}<footer><button className="outline" onClick={close}>Fechar</button><button className="gold" onClick={applyPlan} disabled={plan.pending||!availableDays.length||!targetAthlete||applyState==="saving"}>{plan.pending?"Atualize antes de aplicar":applyState==="saving"?"Aplicando…":effectiveTemplate?`Criar semana ${week} como rascunho →`:"Aplicar base, fase e semana →"}</button></footer></aside>{editingTemplateIndex!==null&&effectiveTemplate?.[editingTemplateIndex]&&<WorkoutDrawer close={()=>setEditingTemplateIndex(null)} athleteName={targetAthlete||"Planilha-base"} day={`TREINO ${editingTemplateIndex+1}`} initial={effectiveTemplate[editingTemplateIndex]} weekLabel={`Semana ${week} de ${plan.weeks}`} onSave={saveTemplateEdit}/>}</div>;
}

function InviteLink(){
  const [state,setState]=useState<"idle"|"copied"|"shared"|"error">("idle");
  const link=typeof window!=="undefined"?window.location.origin:"";
  const message=`Olá! Acesse o ZonasApp pelo link abaixo e faça seu cadastro. Ao abrir, toque em “Instalar ZonasApp” para deixar o aplicativo na tela inicial. Depois que você enviar o cadastro, eu revisarei e liberarei seu acesso:\n${link}`;
  const copy=async()=>setState(await copyText(message)?"copied":"error");
  const whatsapp=()=>{window.open(`https://wa.me/?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");setState("shared")};
  const share=async()=>{try{if(navigator.share){await navigator.share({title:"Cadastro no ZonasApp",text:message,url:link});setState("shared")}else{setState(await copyText(message)?"copied":"error")}}catch(error){if(error instanceof DOMException&&error.name==="AbortError")return;setState("error")}};
  return <section className="invite-link-card"><div><span className="overline">LINK PARA NOVOS ALUNOS</span><h2>Envie o cadastro do ZonasApp</h2><p>O convite já explica como instalar. O aluno preenche os dados, mas só acessa a plataforma depois da sua aprovação.</p><code>{link}</code></div><div className="invite-link-actions"><button className="outline" onClick={copy}>{state==="copied"?"Convite copiado ✓":"Copiar convite"}</button><button className="whatsapp" onClick={whatsapp}>Enviar no WhatsApp</button><button className="gold" onClick={share}>{state==="shared"?"Compartilhado ✓":"Outras opções"}</button></div>{state==="error"&&<small>Não foi possível copiar automaticamente. Pressione o link acima para selecioná-lo.</small>}</section>;
}

function AccessRequests({onApproved}:{onApproved:()=>void}){
  type RequestRow={id:string;email:string;name:string;phone?:string;objective?:string;distance:string;training_days:string;integration:string;status:string;created_at:number};
  const [requests,setRequests]=useState<RequestRow[]>([]);const [state,setState]=useState("");const [confirm,setConfirm]=useState("");
  const load=()=>fetch("/api/access-requests").then(r=>r.ok?r.json():Promise.reject()).then(data=>setRequests(data.requests||[])).catch(()=>setState("error"));
  useEffect(()=>{load()},[]);
  const decide=async(id:string,action:"approve"|"reject")=>{if(confirm!==`${action}:${id}`){setConfirm(`${action}:${id}`);return}setState("saving");try{await api.post("/api/access-requests",{id,action});await load();if(action==="approve")onApproved();setConfirm("");setState("done")}catch{setState("error")}};
  const pending=requests.filter(item=>item.status==="Pendente");
  return <><div className="section-title"><div><small>LIBERAÇÃO PELO PROFESSOR</small><h2>Solicitações de cadastro</h2></div><span>{pending.length} aguardando sua decisão</span></div><section className="access-request-list">{pending.length===0?<div className="access-request-empty"><b>Nenhuma solicitação pendente</b><span>Quando um aluno preencher o cadastro pelo link, ele aparecerá aqui.</span></div>:pending.map(item=>{let days:string[]=[];try{days=JSON.parse(item.training_days||"[]")}catch{}const approveKey=`approve:${item.id}`;const rejectKey=`reject:${item.id}`;return <article key={item.id}><header><div><b>{item.name}</b><small>{item.email} · {item.phone||"sem telefone"}</small></div><span>PENDENTE</span></header><div className="access-request-details"><span><small>DISTÂNCIA</small><b>{item.distance}</b></span><span><small>DIAS</small><b>{days.join(", ")}</b></span><span><small>RELÓGIO/APP</small><b>{item.integration}</b></span><span><small>OBJETIVO</small><b>{item.objective||"Não informado"}</b></span></div><p>O aluno ainda não consegue visualizar treinos ou dados.</p><footer><button className={confirm===rejectKey?"danger-confirm":"outline"} disabled={state==="saving"} onClick={()=>decide(item.id,"reject")}>{confirm===rejectKey?"Confirmar recusa":"Recusar"}</button><button className={confirm===approveKey?"approve-confirm":"gold"} disabled={state==="saving"} onClick={()=>decide(item.id,"approve")}>{confirm===approveKey?"Confirmar e liberar acesso":"Liberar aluno"}</button></footer>{(confirm===approveKey||confirm===rejectKey)&&<small className="decision-note">Confirme novamente. Esta decisão ficará registrada.</small>}</article>})}</section>{state==="error"&&<p className="registration-error">Não foi possível concluir a decisão. Tente novamente.</p>}{state==="done"&&<p className="request-success">Solicitação atualizada com segurança ✓</p>}</>;
}

function TrainingFeedbacks(){
  type Feedback={id:string;athlete_name:string;week_start?:string;workout_day?:string;feeling:string;note?:string;status:string;created_at:number};
  const [items,setItems]=useState<Feedback[]>([]);const [state,setState]=useState("");
  const load=()=>fetch("/api/feedbacks").then(r=>r.ok?r.json():Promise.reject()).then(data=>setItems(data.feedbacks||[])).catch(()=>setState("error"));
  useEffect(()=>{load()},[]);
  const review=async(id:string)=>{setState("saving");try{await api.post("/api/feedbacks",{id,status:"Revisado"});await load();setState("done")}catch{setState("error")}};
  const pending=items.filter(item=>item.status==="Novo");
  return <section className="real-feedbacks"><header><div><span className="overline">RETORNO REAL DOS TREINOS</span><h2>Feedbacks dos alunos</h2><p>Os retornos enviados pela área do aluno aparecem aqui.</p></div><b>{pending.length} novo(s)</b></header>{pending.length===0?<div className="feedback-empty">Nenhum feedback novo para revisar.</div>:pending.map(item=><article key={item.id}><span className={item.feeling==="Sentiu dor"?"pain":item.feeling==="Cansado"?"tired":"good"}>{item.feeling==="Sentiu dor"?"⚠":item.feeling==="Cansado"?"😮‍💨":"🙂"}</span><div><b>{item.athlete_name}</b><small>{item.workout_day||"Treino"} · {new Date(Number(item.created_at)).toLocaleString("pt-BR")}</small><p>{item.feeling}{item.note?` · ${item.note}`:""}</p></div><button disabled={state==="saving"} onClick={()=>review(item.id)}>Marcar como revisado</button></article>)}{state==="error"&&<p className="registration-error">Não foi possível atualizar os feedbacks.</p>}</section>;
}

function WorkoutAccuracy(){
  type Execution={id:string;athlete_name:string;week_start:string;workout_day:string;planned_minutes?:number;planned_km?:string;actual_minutes?:number;actual_km?:string;correct_percentage:number;wrong_percentage:number;classification:string;created_at:number};
  const [items,setItems]=useState<Execution[]>([]);const [state,setState]=useState("loading");
  useEffect(()=>{fetch("/api/workout-executions").then(r=>r.ok?r.json():Promise.reject()).then(data=>{setItems(data.executions||[]);setState("ready")}).catch(()=>setState("error"))},[]);
  return <section className="workout-accuracy-coach"><header><div><span className="overline">CONFERÊNCIA AUTOMÁTICA</span><h2>Treino certo ou fora do planejado</h2><p>Comparação entre o treino liberado e o resultado informado pelo aluno.</p></div><b>{items.length} análise(s)</b></header>{state==="loading"?<div className="feedback-empty">Carregando análises…</div>:items.length===0?<div className="feedback-empty">As análises aparecerão quando os alunos registrarem tempo ou distância.</div>:items.slice(0,8).map(item=><article key={item.id}><div className="accuracy-athlete"><b>{item.athlete_name}</b><small>{item.workout_day} · semana de {String(item.week_start).split("-").reverse().join("/")}</small><span>{item.classification}</span></div><div className="accuracy-comparison"><span><small>PLANEJADO</small><b>{item.planned_minutes?`${item.planned_minutes} min`:"—"}{item.planned_km?` · ${item.planned_km} km`:""}</b></span><span><small>REALIZADO</small><b>{item.actual_minutes?`${item.actual_minutes} min`:"—"}{item.actual_km?` · ${item.actual_km} km`:""}</b></span></div><div className="accuracy-numbers"><strong>{item.correct_percentage}%<small>certo</small></strong><strong className="wrong">{item.wrong_percentage}%<small>fora</small></strong></div></article>)}{state==="error"&&<p className="registration-error">Não foi possível carregar as análises agora.</p>}</section>;
}

function CoachNotificationCenter({go,openPain,painReports,pendingRaces,pendingTests,pendingAccess}:{go:(section:string)=>void;openPain:(c:{id:string;athleteName:string})=>void;painReports:any[];pendingRaces:any[];pendingTests:any[];pendingAccess:any[]}){
  const races=pendingRaces.filter(item=>item.status==="Aguardando análise");
  const tests=pendingTests.filter(item=>item.status!=="Aprovado");
  type Aviso = { id: string; tone: string; icon: string; title: string; detail: string; action: string; section: string; pain?: { id: string; athleteName: string } };
  const alerts: Aviso[]=[
    ...pendingAccess.map(item=>({id:`access-${item.id}`,tone:"gold",icon:"＋",title:"Novo aluno aguardando liberação",detail:`${item.name} enviou o cadastro e ainda não consegue acessar os treinos.`,action:"Revisar cadastro",section:"Cadastros"})),
    ...tests.map(item=>({id:`test-${item.id}`,tone:"amber",icon:"Z",title:"Teste aguardando liberação das zonas",detail:`${item.athlete_name} espera seus ritmos individualizados.`,action:"Liberar zonas",section:"Testes e zonas"})),
    ...painReports.map(item=>({id:`pain-${item.id}`,tone:"red",icon:"!",title:"Relato de dor precisa de atenção",detail:`${item.athlete_name} · ${item.body_area} · intensidade ${item.intensity}/10.`,action:"Acompanhar lesão",section:"Alunos",pain:{id:item.id,athleteName:item.athlete_name}})),
    ...races.map(item=>({id:`race-${item.id}`,tone:"blue",icon:"⚑",title:"Prova aguardando análise",detail:`${item.athlete_name} cadastrou ${item.name} (${item.distance}).`,action:"Analisar prova",section:"Provas"})),
  ];
  return <section className="coach-notification-center" id="avisos-do-professor"><header><div><span className="overline">CENTRAL DE AVISOS</span><h2>O que precisa da sua decisão</h2><p>Cada aviso abre diretamente a tela onde você resolve a pendência.</p></div><b>{alerts.length} pendente(s)</b></header>{alerts.length?<div>{alerts.slice(0,8).map(alert=><button key={alert.id} className={alert.tone} onClick={()=>alert.pain?openPain(alert.pain):go(alert.section)}><i>{alert.icon}</i><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><em>{alert.action} →</em></button>)}</div>:<aside><i>✓</i><span><b>Tudo em dia</b><small>Nenhuma decisão pendente neste momento.</small></span></aside>}</section>;
}

function MobileCoachHome({go,athletes,painReports,pendingRaces,coachName}:{go:(s:string)=>void;athletes:Athlete[];painReports:any[];pendingRaces:any[];coachName:string}){
  const racesWaiting=pendingRaces.filter(race=>race.status==="Aguardando análise");const attentionTotal=painReports.length+racesWaiting.length;
  return <section className="mobile-coach-home"><header><div><small>VISÃO DO PROFESSOR</small><h2>Olá, {coachName.split(" ")[0]}</h2><p>{athletes.length} aluno(s) ativo(s)</p></div><button aria-label="Abrir perfil do professor">JS</button></header><div className="mobile-coach-stats"><article><i>◷</i><b>{athletes.filter(athlete=>!String(athlete.next).includes("Aguardando")).length}</b><span>Treinos hoje</span></article><article><i>!</i><b>{attentionTotal}</b><span>Pendentes</span></article><article><i>✓</i><b>0</b><span>Concluídos</span></article></div><button className="mobile-new-workout" onClick={()=>go("Calendário")}>＋ Novo treino</button><section className="mobile-recent"><header><h3>Atividade recente</h3><button onClick={()=>go("Alunos")}>Ver alunos</button></header>{painReports.length?<article onClick={()=>go("Alunos")}><i>!</i><span><b>{painReports[0].athlete_name} relatou dor</b><small>{painReports[0].body_area} · intensidade {painReports[0].intensity}/10</small></span><strong>›</strong></article>:racesWaiting.length?<article onClick={()=>go("Provas")}><i>!</i><span><b>{racesWaiting[0].name} aguarda análise</b><small>{racesWaiting[0].athlete_name} · {racesWaiting[0].distance}</small></span><strong>›</strong></article>:<div><i>✓</i><b>Nenhuma atividade recente</b><span>Novos avisos dos alunos aparecerão aqui.</span></div>}</section><footer>Transforme cada treino em evolução.</footer></section>
}

function Dashboard({ go, openPain, chooseDistance, athletes, painReports, pendingRaces, pendingTests }: { go: (s: string) => void; openPain: (c:{id:string;athleteName:string})=>void; chooseDistance: (s: string) => void; athletes:Athlete[]; painReports:any[]; pendingRaces:any[]; pendingTests:any[] }) {
  const groupNames:[[string,string],...Array<[string,string]>]=[["Iniciantes","01"],["5 km","05"],["10 km","10"],["Meia","21"],["Maratona","42"]];
  const groups=groupNames.map(([name,number])=>({name,number,count:athletes.filter(athlete=>athlete.distance===name).length}));
  const racesWaiting=pendingRaces.filter(race=>race.status==="Aguardando análise");const nextRace=pendingRaces.find(race=>race.race_date>=new Date().toISOString().slice(0,10));
  const daysToRace=nextRace?Math.max(0,Math.ceil((new Date(`${nextRace.race_date}T12:00:00`).getTime()-Date.now())/86400000)):null;
  const attentionTotal=painReports.length+racesWaiting.length+pendingTests.length;
  return <><section className="hero"><div><span className="pill">VISÃO DA SEMANA</span><h2>Treinos claros.<br/><em>Atletas em movimento.</em></h2><p>{attentionTotal?`${attentionTotal} situação(ões) precisam da sua atenção.`:"Nenhuma pendência urgente registrada."}</p><button className="gold" onClick={()=>go("Calendário")}>Montar treinos da semana →</button></div><div className="attention"><header>ATENÇÃO <b>{attentionTotal}</b></header>{painReports.length?<article className="attention-link" onClick={()=>openPain({id:painReports[0].id,athleteName:painReports[0].athlete_name})}><i className="red"/><span><strong>{painReports.length} relato(s) de dor</strong><small>{painReports[0].athlete_name} · {painReports[0].body_area} · intensidade {painReports[0].intensity}/10</small></span>›</article>:<article><i/><span><strong>Sem relatos de dor pendentes</strong><small>Nenhum aviso registrado pelos alunos.</small></span></article>}{racesWaiting.length?<article onClick={()=>go("Provas")}><i className="amber"/><span><strong>{racesWaiting.length} prova(s) aguardando análise</strong><small>{racesWaiting[0].name} · {racesWaiting[0].athlete_name} · {racesWaiting[0].distance}</small></span>›</article>:<article><i/><span><strong>Provas revisadas</strong><small>Nenhuma prova aguardando sua decisão.</small></span></article>}</div></section><section className="stats"><button className="stat-card" onClick={()=>go("Alunos")}><small>ALUNOS CADASTRADOS</small><b>{athletes.length}</b><span>Ver todos os alunos →</span></button><button className="stat-card" onClick={()=>painReports[0]?openPain({id:painReports[0].id,athleteName:painReports[0].athlete_name}):go("Alunos")}><small>RELATOS DE DOR</small><b>{painReports.length}</b><span>{painReports.length?"Acompanhar lesão →":"Sem pendências"}</span></button><button className="stat-card" onClick={()=>go("Provas")}><small>PROVAS PARA ANALISAR</small><b>{racesWaiting.length}</b><span>{racesWaiting.length?"Analisar provas →":"Tudo revisado"}</span></button><button className="stat-card" onClick={()=>go("Provas")}><small>PRÓXIMA PROVA</small><b>{daysToRace??"—"}{daysToRace!==null&&<em> dias</em>}</b><span>{nextRace?.name||"Nenhuma cadastrada"}</span></button></section><div className="section-title"><div><small>ORGANIZAÇÃO DOS ALUNOS</small><h2>Grupos de treinamento</h2></div><button onClick={()=>go("Alunos")}>Ver todos →</button></div><section className="groups">{groups.map(group=><button key={group.name} onClick={()=>chooseDistance(group.name)}><i>{group.number}</i><h3>{group.name==="Meia"?"Meia maratona":group.name}</h3><b>{group.count} aluno(s)</b><span>Ver bases, fases e semanas →</span></button>)}</section>{painReports.length>0&&<><div className="section-title feedback-title"><div><small>SAÚDE DOS ALUNOS</small><h2>Relatos que precisam de atenção</h2></div><button onClick={()=>go("Alunos")}>Abrir alunos →</button></div><section className="coach-feedbacks">{painReports.slice(0,4).map(report=><article className="pain" key={report.id}><div><b>{String(report.athlete_name).split(/\s+/).slice(0,2).map((part:string)=>part[0]).join("")}</b><span><strong>{report.athlete_name}</strong><small>{new Date(Number(report.created_at)).toLocaleString("pt-BR")}</small></span></div><em>⚠ {report.body_area} · {report.intensity}/10</em><p>{report.note||report.training_impact}</p><button onClick={()=>go("Alunos")}>Revisar aluno</button></article>)}</section></>}</>;
}

function PendingTestShortcut({tests,open}:{tests:any[];open:()=>void}){
  if(!tests.length)return null;
  return <button className="dashboard-pending-zones" onClick={open}><span><small>AÇÃO PRIORITÁRIA</small><b>{tests.length} teste(s) aguardando liberação das zonas</b><em>{tests[0].athlete_name} está esperando os ritmos para receber treinos individualizados.</em></span><strong>Revisar e liberar agora →</strong></button>;
}

function Athletes({ filtered, allAthletes, distance, phase, plan, setDistance, setPhase, setPlan, openProfile, situation, setSituation, counts, onArchiveChange }: any) {
  const planCount=(name:string)=>allAthletes.filter((a:Athlete)=>athletePlan(a)===name).length;
  const [acaoEmCurso,setAcaoEmCurso]=useState("");
  const [confirmando,setConfirmando]=useState("");
  const [motivo,setMotivo]=useState("");

  /** Inativar preserva o histórico; excluir o destruiria. */
  const mudarSituacao=async(nome:string,action:"archive"|"restore")=>{
    setAcaoEmCurso(nome);
    try{
      await api.post("/api/athletes",{action,name:nome,...(action==="archive"&&motivo?{reason:motivo}:{})});
      setConfirmando("");setMotivo("");onArchiveChange?.();
    }catch(error){window.alert(describeError(error,"Não foi possível alterar a situação do aluno."))}
    finally{setAcaoEmCurso("")}
  };

  return <><div className="athlete-situation">
    {(["Ativos","Inativos","Todos"] as const).map(item=>
      <button key={item} className={situation===item?"selected":""} onClick={()=>setSituation(item)}>
        {item}{item==="Ativos"&&counts?.active!==undefined?` (${counts.active})`:item==="Inativos"&&counts?.archived!==undefined?` (${counts.archived})`:""}
      </button>)}
    <small>Alunos inativos mantêm todo o histórico de treinos, testes e provas.</small>
  </div>
  {confirmando&&<div className="athlete-archive-confirm">
    <b>Inativar {confirmando}?</b>
    <p>O aluno sai da lista e perde o acesso, mas o histórico continua guardado. Você pode reativar quando quiser.</p>
    <label>Motivo <small>opcional</small>
      <input value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ex.: encerrou a assessoria em agosto"/>
    </label>
    <div>
      <button className="gold" disabled={acaoEmCurso===confirmando} onClick={()=>mudarSituacao(confirmando,"archive")}>
        {acaoEmCurso===confirmando?"Inativando…":"Confirmar inativação"}
      </button>
      <button onClick={()=>{setConfirmando("");setMotivo("")}}>Cancelar</button>
    </div>
  </div>}
  <div className="filters"><label>DISTÂNCIA<div>{distances.map(d => <button key={d} className={distance === d ? "selected" : ""} onClick={() => setDistance(d)}>{d}</button>)}</div></label><label>PLANILHA-BASE<div>{planNames.map(name => <button key={name} className={plan === name ? "selected" : ""} onClick={() => setPlan(name)}>{name}{name!=="Todas"&&<b>{planCount(name)}</b>}</button>)}</div></label><label>FASE<div>{phases.map(p => <button key={p} className={phase === p ? "selected" : ""} onClick={() => setPhase(p)}>{p}</button>)}</div></label></div><div className="athlete-list"><header><span>ALUNO</span><span>DISTÂNCIA</span><span>PLANILHA-BASE</span><span>FASE</span><span>SEMANA</span><span>PRÓXIMO TREINO</span><span>SITUAÇÃO</span></header>{filtered.map((a: Athlete) => <article key={a.name} className={`athlete-row${a.archivedAt ? " inativo" : ""}`} onClick={() => openProfile(a)}><span className="athlete-name"><b>{a.initials}</b><strong>{a.name}{a.archivedAt ? <em className="athlete-inactive-tag">inativo</em> : null}</strong></span><span>{a.distance}</span><span className="plan-cell">{athletePlan(a)}</span><span>{a.phase}</span><span>{a.week}</span><span>{a.archivedAt ? (a.archivedReason || "Sem motivo registrado") : a.next}</span><span className="athlete-row-action" onClick={event => event.stopPropagation()}>{a.archivedAt
  ? <button disabled={acaoEmCurso === a.name} onClick={() => mudarSituacao(a.name, "restore")}>{acaoEmCurso === a.name ? "Reativando…" : "Reativar"}</button>
  : <><span className={a.flag ? "flag" : "ok"}>{a.flag || "Abrir ficha"}</span><button className="athlete-archive" onClick={() => setConfirmando(a.name)}>Inativar</button></>}</span></article>)}</div></>;
}

function AthleteProfile({ athlete, close, onOpenPain }: { athlete: Athlete; close: () => void; onOpenPain?: (id: string) => void }) {
  const [saved, setSaved] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [tab, setTab] = useState("Cadastro");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [objective, setObjective] = useState(athlete.distance);
  const [integration, setIntegration] = useState("Garmin");
  const [trainingDays, setTrainingDays] = useState<string[]>([]);
  const [race, setRace] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [raceDistance, setRaceDistance] = useState(athlete.distance === "Meia" ? "21,1 km" : athlete.distance === "Maratona" ? "42,2 km" : athlete.distance);
  const [racePriority, setRacePriority] = useState("Prova A");
  const [raceGoal, setRaceGoal] = useState("");
  const [email, setEmail] = useState(athlete.name === "Marina Costa" ? "" : `${athlete.name.toLowerCase().replace(/\s+/g, ".")}@email.com`);
  const [access, setAccess] = useState<"Não convidado" | "Convite preparado" | "Ativo" | "Bloqueado">("Não convidado");
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const [lastAccess, setLastAccess] = useState("ainda não acessou");
  const [activatedAt, setActivatedAt] = useState("");
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [revocationConfirmed, setRevocationConfirmed] = useState(false);
  const [accessHistory, setAccessHistory] = useState<Array<{id:string;action:string;actor_email:string;previous_status:string|null;new_status:string;created_at:number}>>([]);
  const [testHistory, setTestHistory] = useState<Array<{id:string;test_date:string;distance_km:number;total_seconds:number;vam:string;vo2:string;fc_max:number;pace_seconds:string;zones:string;tempo_runs:string;status:string}>>([]);
  const [reviewTestId,setReviewTestId]=useState("");
  const [reviewZones,setReviewZones]=useState<Array<{z:string;label:string;slow:string;fast:string}>>([]);
  const [reviewTempos,setReviewTempos]=useState<Array<{label:string;targetPace:string;projectedTotal:number}>>([]);
  const [reviewState,setReviewState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const [handled, setHandled] = useState(false);
  const [historyExecutions,setHistoryExecutions]=useState<any[]>([]);
  const [historyFeedbacks,setHistoryFeedbacks]=useState<any[]>([]);
  const [copiedWeek, setCopiedWeek] = useState("");
  const [plannedPhase, setPlannedPhase] = useState(athlete.phase);
  const defaultPlan = athletePlan(athlete);
  const [trainingPlan, setTrainingPlan] = useState(defaultPlan);
  const [weekConfirmed, setWeekConfirmed] = useState(false);
  const [manualWeek, setManualWeek] = useState<number | null>(null);
  const [planningSaveState,setPlanningSaveState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const toggleTrainingDay = (day:string) => setTrainingDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day]);
  const tabs = ["Cadastro", "Treinos", "Testes e zonas", "Histórico", "Acesso"];
  const planCatalog: Record<string,{weeks:number,frequency:string,level:string}> = {
    "Iniciantes": {weeks:10,frequency:"3 treinos/semana",level:"Começar a correr"},
    "5 km Bronze": {weeks:10,frequency:"3 treinos/semana",level:"Conclusão e evolução"},
    "5 km Prata": {weeks:13,frequency:"até 6 treinos/semana",level:"Intermediário"},
    "5 km Ouro": {weeks:14,frequency:"até 6 treinos/semana",level:"Avançado"},
    "5 km Elite": {weeks:15,frequency:"até 6 treinos/semana",level:"Alto rendimento"},
    "10 km Lion": {weeks:16,frequency:"4 treinos/semana",level:"5 km para 10 km"},
    "Meia Start": {weeks:14,frequency:"3–4 treinos/semana",level:"Primeira meia"},
    "Meia Finish": {weeks:18,frequency:"4–6 treinos/semana",level:"Performance na meia"},
    "One Marathon": {weeks:20,frequency:"4–5 treinos/semana",level:"Primeira maratona"},
    "Full Marathon": {weeks:25,frequency:"5–6 treinos/semana",level:"Performance na maratona"},
  };
  const currentPlan = planCatalog[trainingPlan];
  const availableDayCount=trainingDays.length;
  const recommendedPlan=(()=>{
    if(raceDistance==="5 km"){
      if(availableDayCount<=3)return"5 km Bronze";
      if(["5 km Prata","5 km Ouro","5 km Elite"].includes(trainingPlan))return trainingPlan;
      return availableDayCount===4?"5 km Prata":"5 km Ouro";
    }
    if(raceDistance==="10 km")return"10 km Lion";
    if(raceDistance==="21,1 km")return availableDayCount>=4&&trainingPlan==="Meia Finish"?"Meia Finish":"Meia Start";
    if(raceDistance==="42,2 km")return availableDayCount>=5&&trainingPlan==="Full Marathon"?"Full Marathon":"One Marathon";
    return trainingPlan;
  })();
  const recommendedPlanDetails=planCatalog[recommendedPlan];
  const todayIso = new Date().toISOString().slice(0,10);
  const daysUntilRace = raceDate ? Math.ceil((new Date(`${raceDate}T12:00:00Z`).getTime()-new Date(`${todayIso}T12:00:00Z`).getTime())/86400000) : null;
  const weeksUntilRace = daysUntilRace === null ? null : Math.max(1,Math.ceil((daysUntilRace+1)/7));
  const dateSuggestedWeek = weeksUntilRace === null ? null : Math.max(1,currentPlan.weeks-weeksUntilRace+1);
  const dateSuggestedPhase = dateSuggestedWeek === null ? plannedPhase : phaseForPlanWeek(trainingPlan,dateSuggestedWeek);
  const recommendedDateSuggestedWeek=weeksUntilRace===null?null:Math.max(1,recommendedPlanDetails.weeks-weeksUntilRace+1);
  const recommendedDateSuggestedPhase=recommendedDateSuggestedWeek===null?plannedPhase:phaseForPlanWeek(recommendedPlan,recommendedDateSuggestedWeek);
  const deadlineStatus = weeksUntilRace === null ? "none" : weeksUntilRace < 3 ? "critical" : weeksUntilRace < Math.ceil(currentPlan.weeks*.4) ? "short" : "comfortable";
  const suggestedWeekByPhase: Record<string,number> = {
    "Adaptação": 1,
    "Base": Math.max(2,Math.ceil(currentPlan.weeks*.25)),
    "Desenvolvimento": Math.ceil(currentPlan.weeks*.5),
    "Específica": Math.max(1,currentPlan.weeks-3),
    "Pré-prova": currentPlan.weeks,
  };
  const reasons: Record<string,string> = {
    "Adaptação":"Entrada gradual respeitando o nível da planilha e os dias disponíveis.",
    "Base":"Construção de volume dentro da estrutura específica desta planilha.",
    "Desenvolvimento":"Evolução dos estímulos conforme o histórico recente do aluno.",
    "Específica":"Aproximação da prova com treinos próprios da distância e do nível escolhido.",
    "Pré-prova":"Redução de volume e manutenção de estímulos curtos antes da prova.",
  };
  const lastCompletedNumber = Number.parseInt(athlete.week) || 0;
  const continuingCurrentPlan = trainingPlan === defaultPlan && plannedPhase === athlete.phase;
  const suggestedNumber = dateSuggestedWeek ?? (continuingCurrentPlan ? Math.min(lastCompletedNumber+1,currentPlan.weeks) : (suggestedWeekByPhase[plannedPhase] || 1));
  const suggestion = {week:`Semana ${suggestedNumber} de ${currentPlan.weeks}`,remaining:weeksUntilRace!==null?`${weeksUntilRace} semana${weeksUntilRace===1?"":"s"} até a prova`:(plannedPhase === "Pré-prova" ? "1 semana para a prova-alvo" : `${currentPlan.weeks-suggestedNumber+1} semanas restantes nesta planilha`),reason:weeksUntilRace!==null?`A semana final da ${trainingPlan} ficará alinhada à data da competição.`:reasons[plannedPhase]};
  const selectedWeekNumber = Math.min(manualWeek ?? suggestedNumber, currentPlan.weeks);
  const selectedWeekLabel = `Semana ${selectedWeekNumber} de ${currentPlan.weeks}`;
  const profilePlanningLabel = `${athlete.distance} · ${plannedPhase} · semana ${selectedWeekNumber} de ${currentPlan.weeks}`;
  const changeSelectedWeek = (week:number) => {
    setManualWeek(Math.min(currentPlan.weeks, Math.max(1, week)));
    setWeekConfirmed(false);
    setCopiedWeek("");
  };
  const useRaceSuggestion=()=>{
    if(recommendedDateSuggestedWeek===null)return;
    const availability=availableDayCount?`${availableDayCount} dia${availableDayCount===1?"":"s"} disponível(is)`:"nenhum dia disponível";
    if(!window.confirm(`Sugestão individual para ${athlete.name.split(" ")[0]}:\n\n${recommendedPlan} · semana ${recommendedDateSuggestedWeek} de ${recommendedPlanDetails.weeks}\n${raceDistance} · ${availability}\n\nAplicar esta base e revisar o planejamento?`))return;
    setTrainingPlan(recommendedPlan);
    setManualWeek(recommendedDateSuggestedWeek);
    setPlannedPhase(recommendedDateSuggestedPhase);
    setWeekConfirmed(false);
    setPlanningSaveState("idle");
    setTab("Treinos");
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/athlete-profile?athlete=${encodeURIComponent(athlete.name)}`).then(response => response.ok ? response.json() : {profile:null}),
      fetch(`/api/races-records?athlete=${encodeURIComponent(athlete.name)}`).then(response => response.ok ? response.json() : {races:[]}),
      fetch(`/api/performance-tests?athlete=${encodeURIComponent(athlete.name)}`).then(response => response.ok ? response.json() : {tests:[]}),
      fetch(`/api/athlete-planning?athlete=${encodeURIComponent(athlete.name)}`).then(response => response.ok ? response.json() : {planning:null}),
      fetch("/api/workout-executions").then(response=>response.ok?response.json():{executions:[]}),
      fetch("/api/feedbacks").then(response=>response.ok?response.json():{feedbacks:[]}),
    ]).then(([profileData,raceData,testData,planningData,executionData,feedbackData]) => {
      if (!active) return;
      const profile = profileData.profile;
      if (profile) {
        setPhone(profile.phone || "");
        setBirthDate(profile.birth_date || "");
        setObjective(profile.objective || athlete.distance);
        setIntegration(profile.integration || "Garmin");
        try { setTrainingDays(JSON.parse(profile.training_days || "[]")); } catch { setTrainingDays([]); }
      }
      const nextRace = raceData.races?.[0];
      if (nextRace) {
        setRace(nextRace.name || "");
        setRaceDate(nextRace.race_date || "");
        setRaceDistance(nextRace.distance || raceDistance);
        setRacePriority(nextRace.priority || "Prova A");
        setRaceGoal(nextRace.goal || "");
      }
      setTestHistory(testData.tests || []);
      setHistoryExecutions((executionData.executions||[]).filter((item:any)=>item.athlete_name===athlete.name));
      setHistoryFeedbacks((feedbackData.feedbacks||[]).filter((item:any)=>item.athlete_name===athlete.name));
      if(planningData.planning){setTrainingPlan(planningData.planning.plan);setPlannedPhase(planningData.planning.phase);setManualWeek(Number(planningData.planning.week_number));setWeekConfirmed(true)}
    }).catch(() => { if (active) setProfileMessage("Não foi possível carregar toda a ficha agora."); });
    return () => { active = false; };
  }, [athlete.name]);
  const saveProfile = async () => {
    setProfileSaving(true); setProfileMessage(""); setSaved(false);
    try {
      await api.post("/api/athlete-profile", { athleteName: athlete.name, phone, birthDate, objective, integration, trainingDays });
      await api.post("/api/athlete-planning", { athleteName: athlete.name, plan: trainingPlan, phase: plannedPhase, weekNumber: selectedWeekNumber, totalWeeks: currentPlan.weeks });
      if (race.trim() && raceDate) {
        await api.post("/api/races-records", { kind: "race", athleteName: athlete.name, name: race, raceDate, distance: raceDistance, goal: raceGoal, priority: racePriority });
      }
      setSaved(true);setWeekConfirmed(true);window.dispatchEvent(new Event("zonasapp:athletes-refresh"));setProfileMessage("Ficha e planejamento confirmados. A ficha será atualizada com a mesma semana do calendário.");window.setTimeout(close,900);
    } catch (error) { setProfileMessage(describeError(error, "Não foi possível salvar a ficha. Tente novamente.")); }
    finally { setProfileSaving(false); }
  };
  const savePlanningOnly=async()=>{
    const trainingDayKeys=trainingDays.map(day=>day.toUpperCase());
    if(!trainingDayKeys.length){
      setPlanningSaveState("error");
      window.alert(`Antes de criar a semana de ${athlete.name.split(" ")[0]}, escolha pelo menos um dia disponível na aba Cadastro.`);
      setTab("Cadastro");
      return;
    }
    setPlanningSaveState("saving");
    try{
      const draftWeekStart=shiftIsoDate(mondayOf(new Date().toISOString().slice(0,10)),7);
      const existing=await fetch(`/api/training-weeks?athlete=${encodeURIComponent(athlete.name)}&weekStart=${draftWeekStart}`).then(result=>result.ok?result.json():{week:null});
      let sessions:Record<string,StructuredSession>={};
      if(!existing.week){
        sessions=await sessionsForSavedPlanWeek(trainingPlan,selectedWeekNumber,trainingDayKeys);
        if(!Object.keys(sessions).length){
          setPlanningSaveState("error");
          window.alert(`A semana ${selectedWeekNumber} da planilha ${trainingPlan} ainda não possui treinos estruturados. Complete a planilha-base antes de criar o rascunho.`);
          return;
        }
      }
      const sessionPreview=trainingDayKeys.map(day=>{
        const session=sessions[day];
        return `${day}: ${session?.title||session?.description||session?.type||"Treino estruturado"}`;
      }).join("\n");
      const confirmation=existing.week
        ? `Já existe uma programação para ${athlete.name.split(" ")[0]} em ${weekDateLabel(draftWeekStart)}.\n\nO planejamento será atualizado para ${trainingPlan} · semana ${selectedWeekNumber} de ${currentPlan.weeks}, e a programação existente será aberta sem ser substituída.\n\nContinuar?`
        : `CONFIRA A SEMANA DE ${athlete.name.split(" ")[0].toUpperCase()}\n\nPlanilha: ${trainingPlan}\nFase: ${plannedPhase}\nSemana: ${selectedWeekNumber} de ${currentPlan.weeks}\nDatas: ${weekDateLabel(draftWeekStart)}\nDias: ${trainingDayKeys.join(", ")}\n\nTREINOS QUE SERÃO CRIADOS\n${sessionPreview}\n\nCriar esta semana como rascunho?`;
      if(!window.confirm(confirmation)){
        setPlanningSaveState("idle");
        return;
      }
      const response=await fetch("/api/athlete-planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:athlete.name,plan:trainingPlan,phase:plannedPhase,weekNumber:selectedWeekNumber,totalWeeks:currentPlan.weeks})});
      if(!response.ok)throw new Error();
      if(!existing.week){
        const draft=await fetch("/api/training-weeks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:athlete.name,weekStart:draftWeekStart,plan:trainingPlan,phase:plannedPhase,weekLabel:`${selectedWeekNumber} de ${currentPlan.weeks}`,trainingDays:trainingDayKeys,sessions,status:"Rascunho"})});
        if(!draft.ok)throw new Error();
      }
      setWeekConfirmed(true);setPlanningSaveState("saved");window.dispatchEvent(new Event("zonasapp:athletes-refresh"));window.setTimeout(()=>window.dispatchEvent(new CustomEvent("zonasapp:open-calendar",{detail:athlete.name})),700);
    }catch{setPlanningSaveState("error")}
  };
  const startTestReview=(test:typeof testHistory[number])=>{
    const zones=JSON.parse(test.zones||"[]"); const tempos=JSON.parse(test.tempo_runs||"[]");
    setReviewTestId(test.id);setReviewState("idle");
    setReviewZones(zones.map((zone:any)=>({...zone,slow:paceInput(zone.slow),fast:paceInput(zone.fast)})));
    setReviewTempos(tempos.map((tempo:any)=>({...tempo,targetPace:paceInput(tempo.targetPace)})));
  };
  const saveTestReview=async(action:"review"|"approve")=>{
    setReviewState("saving");
    const zones=reviewZones.map(zone=>({...zone,slow:paceSeconds(zone.slow),fast:paceSeconds(zone.fast)}));
    const tempoRuns=reviewTempos.map(tempo=>({...tempo,targetPace:paceSeconds(tempo.targetPace)}));
    try{const result=await api.post<{status:string;zones:unknown;tempoRuns:unknown}>("/api/performance-tests",{id:reviewTestId,action,zones,tempoRuns});setTestHistory(current=>current.map(test=>test.id===reviewTestId?{...test,status:result.status,zones:JSON.stringify(result.zones),tempo_runs:JSON.stringify(result.tempoRuns)}:test));setReviewState("saved");if(action==="approve")setReviewTestId("")}catch{setReviewState("error")}
  };
  useEffect(() => {
    let active = true;
    fetch(`/api/athlete-access?athlete=${encodeURIComponent(athlete.name)}`)
      .then(async response => response.ok ? response.json() : Promise.reject())
      .then(({access: stored, history = []}) => {
        if (!active) return;
        setAccessHistory(history);
        if (!stored) return;
        setEmail(String(stored.email ?? ""));
        setAccess(stored.status === "Ativo" ? "Ativo" : stored.status === "Bloqueado" ? "Bloqueado" : "Convite preparado");
        setLastAccess(stored.last_access_at ? new Date(Number(stored.last_access_at)).toLocaleString("pt-BR") : "ainda não acessou");
        setActivatedAt(stored.activated_at ? new Date(Number(stored.activated_at)).toLocaleString("pt-BR") : "");
      })
      .catch(() => { if (active) setAccessMessage("Não foi possível consultar o acesso agora."); });
    return () => { active = false; };
  }, [athlete.name]);
  const saveAthleteAccess = async (nextStatus: "Convite preparado" | "Ativo" | "Bloqueado") => {
    if (nextStatus === "Bloqueado" && access === "Ativo" && !revocationConfirmed) {
      setRevocationConfirmed(true);
      setAccessMessage("Confirme novamente em ‘Bloquear acesso’. As sessões do aluno perderão acesso em até 30 segundos.");
      return;
    }
    setAccessSaving(true);
    setAccessMessage("");
    try {
      const response = await fetch("/api/athlete-access", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:athlete.name,email,status:nextStatus})});
      const result = await response.json() as {error?:string;activatedAt?:number|null};
      if (!response.ok) throw new Error(result.error === "email_already_linked" ? "Este e-mail já está ligado a outro aluno." : result.error === "invalid_email" ? "Digite um e-mail válido." : "Não foi possível salvar o acesso.");
      setAccess(nextStatus);
      if (result.activatedAt) setActivatedAt(new Date(result.activatedAt).toLocaleString("pt-BR"));
      const refreshed = await fetch(`/api/athlete-access?athlete=${encodeURIComponent(athlete.name)}`);
      if (refreshed.ok) setAccessHistory(((await refreshed.json()) as {history?:typeof accessHistory}).history ?? []);
      setActivationConfirmed(false);
      setRevocationConfirmed(false);
      setAccessMessage(nextStatus === "Ativo" ? "Acesso ativado. O aluno já pode usar a área individual quando receber permissão de entrada." : nextStatus === "Bloqueado" ? "Acesso bloqueado imediatamente e vínculo mantido." : "Vínculo salvo com segurança.");
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Não foi possível salvar o acesso.");
    } finally {
      setAccessSaving(false);
    }
  };
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}><aside className="drawer athlete-profile"><header><div><span className="overline">FICHA DO ALUNO</span><h2>{athlete.name}</h2><p>{profilePlanningLabel}</p></div><button onClick={close}>×</button></header><div className="profile-quick-actions"><button onClick={()=>setTab("Testes e zonas")}><i>◎</i><span><b>Testes e zonas</b><small>Revisar ritmos</small></span></button><button onClick={()=>window.dispatchEvent(new CustomEvent("zonasapp:open-calendar",{detail:athlete.name}))}><i>□</i><span><b>Montar semana</b><small>Abrir calendário</small></span></button><button onClick={()=>window.dispatchEvent(new CustomEvent("zonasapp:preview-athlete",{detail:athlete.name}))}><i>↔</i><span><b>Ver como aluno</b><small>Conferir a tela</small></span></button></div>{onOpenPain && <AthletePainList athleteName={athlete.name} onOpen={onOpenPain} />}{tab === "Cadastro" && !race && <div className="profile-alert">Cadastro incompleto: adicione a próxima prova para facilitar a periodização.</div>}{testHistory.some(test=>test.status!=="Aprovado")&&<button className="profile-zone-pending" onClick={()=>setTab("Testes e zonas")}><span><b>Zonas de treino aguardando sua liberação</b><small>Abra, confira os ritmos e aprove para usar nos treinos de {athlete.name.split(" ")[0]}.</small></span><strong>Liberar agora →</strong></button>}<div className="profile-tabs">{tabs.map(item=><button key={item} className={tab === item ? "selected" : ""} onClick={()=>setTab(item)}>{item}{item==="Testes e zonas"&&testHistory.some(test=>test.status!=="Aprovado")?<b className="tab-alert-dot">!</b>:null}</button>)}</div>
  {tab === "Cadastro" && <>
    <section className="profile-section">
      <h3>Dados e disponibilidade</h3>
      <div className="profile-grid">
        <label>Telefone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(47) 99999-0000" /></label>
        <label>Data de nascimento<input type="date" value={birthDate} onChange={e=>setBirthDate(e.target.value)} /></label>
        <label>Objetivo principal<input value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Ex.: melhorar nos 10 km" /></label>
        <label>Relógio ou aplicativo<select value={integration} onChange={e=>setIntegration(e.target.value)}><option>Strava</option><option>Garmin</option><option>Amazfit</option><option>Apple Saúde / Apple Watch</option><option>Sem integração</option></select></label>
      </div>
      <label>Dias disponíveis para treinar<div className="day-picker">{days.map(d=><button type="button" key={d} className={trainingDays.includes(d)?"selected":""} onClick={()=>toggleTrainingDay(d)}>{d}</button>)}</div></label>
    </section>
    <section className="profile-section">
      <div className="profile-title"><div><span className="overline">PERIODIZAÇÃO</span><h3>Próxima prova</h3></div><small>{race&&raceDate?"Salva junto com a ficha":"Preencha quando o aluno definir"}</small></div>
      <div className="profile-grid">
        <label>Nome da prova<input value={race} onChange={e=>setRace(e.target.value)} placeholder="Informe a prova" /></label>
        <label>Data<input type="date" value={raceDate} onChange={e=>setRaceDate(e.target.value)} /></label>
        <label>Distância<select value={raceDistance} onChange={e=>setRaceDistance(e.target.value)}><option>5 km</option><option>10 km</option><option>21,1 km</option><option>42,2 km</option><option>Outra</option></select></label>
        <label>Prioridade<select value={racePriority} onChange={e=>setRacePriority(e.target.value)}><option>Prova A</option><option>Prova B</option><option>Preparatória</option></select></label>
      </div>
      <label>Meta ou observação<input value={raceGoal} onChange={e=>setRaceGoal(e.target.value)} placeholder="Ex.: concluir bem ou buscar recorde pessoal" /></label>
      {raceDate&&daysUntilRace!==null&&<section className={`race-periodization-suggestion ${deadlineStatus}`}><header><div><span className="overline">SUGESTÃO DA ZONASAPP</span><h3>{daysUntilRace<0?"A data desta prova já passou":`${weeksUntilRace} semana${weeksUntilRace===1?"":"s"} até a prova`}</h3></div><b>{daysUntilRace<0?"REVISAR DATA":`SEMANA ${dateSuggestedWeek}`}</b></header>{daysUntilRace>=0&&<><div><article><small>PLANILHA-BASE</small><strong>{trainingPlan}</strong></article><article><small>ENTRADA SUGERIDA</small><strong>Semana {dateSuggestedWeek} de {currentPlan.weeks}</strong></article><article><small>FASE CALCULADA</small><strong>{dateSuggestedPhase}</strong></article></div><p>{deadlineStatus==="critical"?"Prazo muito curto: use uma adaptação especial e reduza a carga. Não tente recuperar as semanas perdidas.":deadlineStatus==="short"?"Prazo reduzido: a plataforma preservará as semanas finais, mas o professor deve conferir volume, histórico e risco de lesão.":"Há tempo para aplicar a estrutura da planilha e chegar à semana da prova com redução de carga."}</p><button type="button" className="gold" onClick={useRaceSuggestion}>Usar esta sugestão e revisar →</button></>}</section>}
    </section>
    {profileMessage&&<p className={"profile-save-message "+(saved?"success":"error")} role="status">{profileMessage}</p>}
  </>}
  {tab === "Treinos" && <section className="profile-section planning-simple"><div className="planning-simple-head"><span className="overline">PLANEJAMENTO DO ALUNO</span><h3>Escolha a base em três passos</h3><p>Aqui você define somente onde o aluno está. A montagem dos treinos fica no Calendário.</p></div><div className="planning-simple-steps"><label><i>1</i><span>Planilha-base<small>Objetivo e nível do aluno</small></span><select value={trainingPlan} onChange={e=>{setTrainingPlan(e.target.value);setManualWeek(1);setPlanningSaveState("idle")}}>{Object.keys(planCatalog).map(plan=><option key={plan}>{plan}</option>)}</select></label><label><i>2</i><span>Fase atual<small>Momento da preparação</small></span><select value={plannedPhase} onChange={e=>{setPlannedPhase(e.target.value);setPlanningSaveState("idle")}}>{["Adaptação","Base","Desenvolvimento","Específica","Pré-prova"].map(phase=><option key={phase}>{phase}</option>)}</select></label><label><i>3</i><span>Semana da base<small>Você pode editar livremente</small></span><div className="simple-week-control"><button type="button" disabled={selectedWeekNumber<=1} onClick={()=>changeSelectedWeek(selectedWeekNumber-1)}>−</button><select value={selectedWeekNumber} onChange={e=>changeSelectedWeek(Number(e.target.value))}>{Array.from({length:currentPlan.weeks},(_,index)=>index+1).map(week=><option key={week} value={week}>Semana {week} de {currentPlan.weeks}</option>)}</select><button type="button" disabled={selectedWeekNumber>=currentPlan.weeks} onClick={()=>changeSelectedWeek(selectedWeekNumber+1)}>+</button></div></label></div><div className="planning-simple-summary"><div><small>BASE ESCOLHIDA</small><b>{trainingPlan}</b><span>{currentPlan.level} · {currentPlan.frequency}</span></div><div><small>POSIÇÃO ATUAL</small><b>{plannedPhase}</b><span>Semana {selectedWeekNumber} de {currentPlan.weeks}</span></div><div><small>DIAS DISPONÍVEIS</small><b>{trainingDays.length||0} dias</b><span>{trainingDays.length?trainingDays.join(", "):"Defina na aba Cadastro"}</span></div></div><button className="gold planning-save" disabled={planningSaveState==="saving"} onClick={savePlanningOnly}>{planningSaveState==="saving"?"Salvando…":planningSaveState==="saved"?"Planejamento salvo ✓":"Salvar planilha, fase e semana"}</button>{planningSaveState==="saved"&&<div className="request-success">Pronto. Agora abra o Calendário, escolha {athlete.name.split(" ")[0]} e monte a próxima semana.</div>}{planningSaveState==="error"&&<div className="registration-error">Não foi possível salvar. Tente novamente.</div>}<aside className="planning-boundary"><b>O que acontece depois?</b><span>Salvar aqui não libera treino ao aluno. No Calendário você monta, revisa e decide quando liberar.</span></aside></section>}
  {tab === "Treinos" && <section className="profile-section training-tab"><div className="week-planner"><div className="plan-selection"><label>Planilha-base<select value={trainingPlan} onChange={e=>{setTrainingPlan(e.target.value);setManualWeek(null);setWeekConfirmed(false);setCopiedWeek("")}}>{Object.keys(planCatalog).map(plan=><option key={plan}>{plan}</option>)}</select></label><div><b>{currentPlan.weeks} semanas</b><span>{currentPlan.level} · {currentPlan.frequency}</span></div></div><div className="planner-top"><label>Fase para a próxima semana<select value={plannedPhase} onChange={e=>{setPlannedPhase(e.target.value);setManualWeek(null);setWeekConfirmed(false)}}>{["Adaptação","Base","Desenvolvimento","Específica","Pré-prova"].map(p=><option key={p}>{p}</option>)}</select></label><div><span className="overline">SUGESTÃO DO ZONASAPP</span><h3>{suggestion.week}</h3><small>{suggestion.remaining}</small></div></div><p>{suggestion.reason}</p><div className="week-selector"><div><span className="overline">{manualWeek===null?"SEMANA SUGERIDA":"SEMANA ESCOLHIDA POR VOCÊ"}</span><h3>{selectedWeekLabel}</h3><small>Você pode usar a sugestão ou escolher qualquer semana da planilha.</small></div><div className="week-selector-controls"><button type="button" aria-label="Semana anterior" disabled={selectedWeekNumber<=1} onClick={()=>changeSelectedWeek(selectedWeekNumber-1)}>←</button><label>Escolher semana<select aria-label="Escolher semana da planilha" value={selectedWeekNumber} onChange={e=>changeSelectedWeek(Number(e.target.value))}>{Array.from({length:currentPlan.weeks},(_,i)=>i+1).map(week=><option key={week} value={week}>Semana {week}</option>)}</select></label><button type="button" aria-label="Próxima semana" disabled={selectedWeekNumber>=currentPlan.weeks} onClick={()=>changeSelectedWeek(selectedWeekNumber+1)}>→</button></div>{manualWeek!==null&&manualWeek!==suggestedNumber&&<button type="button" className="use-suggestion" onClick={()=>{setManualWeek(null);setWeekConfirmed(false);setCopiedWeek("")}}>Voltar para a semana sugerida ({suggestedNumber})</button>}</div><div className="planner-evidence"><span><b>Planilha</b><small>{trainingPlan}</small></span><span><b>Última concluída</b><small>{athlete.week}</small></span><span><b>Próxima prova</b><small>{race || "Não informada"}</small></span><span><b>Fase sugerida</b><small>{plannedPhase}</small></span></div><footer><span>Você pode confirmar ou alterar antes de montar os treinos.</span><button className={weekConfirmed?"confirmed":""} onClick={()=>setWeekConfirmed(true)}>{weekConfirmed?`${selectedWeekLabel} confirmada ✓`:`Confirmar ${selectedWeekLabel}`}</button></footer></div><div className="next-week"><div><span className="overline">PRÓXIMA SEMANA · {trainingPlan}</span><h3>17–23 de agosto · {weekConfirmed ? selectedWeekLabel : "aguardando confirmação"}</h3><p>{copiedWeek ? `Base copiada da ${copiedWeek}. Revise antes de publicar.` : weekConfirmed ? "Semana liberada para programação." : "Confirme a sugestão acima para começar."}</p></div><button className="gold" disabled={!weekConfirmed}>{copiedWeek ? "Revisar semana →" : "+ Montar próxima semana"}</button></div><div className="training-week-preview">{copiedWeek ? <>{[["SEG","Leve","40 min · Z1"],["QUA","Intervalado","6 × (1 min Z4 + 2 min Z1)"],["SEX","Tempo Run","3 × 10 min · Z3"],["DOM","Longão","1h15 progressivo"]].map(([day,type,work])=><article key={day}><b>{day}</b><span><strong>{type}</strong><small>{work}</small></span></article>)}</> : <p>{weekConfirmed ? "Copie uma semana anterior ou monte os treinos do zero." : "A programação será liberada após sua confirmação."}</p>}</div><div className="history-title"><div><span className="overline">HISTÓRICO</span><h3>Semanas anteriores</h3></div><span>Toque em uma semana para reutilizar</span></div><div className="week-history">{[
    {label:"Semana 8",date:"10–16 ago",phase:"Específica",volume:"42 km",done:"5/5 concluídos",items:["Leve Z1","6 × (1 min Z4 + 2 min Z1)","Tempo Run","Longão 1h15"]},
    {label:"Semana 7",date:"3–9 ago",phase:"Específica",volume:"39 km",done:"4/5 concluídos",items:["Regenerativo","5 × 800 m Z4","Progressivo","Longão 1h10"]},
    {label:"Semana 6",date:"27 jul–2 ago",phase:"Desenvolvimento",volume:"37 km",done:"5/5 concluídos",items:["Leve Z1","Fartlek 10 × 1 min","Tempo Run","Longão 1h05"]}
  ].map(week=><article key={week.label} className={copiedWeek===week.label?"copied":""}><header><div><b>{week.label}</b><small>{week.date} · {week.phase}</small></div><span>{week.done}</span></header><div>{week.items.map(item=><small key={item}>{item}</small>)}</div><footer><span>{week.volume} planejados</span><button disabled={!weekConfirmed} onClick={()=>setCopiedWeek(week.label)}>{copiedWeek===week.label?"Copiada para a próxima ✓":"Copiar para a próxima"}</button></footer></article>)}</div><div className="copy-note"><b>As intensidades continuam individuais.</b><span>Ao copiar, o ZonasApp mantém a estrutura da semana e aplica os ritmos, a FC e os Tempo Runs atuais deste aluno.</span></div></section>}
  {tab === "Acesso" && <section className="profile-section access-section"><div className="access-head"><div><span className={`access-dot ${access === "Bloqueado" ? "blocked" : access === "Convite preparado" || access === "Ativo" ? "ready" : ""}`}/><div><small>STATUS DE ACESSO</small><h3>{access}</h3></div></div><span>Último acesso: {lastAccess}</span></div><label>E-mail usado para entrar no ZonasApp<input type="email" value={email} disabled={access==="Ativo"} onChange={e=>{setEmail(e.target.value);setAccess("Não convidado");setAccessMessage("");setActivationConfirmed(false);setRevocationConfirmed(false)}} placeholder="aluno@email.com" /></label><p className="access-help">O aluno entrará com o próprio e-mail. Você não precisa criar ou guardar senha.</p>{activatedAt&&<p className="access-help">Ativado em: {activatedAt}</p>}{(access==="Convite preparado"||access==="Bloqueado")&&<label className="activation-confirm"><input type="checkbox" checked={activationConfirmed} onChange={e=>setActivationConfirmed(e.target.checked)}/><span>Conferi o nome do aluno e o e-mail. Quero {access==="Bloqueado"?"reativar":"ativar"} a área individual.</span></label>}<div className="access-actions">{access==="Não convidado"&&<button className="gold" disabled={!email.trim()||accessSaving} onClick={()=>saveAthleteAccess("Convite preparado")}>{accessSaving?"Salvando...":"Preparar vínculo"}</button>}{(access==="Convite preparado"||access==="Bloqueado")&&<button className="gold" disabled={!activationConfirmed||accessSaving} onClick={()=>saveAthleteAccess("Ativo")}>{accessSaving?"Ativando...":access==="Bloqueado"?"Reativar acesso":"Ativar acesso do aluno"}</button>}{access==="Ativo"&&<button className="gold" disabled>Acesso ativo ✓</button>}<button className={revocationConfirmed?"danger-confirm":"outline"} disabled={(access!=="Convite preparado"&&access!=="Ativo")||accessSaving} onClick={()=>saveAthleteAccess("Bloqueado")}>{accessSaving?"Bloqueando...":revocationConfirmed?"Confirmar bloqueio de "+athlete.name.split(" ")[0]:"Bloquear acesso"}</button>{revocationConfirmed&&<button className="outline" disabled={accessSaving} onClick={()=>{setRevocationConfirmed(false);setAccessMessage("")}}>Cancelar</button>}</div>{accessMessage&&<p className={"access-help "+(revocationConfirmed?"danger-message":"")} role="status">{accessMessage}</p>}<div className="access-notice"><b>{access==="Ativo"?"Área individual ativada.":access==="Bloqueado"?"Entrada bloqueada.":"Nenhum aluno foi liberado ainda."}</b><span>{access==="Ativo"?"O aluno só verá os próprios treinos, provas, zonas e registros. Para trocar o e-mail, bloqueie o acesso primeiro.":access==="Bloqueado"?"O e-mail continua vinculado, mas não consegue entrar até você reativar.":"Prepare o vínculo, confira o e-mail e faça a ativação final."}</span></div><div className="access-audit"><div><span className="overline">REGISTRO DE SEGURANÇA</span><h3>Histórico de acesso</h3><p>Ativações, bloqueios e alterações ficam registradas. Senhas nunca são armazenadas.</p></div>{accessHistory.length===0?<div className="audit-empty">Nenhuma alteração registrada para este aluno.</div>:accessHistory.map(item=><article key={item.id}><span className={`audit-icon ${item.action.includes("bloqueado")?"danger":""}`}>{item.action.includes("bloqueado")?"!":"✓"}</span><div><b>{item.action}</b><small>{new Date(Number(item.created_at)).toLocaleString("pt-BR")} · {item.actor_email}</small><p>{item.previous_status?`${item.previous_status} → ${item.new_status}`:`Status: ${item.new_status}`}</p></div></article>)}</div></section>}
  {tab === "Testes e zonas" && <section className="profile-section athlete-tests"><div className="profile-title"><div><span className="overline">AVALIAÇÕES SALVAS</span><h3>Testes, zonas e Tempo Runs</h3></div><small>{testHistory.length} teste(s)</small></div>{testHistory.length===0?<div className="athlete-tests-empty"><b>Sem teste registrado</b><span>Cadastre o resultado de 3 km ou 5 km para calcular as zonas de {athlete.name.split(" ")[0]}.</span><button className="gold" onClick={()=>window.dispatchEvent(new CustomEvent("zonasapp:open-tests",{detail:athlete.name}))}>Cadastrar teste de {athlete.name.split(" ")[0]} →</button></div>:testHistory.map((test,index)=>{const zones=JSON.parse(test.zones||"[]");const tempos=JSON.parse(test.tempo_runs||"[]");return <article key={test.id} className="athlete-test-card"><header><div><small>{index===0?"TESTE MAIS RECENTE":"HISTÓRICO"} · {test.test_date.split("-").reverse().join("/")}</small><h3>{test.distance_km} km em {duration(test.total_seconds)}</h3></div><span>{test.status}</span></header><div className="athlete-test-metrics"><span><small>VAM</small><b>{Number(test.vam).toFixed(2)} km/h</b></span><span><small>VO₂</small><b>{Number(test.vo2).toFixed(1)}</b></span><span><small>RITMO</small><b>{pace(Number(test.pace_seconds))}</b></span><span><small>FCMÁX</small><b>{test.fc_max} bpm</b></span></div><div className="athlete-zone-list">{zones.map((zone:any)=><span key={zone.z}><b>{zone.z}</b><small>{pace(zone.slow)} – {pace(zone.fast)}</small></span>)}</div><div className="athlete-tempo-list">{tempos.map((tempo:any)=><span key={tempo.label}><small>Tempo Run {tempo.label}</small><b>{pace(tempo.targetPace)}</b></span>)}</div><button className="review-zones-button" onClick={()=>startTestReview(test)}>{test.status==="Aprovado"?"Revisar novamente":"Revisar e aprovar zonas"}</button></article>})}{reviewTestId&&<div className="zone-review-editor"><header><div><span className="overline">REVISÃO DO TREINADOR</span><h3>Ajuste os ritmos antes de aprovar</h3></div><button onClick={()=>setReviewTestId("")}>×</button></header><p>Use o formato min:seg. O primeiro ritmo é o mais lento e o segundo é o mais rápido de cada zona.</p><div className="review-zone-grid">{reviewZones.map((zone,index)=><article key={zone.z}><b>{zone.z}</b><span>{zone.label}</span><label>Mais lento<input value={zone.slow} onChange={e=>setReviewZones(current=>current.map((item,i)=>i===index?{...item,slow:e.target.value}:item))}/></label><label>Mais rápido<input value={zone.fast} onChange={e=>setReviewZones(current=>current.map((item,i)=>i===index?{...item,fast:e.target.value}:item))}/></label></article>)}</div><h4>Tempo Runs</h4><div className="review-tempo-grid">{reviewTempos.map((tempo,index)=><label key={tempo.label}>{tempo.label}<input value={tempo.targetPace} onChange={e=>setReviewTempos(current=>current.map((item,i)=>i===index?{...item,targetPace:e.target.value}:item))}/></label>)}</div>{reviewState==="error"&&<p className="review-error">Confira os ritmos. Exemplo válido: 5:10.</p>}<footer><button className="outline" disabled={reviewState==="saving"} onClick={()=>saveTestReview("review")}>Salvar rascunho</button><button className="gold" disabled={reviewState==="saving"} onClick={()=>saveTestReview("approve")}>{reviewState==="saving"?"Salvando...":"Aprovar e usar nos treinos ✓"}</button></footer></div>}</section>}
  {tab === "Histórico" && <section className="profile-section history-tab"><div className="history-head"><div><span className="overline">ÚLTIMOS RETORNOS REAIS</span><h3>Treinos e feedbacks de {athlete.name.split(" ")[0]}</h3></div>{(historyExecutions.length>0||historyFeedbacks.length>0)&&<button className={handled?"handled":""} onClick={()=>setHandled(true)}>{handled?"Revisado ✓":"Marcar como revisado"}</button>}</div>{historyFeedbacks.map(item=><article key={item.id} className={`history-item ${item.feeling==="Sentiu dor"?"alert-item":""}`}><i>{item.feeling==="Sentiu dor"?"⚠":item.feeling==="Cansado"?"😮‍💨":"🙂"}</i><div><strong>{item.feeling}</strong><small>{item.workout_day||"Treino"} · {new Date(Number(item.created_at)).toLocaleDateString("pt-BR")}</small><p>{item.note||"Feedback enviado pelo aluno após o treino."}</p></div><span>{handled?"REVISADO":item.status?.toUpperCase()||"NOVO"}</span></article>)}{historyExecutions.map(item=><article key={item.id} className="history-item"><i>✓</i><div><strong>{item.classification}</strong><small>{item.workout_day} · semana de {String(item.week_start).split("-").reverse().join("/")}</small><p>Planejado: {item.planned_minutes||"—"} min{item.planned_km?` · ${item.planned_km} km`:""}. Realizado: {item.actual_minutes||"—"} min{item.actual_km?` · ${item.actual_km} km`:""}.</p></div><span>{item.correct_percentage}% CERTO</span></article>)}{historyExecutions.length===0&&historyFeedbacks.length===0&&<div className="feedback-empty">Este aluno ainda não registrou resultados ou feedbacks.</div>}</section>}
  <footer><button className="outline" onClick={close}>Fechar</button><button className="gold" disabled={profileSaving} onClick={saveProfile}>{profileSaving ? "Salvando ficha..." : saved ? "Ficha salva ✓" : "Salvar ficha completa"}</button></footer></aside></div>;
}

function NewAthlete({ close, save }: { close: () => void; save: (athlete: Athlete, details: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState("");
  const [distance, setDistance] = useState("Iniciantes");
  const [days, setDays] = useState(["Seg", "Qua", "Sex"]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [integration, setIntegration] = useState("Garmin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const toggleDay = (day: string) => setDays(days.includes(day) ? days.filter(d => d !== day) : [...days, day]);
  const submit = async () => {
    if (!name.trim()) return;
    const initials = name.trim().split(/\s+/).slice(0,2).map(n => n[0]).join("").toUpperCase();
    const plan=defaultPlanForDistance(distance);
    const totalWeeks:Record<string,number>={"Iniciantes":10,"5 km Bronze":10,"10 km Lion":16,"Meia Start":14,"One Marathon":20};
    setSaving(true); setError("");
    try { await save({ name: name.trim(), initials, distance, plan, phase: distance === "Iniciantes" ? "Adaptação" : "Base", week: `1 de ${totalWeeks[plan]||12}`, next: "Aguardando programação", flag: "Cadastro incompleto" }, { phone, email, trainingDays: days, integration }); }
    catch { setError("Não foi possível salvar agora. Tente novamente."); setSaving(false); }
  };
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}><aside className="drawer new-athlete"><header><div><span className="overline">NOVO ALUNO</span><h2>Cadastro rápido</h2><p>Preencha somente o essencial para começar.</p></div><button onClick={close}>×</button></header><div className="onboarding-progress"><i className="done">1</i><span></span><i>2</i><span></span><i>3</i></div><section className="profile-section"><h3>Dados principais</h3><div className="profile-grid"><label>Nome completo<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome do aluno" autoFocus /></label><label>WhatsApp<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(47) 99999-0000" /></label><label>E-mail<input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="aluno@email.com" /></label><label>Objetivo inicial<select value={distance} onChange={e=>setDistance(e.target.value)}><option>Iniciantes</option><option>5 km</option><option>10 km</option><option value="Meia">Meia maratona</option><option>Maratona</option></select></label></div></section><section className="profile-section"><h3>Dias disponíveis para treinar</h3><p className="helper">O aluno poderá alterar depois.</p><div className="day-picker">{weekDays.map(day=><button key={day} className={days.includes(day)?"selected":""} onClick={()=>toggleDay(day)}>{day}</button>)}</div></section><section className="profile-section"><h3>Integração preferida</h3><div className="integration-picker">{["Strava","Garmin","Amazfit","Apple Saúde / Apple Watch","Preencher depois"].map(item=><button key={item} className={integration===item?"selected":""} onClick={()=>setIntegration(item)}>{item}</button>)}</div></section><div className="invite-note"><b>O que acontece depois?</b><span>O aluno ficará com “cadastro incompleto” até informar prova, recordes e demais dados. Você poderá completar tudo pela ficha dele.</span></div>{error && <div className="save-error">{error}</div>}<footer><button className="outline" onClick={close}>Cancelar</button><button className="gold" disabled={!name.trim() || saving} onClick={submit}>{saving ? "Salvando..." : "Cadastrar aluno →"}</button></footer></aside></div>;
}

function PendingTestCenter({athletes,openCalendar}:{athletes:Athlete[];openCalendar:(name:string)=>void}){
  const [athleteName,setAthleteName]=useState(athletes[0]?.name||"");
  const [tests,setTests]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [reviewTestId,setReviewTestId]=useState("");
  const [reviewZones,setReviewZones]=useState<Array<{z:string;label:string;slow:string;fast:string}>>([]);
  const [reviewTempos,setReviewTempos]=useState<Array<{label:string;targetPace:string;projectedTotal:number}>>([]);
  const [reviewState,setReviewState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  useEffect(()=>{const requested=sessionStorage.getItem("zonasapp:tests-athlete");if(requested&&athletes.some(athlete=>athlete.name===requested)){setAthleteName(requested);sessionStorage.removeItem("zonasapp:tests-athlete")}},[athletes]);
  const loadTests=async(name:string)=>{if(!name){setTests([]);return}setLoading(true);try{const response=await fetch(`/api/performance-tests?athlete=${encodeURIComponent(name)}`);if(!response.ok)throw new Error();const data=await response.json();setTests(data.tests||[])}catch{setTests([])}finally{setLoading(false)}};
  useEffect(()=>{if(!athleteName&&athletes[0]?.name)setAthleteName(athletes[0].name)},[athletes,athleteName]);
  useEffect(()=>{if(athleteName)window.dispatchEvent(new CustomEvent("zonasapp:test-athlete",{detail:athleteName}))},[athleteName]);
  useEffect(()=>{const sync=(event:Event)=>{const name=(event as CustomEvent<string>).detail;if(name&&name!==athleteName)setAthleteName(name)};window.addEventListener("zonasapp:test-athlete",sync);return()=>window.removeEventListener("zonasapp:test-athlete",sync)},[athleteName]);
  useEffect(()=>{loadTests(athleteName);const refresh=()=>loadTests(athleteName);window.addEventListener("zonasapp:test-saved",refresh);return()=>window.removeEventListener("zonasapp:test-saved",refresh)},[athleteName]);
  const startReview=(test:any)=>{const zones=JSON.parse(test.zones||"[]");const tempos=JSON.parse(test.tempo_runs||"[]");setReviewTestId(test.id);setReviewState("idle");setReviewZones(zones.map((zone:any)=>({...zone,slow:paceInput(zone.slow),fast:paceInput(zone.fast)})));setReviewTempos(tempos.map((tempo:any)=>({...tempo,targetPace:paceInput(tempo.targetPace)})));setTimeout(()=>document.querySelector(".test-release-editor")?.scrollIntoView({behavior:"smooth",block:"start"}),0)};
  const saveReview=async(action:"review"|"approve")=>{setReviewState("saving");const zones=reviewZones.map(zone=>({...zone,slow:paceSeconds(zone.slow),fast:paceSeconds(zone.fast)}));const tempoRuns=reviewTempos.map(tempo=>({...tempo,targetPace:paceSeconds(tempo.targetPace)}));try{await api.post("/api/performance-tests",{id:reviewTestId,action,zones,tempoRuns});await loadTests(athleteName);setReviewState("saved");if(action==="approve")setReviewTestId("")}catch{setReviewState("error")}};
  const pending=tests.filter(test=>test.status!=="Aprovado");
  return <><section className="pending-test-center"><header><div><span className="overline">LIBERAÇÃO DAS ZONAS</span><h2>Testes aguardando liberação</h2><p>Revise e aprove aqui. Depois disso, as zonas ficam disponíveis para montar os treinos.</p></div><b>{pending.length} PENDENTE(S)</b></header><label>Aluno<select value={athleteName} onChange={event=>{setAthleteName(event.target.value);setReviewTestId("");setReviewState("idle")}}>{athletes.map(athlete=><option key={athlete.name}>{athlete.name}</option>)}</select></label>{loading?<p>Carregando testes de {athleteName}…</p>:pending.length===0?<div className="pending-test-empty">Nenhum teste de {athleteName||"aluno selecionado"} aguardando liberação.</div>:pending.map(test=><article key={test.id}><div><small>{String(test.test_date).split("-").reverse().join("/")} · {test.distance_km} km</small><strong>{duration(Number(test.total_seconds))}</strong><span>{test.status}</span></div><button className="gold" onClick={()=>startReview(test)}>Revisar e liberar zonas →</button></article>)}</section>{reviewTestId&&<section className="zone-review-editor test-release-editor"><header><div><span className="overline">REVISÃO DO TREINADOR</span><h3>Ajuste e libere as zonas de {athleteName}</h3></div><button onClick={()=>setReviewTestId("")}>×</button></header><p>Confira os ritmos no formato min:seg. Ao aprovar, eles passam a ser usados nos treinos estruturados.</p><div className="review-zone-grid">{reviewZones.map((zone,index)=><article key={zone.z}><b>{zone.z}</b><span>{zone.label}</span><label>Mais lento<input value={zone.slow} onChange={event=>setReviewZones(current=>current.map((item,i)=>i===index?{...item,slow:event.target.value}:item))}/></label><label>Mais rápido<input value={zone.fast} onChange={event=>setReviewZones(current=>current.map((item,i)=>i===index?{...item,fast:event.target.value}:item))}/></label></article>)}</div><h4>Tempo Runs</h4><div className="review-tempo-grid">{reviewTempos.map((tempo,index)=><label key={tempo.label}>{tempo.label}<input value={tempo.targetPace} onChange={event=>setReviewTempos(current=>current.map((item,i)=>i===index?{...item,targetPace:event.target.value}:item))}/></label>)}</div>{reviewState==="error"&&<p className="review-error">Confira os ritmos. Exemplo válido: 5:10.</p>}<footer><button className="outline" disabled={reviewState==="saving"} onClick={()=>saveReview("review")}>Salvar rascunho</button><button className="gold" disabled={reviewState==="saving"} onClick={()=>saveReview("approve")}>{reviewState==="saving"?"Liberando...":"Aprovar e usar nos treinos ✓"}</button></footer></section>}{reviewState==="saved"&&!reviewTestId&&<div className="zones-release-success"><span><b>Zonas liberadas para os treinos de {athleteName} ✓</b><small>Agora monte a semana usando os ritmos individuais aprovados.</small></span><button className="gold" onClick={()=>openCalendar(athleteName)}>Montar treino de {athleteName.split(" ")[0]} →</button></div>}</>;
}

function TestCalculator({ athletes, testDistance, setTestDistance, minutes, setMinutes, seconds, setSeconds, age, setAge, calc }: any) {
  const [athleteName,setAthleteName]=useState(athletes[0]?.name||"");
  const [testDate,setTestDate]=useState(new Date().toISOString().slice(0,10));
  const [saveState,setSaveState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const [saveError,setSaveError]=useState("");
  useEffect(()=>{const sync=(event:Event)=>{const name=(event as CustomEvent<string>).detail;if(name)setAthleteName(name)};window.addEventListener("zonasapp:test-athlete",sync);return()=>window.removeEventListener("zonasapp:test-athlete",sync)},[]);
  const saveTest=async()=>{
    setSaveState("saving");setSaveError("");
    try{
      await api.post("/api/performance-tests",{athleteName,testDate,distanceKm:testDistance,minutes,seconds,age});
      setSaveState("saved");window.dispatchEvent(new CustomEvent("zonasapp:test-athlete",{detail:athleteName}));window.dispatchEvent(new Event("zonasapp:test-saved"));
    }catch(error){setSaveError(describeError(error,"Não foi possível salvar o teste. Confira os dados."));setSaveState("error")}
  };
  return <div className="test-grid"><section className="test-form"><span className="overline">NOVO TESTE</span><h2>Teste de desempenho</h2><p>Informe o resultado. Os cálculos são atualizados imediatamente.</p><label>Aluno<select value={athleteName} onChange={e=>{setAthleteName(e.target.value);setSaveState("idle")}}>{athletes.map((athlete:Athlete)=><option key={athlete.name}>{athlete.name}</option>)}</select></label><label>Data do teste<input type="date" value={testDate} onChange={e=>setTestDate(e.target.value)} /></label><label>Distância do teste<div className="segmented"><button className={testDistance === 3 ? "selected" : ""} onClick={() => setTestDistance(3)}>3 km</button><button className={testDistance === 5 ? "selected" : ""} onClick={() => setTestDistance(5)}>5 km</button></div></label><div className="field-row"><label>Minutos<input type="number" min="5" value={minutes} onChange={e => setMinutes(+e.target.value)} /></label><label>Segundos<input type="number" min="0" max="59" value={seconds} onChange={e => setSeconds(Math.min(59, +e.target.value))} /></label></div><label>Idade do atleta<input type="number" min="10" max="90" value={age} onChange={e => setAge(+e.target.value)} /></label><div className="notice">As zonas de ritmo e os Tempo Runs abaixo são provisórios até a validação do treinador.</div>{saveState==="error"&&<p className="test-save-state error">{saveError||"Não foi possível salvar o teste."}</p>}<button className="gold wide" disabled={!athleteName||saveState==="saving"} onClick={saveTest}>{saveState==="saving"?"Salvando...":saveState==="saved"?"Teste salvo para revisão ✓":"Salvar teste para revisão"}</button></section><section className="test-results"><div className="result-head"><div><span className="overline">RESULTADO CALCULADO · {athleteName||"SELECIONE O ALUNO"}</span><h2>{testDistance} km em {duration(calc.total)}</h2></div><span className="review">AGUARDANDO REVISÃO</span></div><div className="metrics"><article><small>VAM</small><b>{calc.vam.toFixed(2)}</b><span>km/h</span></article><article><small>VO₂ ESTIMADO</small><b>{calc.vo2.toFixed(1)}</b><span>ml/kg/min</span></article><article><small>RITMO DO TESTE</small><b>{pace(calc.paceSeconds)}</b><span>referência principal</span></article><article><small>FCMÁX ESTIMADA</small><b>{calc.fcMax}</b><span>bpm · 220 − idade</span></article></div><h3>Tempo Run por distância</h3><p className="tempo-note">O ritmo desacelera progressivamente conforme a distância aumenta. As referências são estimadas pelo resultado do teste e podem ser ajustadas antes da publicação.</p><div className="tempo-runs">{calc.tempoRuns.map((t: any) => <article key={t.label}><small>TEMPO RUN</small><strong>{t.label}</strong><b>{pace(t.targetPace)}</b><span>tempo previsto {duration(t.projectedTotal)}</span></article>)}</div><div className="zone-box"><header><h3>Zonas de ritmo provisórias</h3><small>Baseadas em percentuais da VAM</small></header>{calc.zones.map((z: any) => <div className="zone" key={z.z}><i className={z.z.toLowerCase()}/><b>{z.z}</b><span>{z.label}</span><strong>{pace(z.slow)} – {pace(z.fast)}</strong></div>)}</div></section></div>;
}

function Calendar() {
  type PlannerAthlete={name:string;plan:string;phase:string;week:string;days:string[];status:string;accessStatus?:string};
  const [plannerAthletes,setPlannerAthletes]=useState<PlannerAthlete[]>([]);
  const [plannerLoading,setPlannerLoading]=useState(true);
  const [plannerError,setPlannerError]=useState(false);
  const [selected,setSelected]=useState("");
  const [released,setReleased]=useState(false);
  const [copied,setCopied]=useState(false);
  const [saveState,setSaveState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const [weekUpdatedAt,setWeekUpdatedAt]=useState(0);
  const [weekHistory,setWeekHistory]=useState<Array<{id:string;actor_email:string;action:string;changed_fields:string;created_at:number}>>([]);
  const [confirmLock,setConfirmLock]=useState(false);
  const [sessions,setSessions]=useState<Record<string,StructuredSession>>({});
  const [drawerDay,setDrawerDay]=useState<string|null>(null);
  const [moveFrom,setMoveFrom]=useState<string|null>(null);
  const [moveTo,setMoveTo]=useState("");
  const [deleteDay,setDeleteDay]=useState<string|null>(null);
  const [weekStart,setWeekStart]=useState(()=>mondayOf(new Date().toISOString().slice(0,10)));
  const [copyState,setCopyState]=useState<"idle"|"loading"|"copied"|"empty"|"error">("idle");
  const [copyOtherOpen,setCopyOtherOpen]=useState(false);
  const [copyOtherAthlete,setCopyOtherAthlete]=useState("Marina Costa");
  const [copyOtherWeek,setCopyOtherWeek]=useState(weekStart);
  const [copyOtherDays,setCopyOtherDays]=useState<string[]>([]);
  const [copyOtherState,setCopyOtherState]=useState<"idle"|"loading"|"copied"|"empty"|"error">("idle");
  const [advanceConfirm,setAdvanceConfirm]=useState(false);
  const [advanceState,setAdvanceState]=useState<"idle"|"saving"|"done"|"error">("idle");
  const [calendarPlanWeek,setCalendarPlanWeek]=useState(1);
  const [replaceBaseConfirm,setReplaceBaseConfirm]=useState(false);
  const [replaceBaseState,setReplaceBaseState]=useState<"idle"|"saving"|"done"|"error">("idle");
  const current=plannerAthletes.find(a=>a.name===selected)||{name:"",plan:"Sem base",phase:"Base",week:"1",days:[] as string[],status:"Sem treino"};
  const planningNumbers=current.week.match(/(\d+)\s+de\s+(\d+)/);const currentPlanningWeek=Number(planningNumbers?.[1]||1);const currentPlanningTotal=Number(planningNumbers?.[2]||trainingPlans.find(plan=>plan.name===current.plan)?.weeks||12);const nextPlanningWeek=Math.min(currentPlanningWeek+1,currentPlanningTotal);
  const statusCounts={missing:plannerAthletes.filter(athlete=>athlete.status==="Sem treino").length,review:plannerAthletes.filter(athlete=>["Rascunho","Revisar"].includes(athlete.status)).length,released:plannerAthletes.filter(athlete=>athlete.status==="Liberada").length};
  const openFirstReview=()=>{const target=plannerAthletes.find(athlete=>["Rascunho","Revisar"].includes(athlete.status));if(!target)return;setSelected(target.name);setReleased(false);setCopied(false);setConfirmLock(false);setDrawerDay(target.days[0]||"TER");setTimeout(()=>document.querySelector(".weekly-planner")?.scrollIntoView({behavior:"smooth",block:"start"}),0)};
  const schedule:Record<string,[string,string]>= {TER:["Intervalado","6 × (1 min Z4 + 2 min Z1)"],QUI:["Tempo Run","3 × 10 min em Z3"],SÁB:["Longão","1h15 progressivo"],SEG:["Leve","40 min em Z1"],QUA:["Intervalado","5 × 800 m Z4"],SEX:["Tempo Run","25 min em Z3"],DOM:["Longão","1h20 em Z2"]};
  const dates=Array.from({length:7},(_,index)=>Number(shiftIsoDate(weekStart,index).slice(8,10)));
  const weekTitle=weekDateLabel(weekStart);
  const labels=["SEG","TER","QUA","QUI","SEX","SÁB","DOM"];
  useEffect(()=>{setCalendarPlanWeek(currentPlanningWeek)},[selected,currentPlanningWeek]);
  useEffect(()=>{const item=document.querySelector(".programming-summary span:nth-child(2)") as HTMLElement|null;if(!item)return;item.setAttribute("role","button");item.setAttribute("tabindex",statusCounts.review?"0":"-1");item.setAttribute("aria-label",statusCounts.review?`Abrir ${statusCounts.review} treino para revisar`:"Nenhum treino para revisar");const open=()=>openFirstReview();const key=(event:KeyboardEvent)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openFirstReview()}};item.addEventListener("click",open);item.addEventListener("keydown",key);return()=>{item.removeEventListener("click",open);item.removeEventListener("keydown",key)}},[statusCounts.review,plannerAthletes]);
  useEffect(()=>{setPlannerLoading(true);Promise.all([fetch("/api/athletes").then(response=>response.ok?response.json():Promise.reject()),fetch(`/api/training-weeks?weekStart=${weekStart}`).then(response=>response.ok?response.json():Promise.reject())]).then(([data,weekData])=>{const weekStatus=new Map((weekData.weeks||[]).map((row:any)=>[row.athlete_name,row.status||"Sem treino"]));const real=(data.athletes||[]).filter((row:any)=>row.access_status!=="Bloqueado").map((row:any)=>({name:row.name,plan:row.saved_plan||defaultPlanForDistance(row.distance),phase:row.planning_phase||row.phase||"Base",week:row.planning_week_number?`${row.planning_week_number} de ${row.planning_total_weeks}`:(row.week||"1"),days:(()=>{try{return JSON.parse(row.training_days||"[]").map((day:string)=>day.trim().toUpperCase())}catch{return[]}})(),status:weekStatus.get(row.name)||"Sem treino",accessStatus:row.access_status||"Não ativado"}));const requested=sessionStorage.getItem("zonasapp:calendar-athlete")||"";sessionStorage.removeItem("zonasapp:calendar-athlete");setPlannerAthletes(real);setSelected(value=>real.some((athlete:PlannerAthlete)=>athlete.name===requested)?requested:real.some((athlete:PlannerAthlete)=>athlete.name===value)?value:(real[0]?.name||""));setPlannerError(false)}).catch(()=>setPlannerError(true)).finally(()=>setPlannerLoading(false))},[weekStart]);
  useEffect(()=>{
    const host=document.querySelector(".programming-status");
    if(!host)return;
    host.querySelector(".week-audit-panel")?.remove();
    const panel=document.createElement("section");panel.className="week-audit-panel";
    const title=document.createElement("div");title.className="week-audit-title";
    const label=document.createElement("small");label.textContent="HISTÓRICO DA SEMANA";
    const heading=document.createElement("b");heading.textContent=`${selected.split(" ")[0]||"Aluno"} · ${weekDateLabel(weekStart)}`;
    title.append(label,heading);panel.appendChild(title);
    const filter=document.createElement("select");filter.className="week-audit-filter";filter.setAttribute("aria-label","Filtrar histórico da semana");
    [["todos","Todas as ações"],["liberacoes","Somente liberações"],["alteracoes","Somente alterações"],["bloqueios","Somente bloqueios"]].forEach(([value,text])=>{const option=document.createElement("option");option.value=value;option.textContent=text;filter.appendChild(option)});
    const exportButton=document.createElement("button");exportButton.type="button";exportButton.className="week-audit-export";exportButton.textContent="Imprimir / salvar em PDF";
    const list=document.createElement("div");list.className="week-audit-list";panel.append(filter,exportButton,list);
    const filteredHistory=(category:string)=>weekHistory.filter(item=>category==="todos"||(category==="liberacoes"&&item.action.toLowerCase().includes("liberada"))||(category==="bloqueios"&&item.action.toLowerCase().includes("trancada"))||(category==="alteracoes"&&!item.action.toLowerCase().includes("liberada")&&!item.action.toLowerCase().includes("trancada"))).slice(0,20);
    const renderHistory=(category:string)=>{
      list.replaceChildren();
      const filtered=filteredHistory(category).slice(0,6);
      if(!filtered.length){const empty=document.createElement("p");empty.textContent=weekHistory.length?"Nenhum registro neste filtro.":"Nenhuma alteração registrada nesta semana.";list.appendChild(empty)}
      filtered.forEach(item=>{
        const article=document.createElement("article");
        const action=document.createElement("b");action.textContent=item.action;
        const meta=document.createElement("small");meta.textContent=`${new Date(Number(item.created_at)).toLocaleString("pt-BR")} · ${item.actor_email}`;
        const detail=document.createElement("span");
        let fields:string[]=[];try{fields=JSON.parse(item.changed_fields||"[]")}catch{}
        const baseChanges=fields.filter(field=>field.startsWith("base:")).map(field=>field.replace("base:","").replace(":",": "));
        detail.textContent=baseChanges.length?baseChanges.join(" · "):fields.length?`Alterado: ${fields.filter(field=>!field.startsWith("base:")).join(", ")}`:"Registro de conferência";
        article.append(action,meta,detail);list.appendChild(article);
      });
    };
    exportButton.addEventListener("click",()=>{
      const records=filteredHistory(filter.value);
      if(!records.length){window.alert("Não há registros neste filtro para exportar.");return}
      const report=window.open("","_blank");if(!report){window.alert("Permita a abertura da janela para gerar o relatório.");return}
      const style=report.document.createElement("style");style.textContent="body{font:14px Arial;color:#171717;margin:36px}header{border-bottom:3px solid #b68b2f;padding-bottom:16px;margin-bottom:22px}h1{margin:0 0 6px}p{color:#555}article{padding:14px 0;border-bottom:1px solid #ccc}article b,article span,article small{display:block}article small{margin:5px 0;color:#555}article span{line-height:1.5}@media print{body{margin:18mm}button{display:none}}";report.document.head.appendChild(style);
      const header=report.document.createElement("header");const title=report.document.createElement("h1");title.textContent="ZonasApp · Histórico da semana";const subtitle=report.document.createElement("p");subtitle.textContent=`${selected} · ${current.plan} · semana ${calendarPlanWeek} de ${currentPlanningTotal} · ${weekDateLabel(weekStart)}`;header.append(title,subtitle);report.document.body.appendChild(header);
      records.forEach(item=>{const article=report.document.createElement("article");const action=report.document.createElement("b");action.textContent=item.action;const meta=report.document.createElement("small");meta.textContent=`${new Date(Number(item.created_at)).toLocaleString("pt-BR")} · ${item.actor_email}`;const detail=report.document.createElement("span");let fields:string[]=[];try{fields=JSON.parse(item.changed_fields||"[]")}catch{}detail.textContent=fields.filter(field=>field.startsWith("base:")).map(field=>field.replace("base:","").replace(":",": ")).join(" · ")||`Campos alterados: ${fields.join(", ")||"registro de conferência"}`;article.append(action,meta,detail);report.document.body.appendChild(article)});
      const note=report.document.createElement("p");note.textContent=`Relatório gerado em ${new Date().toLocaleString("pt-BR")}. Use a opção “Salvar como PDF” na tela de impressão.`;report.document.body.appendChild(note);window.setTimeout(()=>report.print(),250);
    });
    filter.addEventListener("change",()=>renderHistory(filter.value));renderHistory("todos");
    host.appendChild(panel);
    return()=>panel.remove();
  },[weekHistory,selected,weekStart,plannerLoading]);
  useEffect(()=>{
    if(!selected)return;
    setSaveState("idle");
    setReleased(false);setSessions({});setWeekUpdatedAt(0);setMoveFrom(null);setDeleteDay(null);setCopied(false);setCopyState("idle");setAdvanceConfirm(false);setAdvanceState("idle");setReplaceBaseConfirm(false);setReplaceBaseState("idle");
    fetch(`/api/training-weeks?athlete=${encodeURIComponent(selected)}&weekStart=${weekStart}`)
      .then(r=>r.ok?r.json():{week:null,history:[]}).then(async data=>{setWeekHistory(data.history||[]);setPlannerAthletes(list=>list.map(athlete=>athlete.name===selected?{...athlete,status:data.week?.status||"Sem treino"}:athlete));if(data.week){const savedNumber=Number(String(data.week.week_label||"").match(/\d+/)?.[0]);if(savedNumber)setCalendarPlanWeek(savedNumber);setReleased(data.week.status==="Liberada");setWeekUpdatedAt(Number(data.week.updated_at)||0);try{setSessions(JSON.parse(data.week.sessions||"{}"))}catch{setSessions({})}setSaveState("saved")}else{setWeekUpdatedAt(0);setSessions(await sessionsForSavedPlanWeek(current.plan,calendarPlanWeek,current.days));setSaveState("idle")}})
      .catch(()=>undefined);
  },[selected,weekStart,calendarPlanWeek]);
  const saveWeek=async(status:string,auditDifferences:string[]=[])=>{
    setSaveState("saving");
    const weekSessions=Object.fromEntries(current.days.map(day=>[day,sessions[day]||{type:schedule[day]?.[0]||"Treino",description:schedule[day]?.[1]||"A definir"}]));
    try{
      const response=await fetch("/api/training-weeks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:selected,weekStart,plan:current.plan,phase:phaseForPlanWeek(current.plan,calendarPlanWeek),weekLabel:`${calendarPlanWeek} de ${currentPlanningTotal}`,trainingDays:current.days,sessions:weekSessions,status,auditDifferences,expectedUpdatedAt:weekUpdatedAt||undefined})});
      if(!response.ok)throw new Error("save_failed");
      const saved=await response.json();setWeekUpdatedAt(Number(saved.updatedAt)||Date.now());
      const historyResponse=await fetch(`/api/training-weeks?athlete=${encodeURIComponent(selected)}&weekStart=${weekStart}`);if(historyResponse.ok){const data=await historyResponse.json();setWeekHistory(data.history||[])}
      setReleased(status==="Liberada");setPlannerAthletes(list=>list.map(athlete=>athlete.name===selected?{...athlete,status}:athlete));setConfirmLock(false);setSaveState("saved");
      return true;
    }catch{setSaveState("error");return false}
  };
  const changeWeekVisibility=async()=>{
    if(released&&!confirmLock){setConfirmLock(true);return}
    if(!released){
      const incompleteDays=current.days.filter(day=>!sessions[day]||sessions[day].removed||!sessions[day].steps?.length);
      if(incompleteDays.length){
        window.alert(`Complete os treinos estruturados antes de liberar. Falta revisar: ${incompleteDays.join(", ")}.`);
        return;
      }
      const baseSessions=await sessionsForSavedPlanWeek(current.plan,calendarPlanWeek,current.days);
      if(!Object.keys(baseSessions).length){
        window.alert(`Não foi possível conferir a semana ${calendarPlanWeek} da planilha ${current.plan}. Complete a planilha-base antes de liberar.`);
        return;
      }
      const comparison=current.days.map(day=>{
        const planned=baseSessions[day];
        const currentSession=sessions[day];
        if(!currentSession||currentSession.removed)return{day,status:"AUSENTE"};
        return{day,status:JSON.stringify(currentSession)===JSON.stringify(planned)?"IGUAL À BASE":"ALTERADO"};
      });
      const differences=comparison.filter(item=>item.status!=="IGUAL À BASE");
      const comparisonText=comparison.map(item=>`${item.day}: ${item.status}`).join("\n");
      const summary=differences.length?`${differences.length} treino(s) diferente(s) da planilha-base. Confira se as alterações são intencionais.`:"Todos os treinos conferem com a planilha-base.";
      const recentHistory=weekHistory.slice(0,3).map(item=>`${new Date(Number(item.created_at)).toLocaleString("pt-BR")} · ${item.actor_email} · ${item.action}`).join("\n");
      if(!window.confirm(`CONFERÊNCIA AUTOMÁTICA\n\n${selected}\n${current.plan} · semana ${calendarPlanWeek} de ${currentPlanningTotal}\nDatas: ${weekTitle}\n\n${comparisonText}\n\n${summary}${recentHistory?`\n\nHISTÓRICO RECENTE\n${recentHistory}`:""}\n\nLiberar esta semana para o aluno?`))return;
      await saveWeek("Liberada",comparison.map(item=>`${item.day}:${item.status}`));
      return;
    }
    saveWeek("Trancada");
  };
  const openWorkout=(day?:string)=>setDrawerDay(day||current.days[0]||"TER");
  const attachWorkout=(session:StructuredSession)=>{if(!drawerDay)return;setSessions(value=>({...value,[drawerDay]:session}));setReleased(false);setSaveState("idle");setDrawerDay(null)};
  const sessionFor=(day:string):StructuredSession=>sessions[day]||{type:schedule[day]?.[0]||"Treino",description:schedule[day]?.[1]||"A definir"};
  const confirmMove=()=>{if(!moveFrom||!moveTo||moveFrom===moveTo)return;const source=sessionFor(moveFrom);const target=sessionFor(moveTo);setSessions(value=>({...value,[moveTo]:source,[moveFrom]:target}));setReleased(false);setSaveState("idle");setMoveFrom(null);setMoveTo("")};
  const confirmDelete=()=>{if(!deleteDay)return;setSessions(value=>({...value,[deleteDay]:{type:"Descanso",description:"Treino removido pelo treinador",removed:true}}));setReleased(false);setSaveState("idle");setDeleteDay(null)};
  const copyPreviousWeek=async()=>{setCopyState("loading");const previousStart=shiftIsoDate(weekStart,-7);try{const response=await fetch(`/api/training-weeks?athlete=${encodeURIComponent(selected)}&weekStart=${previousStart}`);if(!response.ok)throw new Error("load_failed");const data=await response.json();if(!data.week){setCopyState("empty");return}const previousSessions=JSON.parse(data.week.sessions||"{}");setSessions(previousSessions);setReleased(false);setCopied(true);setSaveState("idle");setCopyState("copied")}catch{setCopyState("error")}};
  const openCopyOther=()=>{const source=plannerAthletes.find(athlete=>athlete.name!==selected)?.name||"";setCopyOtherAthlete(source);setCopyOtherWeek(weekStart);setCopyOtherDays([...current.days]);setCopyOtherState("idle");setCopyOtherOpen(true)};
  const toggleCopyDay=(day:string)=>setCopyOtherDays(days=>days.includes(day)?days.filter(item=>item!==day):[...days,day]);
  const copyFromOtherAthlete=async()=>{if(!copyOtherAthlete||!copyOtherDays.length)return;setCopyOtherState("loading");try{const response=await fetch(`/api/training-weeks?athlete=${encodeURIComponent(copyOtherAthlete)}&weekStart=${copyOtherWeek}`);if(!response.ok)throw new Error("load_failed");const data=await response.json();if(!data.week){setCopyOtherState("empty");return}const sourceSessions=JSON.parse(data.week.sessions||"{}");const copiedEntries=copyOtherDays.filter(day=>sourceSessions[day]).map(day=>[day,sourceSessions[day]]);if(!copiedEntries.length){setCopyOtherState("empty");return}setSessions(value=>({...value,...Object.fromEntries(copiedEntries)}));setReleased(false);setSaveState("idle");setCopyOtherState("copied");setTimeout(()=>setCopyOtherOpen(false),700)}catch{setCopyOtherState("error")}};
  const replaceWithBasePlanWeek=async()=>{if(!replaceBaseConfirm){setReplaceBaseConfirm(true);return}setReplaceBaseState("saving");try{const expected=await sessionsForSavedPlanWeek(current.plan,calendarPlanWeek,current.days);if(!Object.keys(expected).length)throw new Error();const saved=await api.post("/api/training-weeks",{athleteName:selected,weekStart,plan:current.plan,phase:phaseForPlanWeek(current.plan,calendarPlanWeek),weekLabel:`${calendarPlanWeek} de ${currentPlanningTotal}`,trainingDays:current.days,sessions:expected,status:"Rascunho",expectedUpdatedAt:weekUpdatedAt||undefined}) as {updatedAt?:number};setSessions(expected);setReleased(false);setWeekUpdatedAt(Number(saved.updatedAt)||Date.now());setPlannerAthletes(list=>list.map(athlete=>athlete.name===selected?{...athlete,status:"Rascunho"}:athlete));setReplaceBaseConfirm(false);setReplaceBaseState("done");setSaveState("saved")}catch{setReplaceBaseState("error")}};
  const approveWeekAdvance=async()=>{if(!advanceConfirm){setAdvanceConfirm(true);return}setAdvanceState("saving");try{const closed=await saveWeek("Concluída");if(!closed)throw new Error("close_failed");const nextPhase=phaseForPlanWeek(current.plan,nextPlanningWeek);const response=await fetch("/api/athlete-planning",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:selected,plan:current.plan,phase:nextPhase,weekNumber:nextPlanningWeek,totalWeeks:currentPlanningTotal})});if(!response.ok)throw new Error("advance_failed");const nextWeekStart=shiftIsoDate(weekStart,7);const nextSessions=await sessionsForSavedPlanWeek(current.plan,nextPlanningWeek,current.days);const draft=await fetch("/api/training-weeks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName:selected,weekStart:nextWeekStart,plan:current.plan,phase:nextPhase,weekLabel:`${nextPlanningWeek} de ${currentPlanningTotal}`,trainingDays:current.days,sessions:nextSessions,status:"Rascunho"})});if(!draft.ok)throw new Error("draft_failed");setPlannerAthletes(list=>list.map(athlete=>athlete.name===selected?{...athlete,phase:nextPhase,week:`${nextPlanningWeek} de ${currentPlanningTotal}`,status:"Rascunho"}:athlete));setCalendarPlanWeek(nextPlanningWeek);setAdvanceConfirm(false);setAdvanceState("done");setWeekStart(nextWeekStart)}catch{setAdvanceState("error")}};
  if(plannerLoading)return <section className="calendar-empty"><b>Carregando alunos…</b><span>Buscando cadastros e dias disponíveis.</span></section>;
  if(plannerError)return <section className="calendar-empty error"><b>Não foi possível carregar os alunos</b><span>Atualize a página e tente novamente.</span></section>;
  if(!plannerAthletes.length)return <section className="calendar-empty"><b>Nenhum aluno disponível para receber treino</b><span>Cadastre um aluno na aba “Alunos”. Cadastros bloqueados não aparecem aqui.</span></section>;
  const readyWorkoutCount=current.days.filter(day=>sessions[day]&&!sessions[day].removed).length;
  const workflowStep=released?3:readyWorkoutCount===current.days.length&&current.days.length>0?2:1;
  return <><div className="planner-head"><div><span className="overline">PROGRAMAÇÃO SEMANAL</span><h2>Semana de {weekTitle}</h2><p>Escolha o aluno, confira os treinos e libere. A tela mostra exatamente o que falta.</p></div><div className="planner-actions"><button className="outline" disabled={copyState==="loading"} onClick={copyPreviousWeek}>{copyState==="loading"?"Buscando semana anterior...":copied?"Semana anterior copiada ✓":"Copiar semana anterior"}</button><button className={replaceBaseConfirm?"danger-confirm":"outline"} disabled={replaceBaseState==="saving"} onClick={replaceWithBasePlanWeek}>{replaceBaseState==="saving"?"Carregando…":replaceBaseConfirm?`Confirmar semana ${calendarPlanWeek}`:`Usar semana ${calendarPlanWeek} da planilha-base`}</button><button className="gold" onClick={()=>openWorkout()}>+ Montar treino do zero</button></div></div><section className="week-navigator"><button onClick={()=>{setCalendarPlanWeek(value=>Math.max(1,value-1));setWeekStart(value=>shiftIsoDate(value,-7))}}>← Semana {Math.max(1,calendarPlanWeek-1)}</button><label>Semana {calendarPlanWeek} de {currentPlanningTotal}<input aria-label="Escolher data da semana" type="date" value={weekStart} onChange={e=>{if(!e.target.value)return;const target=mondayOf(e.target.value);const delta=Math.round((new Date(`${target}T12:00:00`).getTime()-new Date(`${weekStart}T12:00:00`).getTime())/604800000);setCalendarPlanWeek(value=>Math.min(currentPlanningTotal,Math.max(1,value+delta)));setWeekStart(target)}}/></label><button onClick={()=>{setCalendarPlanWeek(value=>Math.min(currentPlanningTotal,value+1));setWeekStart(value=>shiftIsoDate(value,7))}}>Semana {Math.min(currentPlanningTotal,calendarPlanWeek+1)} →</button></section><section className="coach-week-guide"><header><div><span className="overline">FLUXO RÁPIDO</span><h3>Prepare a semana em 3 passos</h3></div><b>{released?"PRONTO PARA O ALUNO":`${readyWorkoutCount}/${current.days.length} TREINOS PRONTOS`}</b></header><div>{[{number:1,title:"Aluno e semana",detail:`${selected.split(" ")[0]} · semana ${calendarPlanWeek}`,done:workflowStep>1},{number:2,title:"Conferir treinos",detail:`${readyWorkoutCount} de ${current.days.length} dias prontos`,done:workflowStep>2},{number:3,title:"Liberar ao aluno",detail:released?"Aluno já pode visualizar":"Só aparece depois de liberar",done:released}].map(step=><article key={step.number} className={`${step.done?"done":""} ${workflowStep===step.number?"active":""}`}><i>{step.done?"✓":step.number}</i><span><b>{step.title}</b><small>{step.detail}</small></span></article>)}</div></section>{copyState==="empty"&&<div className="copy-week-message empty">Nenhuma programação foi encontrada na semana anterior deste aluno.</div>}{copyState==="error"&&<div className="copy-week-message error">Não foi possível buscar a semana anterior. Tente novamente.</div>}{copyState==="copied"&&<div className="copy-week-message success">Treinos copiados para esta semana como rascunho. Revise os dias antes de salvar.</div>}{replaceBaseConfirm&&<div className="base-week-replace-confirm"><div><b>Substituir os treinos atuais pela semana {calendarPlanWeek} da planilha {current.plan}?</b><span>A semana ficará como rascunho. O aluno deixará de ver a versão anterior até você revisar e liberar novamente.</span></div><button className="outline" onClick={()=>{setReplaceBaseConfirm(false);setReplaceBaseState("idle")}}>Cancelar</button></div>}{replaceBaseState==="done"&&<div className="copy-week-message success">Semana {calendarPlanWeek} correta carregada da planilha-base como rascunho ✓</div>}{replaceBaseState==="error"&&<div className="copy-week-message error">Não foi possível carregar esta semana da planilha-base.</div>}<section className="planner-layout"><div className="weekly-planner"><div className="athlete-week-head"><label>Aluno<select value={selected} onChange={e=>{setSelected(e.target.value);setReleased(false);setCopied(false);setConfirmLock(false)}}>{plannerAthletes.map(a=><option key={a.name}>{a.name}</option>)}</select></label><div><small>PLANILHA-BASE</small><b>{current.plan}</b></div><div><small>FASE E SEMANA</small><b>{phaseForPlanWeek(current.plan,calendarPlanWeek)} · {calendarPlanWeek} de {currentPlanningTotal}</b></div><span className={released?"week-released":"week-draft"}>{released?"SEMANA LIBERADA":"AGUARDANDO LIBERAÇÃO"}</span></div><div className="available-note"><b>Dias disponíveis: {current.days.join(", ")}</b><span>{current.days.length===3?"Treinos prioritários mantidos: intervalado/ritmo, Tempo Run e longão.":"Programação completa da planilha-base."}</span></div><div className="week">{labels.map((day,i)=>{const fallback=current.days.includes(day)?schedule[day]:undefined;const workout=sessions[day];return <article key={day} className={current.days.includes(day)?"available-day":""}><header><small>{day}</small><b>{dates[i]}</b></header>{current.days.includes(day)?workout?.removed?<div className="session removed-session-card"><small>DESCANSO</small><b>Treino removido</b><span>Este dia ficará sem treino após salvar.</span><button onClick={()=>openWorkout(day)}>Adicionar novo treino</button></div>:<div className="session"><small>{workout?.type||fallback?.[0]||"Treino"}</small><b>{workout?.title||workout?.description||fallback?.[1]||"Adicionar treino"}</b><span>{workout?.steps?.length?`${workout.steps.length} etapas estruturadas · pronto para salvar`:"Ritmos individuais do aluno"}</span><div className="session-actions"><button onClick={()=>openWorkout(day)}>Abrir treino completo</button><button onClick={()=>{setMoveFrom(day);setMoveTo(current.days.find(item=>item!==day)||"")}}>Mover</button><button className="delete" onClick={()=>setDeleteDay(day)}>Excluir</button></div></div>:<p>INDISPONÍVEL</p>}</article>})}</div>{saveState!=="idle"&&<div className={`week-save-state ${saveState}`}>{saveState==="saving"?"Salvando programação...":saveState==="saved"?"Programação salva com segurança ✓":"Não foi possível salvar. Tente novamente."}</div>}{moveFrom&&<div className="week-action-confirm"><div><b>Mover treino de {moveFrom}</b><span>Se o destino já tiver treino, os dois trocarão de dia.</span></div><label>Novo dia<select value={moveTo} onChange={e=>setMoveTo(e.target.value)}>{current.days.filter(day=>day!==moveFrom).map(day=><option key={day}>{day}</option>)}</select></label><button className="outline" onClick={()=>{setMoveFrom(null);setMoveTo("")}}>Cancelar</button><button className="gold" onClick={confirmMove}>Confirmar troca</button></div>}{deleteDay&&<div className="week-action-confirm delete-confirm"><div><b>Excluir o treino de {deleteDay}?</b><span>Ele será retirado do rascunho. O aluno só verá a mudança depois de salvar e liberar.</span></div><button className="outline" onClick={()=>setDeleteDay(null)}>Cancelar</button><button className="danger-confirm" onClick={confirmDelete}>Confirmar exclusão</button></div>}{advanceConfirm&&<div className="advance-confirm" role="alert"><div><b>Avançar {selected.split(" ")[0]} para a semana {nextPlanningWeek}?</b><span>Os treinos próprios da semana seguinte serão carregados como rascunho. Revise e libere somente quando estiver correto.</span></div><button className="outline" onClick={()=>{setAdvanceConfirm(false);setAdvanceState("idle")}}>Cancelar</button></div>}{advanceState==="error"&&<div className="advance-error">Não foi possível avançar a semana. Tente novamente.</div>}{confirmLock&&<div className="sensitive-confirm" role="alert"><div><b>Trancar a semana de {selected}?</b><span>Os treinos deixarão de aparecer imediatamente na área do aluno.</span></div><button className="outline" onClick={()=>setConfirmLock(false)}>Cancelar</button></div>}<div className="planner-footer"><div><b>{current.days.length} treinos programados</b><span>{current.days.length===3?"1 treino complementar retirado automaticamente.":"Todos os treinos-base foram mantidos."}</span></div><div className="week-actions">{released&&currentPlanningWeek<currentPlanningTotal&&<button className={advanceConfirm?"advance-ready":"outline"} disabled={advanceState==="saving"} onClick={approveWeekAdvance}>{advanceState==="saving"?"Avançando...":advanceConfirm?"Confirmar avanço autorizado":`Avançar para semana ${nextPlanningWeek}`}</button>}<button className="outline" onClick={()=>saveWeek("Rascunho")}>Salvar rascunho</button><button className={confirmLock?"danger-confirm":released?"outline":"gold"} disabled={saveState==="saving"} onClick={changeWeekVisibility}>{confirmLock?"Confirmar: trancar semana":released?"Trancar semana":"Liberar semana para o aluno →"}</button></div></div></div><aside className="programming-status"><header><span className="overline">CONTROLE RÁPIDO</span><h3>Alunos desta semana</h3><p>Veja quem ainda precisa receber treino.</p></header>{plannerAthletes.map(a=><button key={a.name} className={selected===a.name?"selected":""} onClick={()=>{setSelected(a.name);setReleased(a.status==="Liberada");setCopied(false);setConfirmLock(false)}}><span><b>{a.name}</b><small>{a.plan} · {a.week}</small></span><em className={a.status==="Sem treino"?"missing":a.status==="Revisar"?"review":a.status==="Liberada"?"released":"ready"}>{a.status}</em></button>)}<div className="programming-summary"><span><b>{statusCounts.missing}</b> sem treino</span><span><b>{statusCounts.review}</b> para revisar</span><span><b>{statusCounts.released}</b> liberada(s)</span></div><button className="copy-athlete" onClick={openCopyOther}>Copiar treino de outro aluno</button></aside></section>{copyOtherOpen&&<div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&setCopyOtherOpen(false)}><aside className="drawer copy-workout-drawer"><header><div><span className="overline">COPIAR ENTRE ALUNOS</span><h2>Escolha a origem dos treinos</h2><p>Destino: {selected} · semana de {weekTitle}</p></div><button onClick={()=>setCopyOtherOpen(false)}>×</button></header><label>Aluno de origem<select value={copyOtherAthlete} onChange={e=>{setCopyOtherAthlete(e.target.value);setCopyOtherState("idle")}}>{plannerAthletes.filter(athlete=>athlete.name!==selected).map(athlete=><option key={athlete.name}>{athlete.name}</option>)}</select></label><label>Semana de origem<input type="date" value={copyOtherWeek} onChange={e=>e.target.value&&setCopyOtherWeek(mondayOf(e.target.value))}/></label><section><small>DIAS QUE SERÃO COPIADOS</small><div className="copy-day-picker">{current.days.map(day=><button key={day} className={copyOtherDays.includes(day)?"selected":""} onClick={()=>toggleCopyDay(day)}>{day}</button>)}</div><p>Somente os dias marcados serão substituídos. Os demais treinos de {selected.split(" ")[0]} permanecerão como estão.</p></section>{copyOtherState==="empty"&&<div className="copy-other-message">Nenhum treino foi encontrado nos dias escolhidos dessa semana.</div>}{copyOtherState==="error"&&<div className="copy-other-message error">Não foi possível buscar os treinos. Tente novamente.</div>}{copyOtherState==="copied"&&<div className="copy-other-message success">Treinos copiados para o rascunho ✓</div>}<footer><button className="outline" onClick={()=>setCopyOtherOpen(false)}>Cancelar</button><button className="gold" disabled={!copyOtherDays.length||copyOtherState==="loading"} onClick={copyFromOtherAthlete}>{copyOtherState==="loading"?"Buscando treinos...":"Copiar dias escolhidos →"}</button></footer></aside></div>}{drawerDay&&<WorkoutDrawer close={()=>setDrawerDay(null)} athleteName={selected} day={drawerDay} initial={sessions[drawerDay]} weekLabel={weekTitle} onSave={attachWorkout}/>}</>
}

function Races({races,onChange}:{races:any[];onChange:(races:any[])=>void}) {
  const [saving,setSaving]=useState("");const [error,setError]=useState("");
  const review=async(race:any,status:string,priority:string)=>{setSaving(race.id);setError("");try{await api.post("/api/races-records",{action:"review_race",id:race.id,status,priority});onChange(races.map(item=>item.id===race.id?{...item,status,priority}:item))}catch{setError(race.id)}finally{setSaving("")}};
  return <><div className="section-title"><div><small>PLANEJAMENTO REAL</small><h2>Provas dos alunos</h2><p>Analise cada prova e defina a importância no planejamento.</p></div><b>{races.length} cadastrada(s)</b></div>{races.length===0?<section className="calendar-empty"><b>Nenhuma prova cadastrada</b><span>Quando o aluno enviar uma prova, ela aparecerá aqui para sua análise.</span></section>:<section className="race-cards">{races.map(race=><article key={race.id}><span className={`pill ${race.status==="Aguardando análise"?"alert":""}`}>{race.status}</span><small>{new Date(`${race.race_date}T12:00:00`).toLocaleDateString("pt-BR")}</small><h3>{race.name}</h3><p>{race.athlete_name} · {race.distance}{race.city?` · ${race.city}`:""}</p>{race.goal&&<blockquote>Objetivo: {race.goal}</blockquote>}<label>Importância<select value={race.priority||"Prova A"} onChange={event=>onChange(races.map(item=>item.id===race.id?{...item,priority:event.target.value}:item))}><option>Prova A</option><option>Prova B</option><option>Treino</option></select></label><div>{race.status==="Aprovada"
              ? <button className="race-cancel" disabled={saving===race.id} onClick={()=>review(race,"Aguardando análise",race.priority||"Prova A")}>{saving===race.id?"Salvando…":"Cancelar aprovação"}</button>
              : <><button className="gold" disabled={saving===race.id} onClick={()=>review(race,"Aprovada",race.priority||"Prova A")}>{saving===race.id?"Salvando…":"Aprovar e usar no planejamento"}</button>{race.status!=="Descartada"&&<button className="outline" disabled={saving===race.id} onClick={()=>review(race,"Descartada",race.priority||"Treino")}>Não periodizar</button>}</>}</div>{error===race.id&&<small className="registration-error">Não foi possível salvar. Tente novamente.</small>}</article>)}</section>}</>;
}

function WorkoutDrawer({ close, athleteName, day, initial, weekLabel, onSave }: { close: () => void; athleteName:string; day:string; initial?:StructuredSession; weekLabel:string; onSave:(session:StructuredSession)=>void }) {
  type TimedStep = { id:number; minutes:number; zone:string; label:string };
  type StepUnit = "s"|"min"|"m";
  type ExtraStep = { id:number; amount:number; unit:StepUnit; zone:string; label:string };
  type RepeatStep = { id:number; repetitions:number; effort:number; effortUnit:StepUnit; effortZone:string; recovery:number; recoveryUnit:"s"|"min"; recoveryZone:string };
  const initialSteps=Array.isArray(initial?.steps)?initial.steps:[];
  const initialSimple=initialSteps.filter((step:any)=>step?.kind==="simple");
  const initialRepeats=initialSteps.filter((step:any)=>step?.kind==="repeat");
  const savedWarmup=initialSimple.find((step:any)=>step.label==="Aquecimento");
  const savedCooldown=initialSimple.find((step:any)=>step.label==="Desaquecimento");
  const [warmup,setWarmup]=useState<TimedStep>(savedWarmup?{id:1,minutes:Number(savedWarmup.minutes)||15,zone:savedWarmup.zone||"Z2",label:"Aquecimento"}:{id:1,minutes:15,zone:"Z2",label:"Aquecimento"});
  const [cooldown,setCooldown]=useState<TimedStep>(savedCooldown?{id:2,minutes:Number(savedCooldown.minutes)||10,zone:savedCooldown.zone||"Z1",label:"Desaquecimento"}:{id:2,minutes:10,zone:"Z1",label:"Desaquecimento"});
  const [extraSteps,setExtraSteps]=useState<ExtraStep[]>(initialSimple.filter((step:any)=>!["Aquecimento","Desaquecimento"].includes(step.label)).map((step:any,index:number)=>({id:100+index,amount:Number(step.distanceMeters||step.seconds||step.minutes)||10,unit:step.distanceMeters?"m":step.seconds?"s":"min",zone:step.zone||"Z2",label:step.label||"Passo adicional"})));
  const [repeatSteps,setRepeatSteps]=useState<RepeatStep[]>(initialRepeats.map((step:any,index:number)=>({id:200+index,repetitions:Number(step.repetitions)||1,effort:Number(step.effortMeters||step.effortSeconds||step.effortMinutes)||1,effortUnit:step.effortMeters?"m":step.effortSeconds?"s":"min",effortZone:step.effortZone||"Z4",recovery:Number(step.recoverySeconds||step.recoveryMinutes)||1,recoveryUnit:step.recoverySeconds?"s":"min",recoveryZone:step.recoveryZone||"Z1"})));
  const [tempoRun,setTempoRun]=useState(initial?.tempoRun||"Nenhum");
  const [name,setName]=useState(initial?.title||"Intervalado por distância");
  const [instructions,setInstructions]=useState((initial as any)?.instructions||"");
  const [writtenWorkout,setWrittenWorkout]=useState("");
  const [conversionMessage,setConversionMessage]=useState("");
  const [approvedRefs,setApprovedRefs]=useState<Record<string,string>|null>(null);
  const [approvedPaceMid,setApprovedPaceMid]=useState<Record<string,number>|null>(null);
  const [approvedTempoRefs,setApprovedTempoRefs]=useState<Record<string,string>>({});
  const [approvedTempoPaces,setApprovedTempoPaces]=useState<Record<string,number>>({});
  const [zoneStatus,setZoneStatus]=useState<"loading"|"approved"|"pending"|"error">("loading");
  const [selectedQuickModel,setSelectedQuickModel]=useState("");
  const [compactMobile,setCompactMobile]=useState(true);
  const [saveWarning,setSaveWarning]=useState("");
  const references:Record<string,Record<string,string>>={
    "Everton Barbosa":{Z1:"4:25–4:55/km · 132–148 bpm",Z2:"3:58–4:24/km · 145–158 bpm",Z3:"3:36–3:57/km · 157–170 bpm",Z4:"3:22–3:35/km · 171–181 bpm",Z5:"2:59–3:21/km · 182–194 bpm"},
    "Marina Costa":{Z1:"6:05–6:40/km · 128–143 bpm",Z2:"5:30–6:04/km · 140–154 bpm",Z3:"4:56–5:29/km · 153–164 bpm",Z4:"4:38–4:55/km · 165–177 bpm",Z5:"4:10–4:37/km · 178–190 bpm"},
    "João Ribeiro":{Z1:"5:20–5:55/km · 130–146 bpm",Z2:"4:45–5:19/km · 143–157 bpm",Z3:"4:19–4:44/km · 156–168 bpm",Z4:"4:02–4:18/km · 169–180 bpm",Z5:"3:38–4:01/km · 181–193 bpm"},
  };
  const paceMid:Record<string,Record<string,number>>={"Everton Barbosa":{Z1:280,Z2:251,Z3:226,Z4:209,Z5:190},"Marina Costa":{Z1:382,Z2:347,Z3:313,Z4:286,Z5:264},"João Ribeiro":{Z1:337,Z2:302,Z3:271,Z4:250,Z5:230}};
  useEffect(()=>{setApprovedRefs(null);setApprovedPaceMid(null);setApprovedTempoRefs({});setApprovedTempoPaces({});setSaveWarning("");setZoneStatus("loading");fetch(`/api/performance-tests?athlete=${encodeURIComponent(athleteName)}`).then(response=>response.ok?response.json():Promise.reject()).then(data=>{const approved=data.tests?.find((test:any)=>test.status==="Aprovado");if(!approved){setZoneStatus("pending");return}const zones=JSON.parse(approved.zones||"[]");const tempos=JSON.parse(approved.tempo_runs||"[]");setApprovedRefs(Object.fromEntries(zones.map((zone:any)=>[zone.z,`${paceInput(zone.slow)}–${paceInput(zone.fast)}/km · zona aprovada`])));setApprovedPaceMid(Object.fromEntries(zones.map((zone:any)=>[zone.z,(Number(zone.slow)+Number(zone.fast))/2])));setApprovedTempoRefs(Object.fromEntries(tempos.map((tempo:any)=>[`Tempo Run ${tempo.label}`,`${paceInput(tempo.targetPace)}/km · ritmo individual aprovado`])));setApprovedTempoPaces(Object.fromEntries(tempos.map((tempo:any)=>[`Tempo Run ${tempo.label}`,Number(tempo.targetPace)])));setZoneStatus("approved")}).catch(()=>setZoneStatus("error"))},[athleteName]);
  const pendingRefs={Z1:"Zona ainda não aprovada",Z2:"Zona ainda não aprovada",Z3:"Zona ainda não aprovada",Z4:"Zona ainda não aprovada",Z5:"Zona ainda não aprovada"};
  const ref={...(approvedRefs||references[athleteName]||pendingRefs),...approvedTempoRefs};
  const paceReference={...(approvedPaceMid||paceMid[athleteName]||{}),...approvedTempoPaces};
  const intensities=["Z1","Z2","Z3","Z4","Z5","Tempo Run 5 km","Tempo Run 10 km","Tempo Run Meia maratona","Tempo Run Maratona"];
  const amountText=(amount:number,unit:StepUnit)=>unit==="m"?`${amount} m`:unit==="s"?`${amount} s`:`${amount} min`;
  const minutesFor=(amount:number,unit:StepUnit,intensity:string)=>unit==="min"?amount:unit==="s"?amount/60:(amount/1000*(paceReference[intensity]||300))/60;
  const kmFor=(amount:number,unit:StepUnit,intensity:string)=>unit==="m"?amount/1000:(unit==="s"?amount:amount*60)/(paceReference[intensity]||300);
  const total=warmup.minutes+cooldown.minutes+extraSteps.reduce((sum,step)=>sum+minutesFor(step.amount,step.unit,step.zone),0)+repeatSteps.reduce((sum,step)=>sum+step.repetitions*(minutesFor(step.effort,step.effortUnit,step.effortZone)+minutesFor(step.recovery,step.recoveryUnit,step.recoveryZone)),0);
  const estimatedKm=kmFor(warmup.minutes,"min",warmup.zone)+kmFor(cooldown.minutes,"min",cooldown.zone)+extraSteps.reduce((sum,step)=>sum+kmFor(step.amount,step.unit,step.zone),0)+repeatSteps.reduce((sum,step)=>sum+step.repetitions*(kmFor(step.effort,step.effortUnit,step.effortZone)+kmFor(step.recovery,step.recoveryUnit,step.recoveryZone)),0);
  const selectedIntensities=[warmup.zone,cooldown.zone,...extraSteps.map(step=>step.zone),...repeatSteps.flatMap(step=>[step.effortZone,step.recoveryZone])];
  const missingTempoRun=selectedIntensities.find(intensity=>intensity.startsWith("Tempo Run")&&!approvedTempoRefs[intensity]);
  const hasMainBlock=repeatSteps.length>0||extraSteps.length>0;
  const completeParts=[{label:"Aquecimento",ready:warmup.minutes>0},{label:"Parte principal",ready:hasMainBlock},{label:"Recuperações",ready:repeatSteps.length===0||repeatSteps.every(step=>step.recovery>0)},{label:"Desaquecimento",ready:cooldown.minutes>0}];
  useEffect(()=>{if(saveWarning)window.alert(saveWarning)},[saveWarning]);
  const changeRepeat=(id:number,patch:Partial<RepeatStep>)=>setRepeatSteps(current=>current.map(step=>step.id===id?{...step,...patch}:step));
  const changeExtra=(id:number,patch:Partial<ExtraStep>)=>setExtraSteps(current=>current.map(step=>step.id===id?{...step,...patch}:step));
  const applyQuickModel=(model:"leve"|"intervalado"|"tempo"|"longao")=>{
    setSelectedQuickModel(model);
    setTempoRun("Nenhum");
    if(model==="leve"){setName("Rodagem leve");setWarmup({...warmup,minutes:5,zone:"Z1"});setRepeatSteps([]);setExtraSteps([{id:Date.now(),amount:30,unit:"min",zone:"Z2",label:"Corrida contínua"}]);setCooldown({...cooldown,minutes:5,zone:"Z1"})}
    if(model==="intervalado"){setName("Intervalado 6 × 1 minuto");setWarmup({...warmup,minutes:10,zone:"Z1"});setRepeatSteps([{id:Date.now(),repetitions:6,effort:1,effortUnit:"min",effortZone:"Z4",recovery:2,recoveryUnit:"min",recoveryZone:"Z1"}]);setExtraSteps([]);setCooldown({...cooldown,minutes:10,zone:"Z1"})}
    if(model==="tempo"){setName("Tempo Run");setWarmup({...warmup,minutes:10,zone:"Z1"});setRepeatSteps([]);setExtraSteps([{id:Date.now(),amount:20,unit:"min",zone:"Z3",label:"Tempo Run"}]);setCooldown({...cooldown,minutes:10,zone:"Z1"})}
    if(model==="longao"){setName("Longão");setWarmup({...warmup,minutes:10,zone:"Z1"});setRepeatSteps([]);setExtraSteps([{id:Date.now(),amount:70,unit:"min",zone:"Z2",label:"Parte principal"}]);setCooldown({...cooldown,minutes:10,zone:"Z1"})}
  };
  const convertWrittenWorkout=()=>{
    const parsed=parseWrittenWorkout(writtenWorkout);
    if(parsed.error){setConversionMessage(parsed.error);return}
    const simple=parsed.blocks.filter((block):block is Extract<ParsedWorkoutBlock,{kind:"simple"}>=>block.kind==="simple");
    const repeats=parsed.blocks.filter((block):block is Extract<ParsedWorkoutBlock,{kind:"repeat"}>=>block.kind==="repeat");
    const firstSimple=simple[0];const lastSimple=simple.length>1?simple[simple.length-1]:undefined;
    const explicitWarmup=simple.find(block=>block.label==="Aquecimento")||firstSimple;
    const explicitCooldown=simple.find(block=>block.label==="Desaquecimento")||lastSimple;
    if(explicitWarmup)setWarmup({...warmup,minutes:explicitWarmup.unit==="min"?explicitWarmup.amount:Math.max(1,Math.round(minutesFor(explicitWarmup.amount,explicitWarmup.unit,explicitWarmup.zone))),zone:explicitWarmup.zone});
    if(explicitCooldown)setCooldown({...cooldown,minutes:explicitCooldown.unit==="min"?explicitCooldown.amount:Math.max(1,Math.round(minutesFor(explicitCooldown.amount,explicitCooldown.unit,explicitCooldown.zone))),zone:explicitCooldown.zone});
    const used=new Set([explicitWarmup,explicitCooldown]);
    setExtraSteps(simple.filter(block=>!used.has(block)).map((block,index)=>({id:Date.now()+index,amount:block.amount,unit:block.unit,zone:block.zone,label:block.label==="Parte principal"?"Corrida contínua":block.label})));
    setRepeatSteps(repeats.map((block,index)=>({id:Date.now()+100+index,repetitions:block.repetitions,effort:block.effort,effortUnit:block.effortUnit,effortZone:block.effortZone,recovery:block.recovery,recoveryUnit:block.recoveryUnit,recoveryZone:block.recoveryZone})));
    setName(repeats.length?"Treino intervalado estruturado":"Treino contínuo estruturado");
    setConversionMessage(`${parsed.blocks.length} etapas reconhecidas. Confira abaixo antes de usar no dia.`);
  };
  const saveStructured=()=>{if(!hasMainBlock){setSaveWarning("Adicione a parte principal antes de concluir o treino.");return}if(missingTempoRun){setSaveWarning(`Este aluno ainda não tem ${missingTempoRun} aprovado. Aprove o teste antes de usar esse ritmo.`);return}setSaveWarning("");const repetitions=repeatSteps.reduce((sum,step)=>sum+step.repetitions,0);onSave({type:"Treino estruturado",title:name.trim()||"Treino por etapas",description:repetitions?`${repetitions} repetições · ${Math.round(total)} min`:`Treino contínuo · ${Math.round(total)} min`,tempoRun,durationMinutes:Math.round(total),estimatedKm:Number(estimatedKm.toFixed(1)),instructions:instructions.trim(),steps:[...(warmup.minutes?[{kind:"simple",label:"Aquecimento",minutes:warmup.minutes,zone:warmup.zone,pace:ref[warmup.zone]}]:[]),...repeatSteps.map(step=>({kind:"repeat",label:"Série principal",repetitions:step.repetitions,...(step.effortUnit==="m"?{effortMeters:step.effort}:step.effortUnit==="s"?{effortSeconds:step.effort}:{effortMinutes:step.effort}),effortZone:step.effortZone,effortPace:ref[step.effortZone],...(step.recoveryUnit==="s"?{recoverySeconds:step.recovery}:{recoveryMinutes:step.recovery}),recoveryZone:step.recoveryZone,recoveryPace:ref[step.recoveryZone]})),...extraSteps.map(step=>({kind:"simple",label:step.label,...(step.unit==="m"?{distanceMeters:step.amount}:step.unit==="s"?{seconds:step.amount}:{minutes:step.amount}),zone:step.zone,pace:ref[step.zone]})),...(cooldown.minutes?[{kind:"simple",label:"Desaquecimento",minutes:cooldown.minutes,zone:cooldown.zone,pace:ref[cooldown.zone]}]:[])]} as any)};
  const intensityOptions=intensities.map(value=><option key={value}>{value}</option>);
  return <div className="overlay" onMouseDown={event=>event.target===event.currentTarget&&close()}><aside className={`drawer workout-drawer ${compactMobile?"mobile-compact":"mobile-detailed"}`}>
    <header><div><span className="overline">TREINO DE {athleteName.toUpperCase()} · {day}</span><h2>{initial?.steps?.length?"Editar treino por etapas":"Montar treino por etapas"}</h2><p>Escolha minutos ou metros. O aluno receberá os passos exatamente nesta ordem.</p></div><div className="drawer-header-actions"><button className="mobile-editor-toggle" onClick={()=>setCompactMobile(value=>!value)}>{compactMobile?"Editar detalhes":"Edição rápida"}</button><button onClick={close} aria-label="Fechar">×</button></div></header>
    <div className="workout-target"><b>{athleteName}</b><span>{day} · Semana de {weekLabel}</span></div>
    <section className="mobile-workout-summary"><div><small>TREINO ATUAL</small><b>{name}</b><span>{Math.round(total)} min · {repeatSteps.length+extraSteps.length+2} etapas</span></div><strong className={`zone-${zoneStatus}`}>{zoneStatus==="approved"?"ZONAS OK ✓":zoneStatus==="pending"?"ZONAS PENDENTES":zoneStatus==="loading"?"CONFERINDO ZONAS":"VERIFICAR ZONAS"}</strong></section>
    <section className="written-workout-converter"><span className="overline">TRANSFORMAR TREINO ESCRITO</span><h3>Cole o treino e monte as etapas automaticamente</h3><p>Exemplo: 15 min Z1 + 6 x 1 min Z4 / 1 min Z1 + 10 min Z1</p><textarea value={writtenWorkout} onChange={event=>{setWrittenWorkout(event.target.value);setConversionMessage("")}} placeholder="Cole aqui o treino completo..."/><button onClick={convertWrittenWorkout}>Transformar em etapas ↓</button>{conversionMessage&&<small className={conversionMessage.startsWith("Não")||conversionMessage.startsWith("Digite")?"error":"success"}>{conversionMessage}</small>}</section>
    <section className="quick-workout-models"><span className="overline">MODELOS OPCIONAIS</span><h3>{selectedQuickModel?"Modelo aplicado ao treino abaixo ✓":"Toque somente se quiser substituir o treino abaixo"}</h3><p>{selectedQuickModel?"As etapas foram trocadas. Confira e ajuste antes de atualizar.":"O treino que já estava salvo continua abaixo até você escolher um destes modelos."}</p><div><button className={selectedQuickModel==="leve"?"selected":""} onClick={()=>applyQuickModel("leve")}>Rodagem leve</button><button className={selectedQuickModel==="intervalado"?"selected":""} onClick={()=>applyQuickModel("intervalado")}>6 × 1 min Z4</button><button className={selectedQuickModel==="tempo"?"selected":""} onClick={()=>applyQuickModel("tempo")}>Tempo Run</button><button className={selectedQuickModel==="longao"?"selected":""} onClick={()=>applyQuickModel("longao")}>Longão</button></div></section>
    <section className="workout-completeness"><header><div><span className="overline">CONFERÊNCIA AUTOMÁTICA</span><h3>O aluno receberá o treino completo?</h3></div><b>{completeParts.every(part=>part.ready)?"COMPLETO ✓":"FALTA UMA ETAPA"}</b></header><div>{completeParts.map((part,index)=><span key={part.label} className={part.ready?"ready":"missing"}><i>{part.ready?"✓":index+1}</i><b>{part.label}</b></span>)}</div>{!hasMainBlock&&<p>Escolha um modelo ou adicione uma repetição/passo para criar a parte principal.</p>}</section>
    <label>Nome do treino<input value={name} onChange={event=>setName(event.target.value)}/></label>
    <label>Orientação geral para o aluno <textarea value={instructions} onChange={event=>setInstructions(event.target.value)} placeholder="Ex.: controlar o início, fazer em terreno plano e não ultrapassar o ritmo proposto." maxLength={300}/></label>
    <div className="builder-actions"><button onClick={()=>setExtraSteps(current=>[...current,{id:Date.now(),amount:10,unit:"min",zone:"Z2",label:"Passo adicional"}])}>＋ Adicionar passo</button><button onClick={()=>setRepeatSteps(current=>[...current,{id:Date.now(),repetitions:6,effort:20,effortUnit:"s",effortZone:"Z5",recovery:40,recoveryUnit:"s",recoveryZone:"Z1"}])}>＋ Adicionar repetição</button></div>
    <section className="workout-builder">
      <div className="fixed-block editable-block"><i>01</i><span><small>AQUECIMENTO</small><b>{warmup.minutes?`${warmup.minutes} min em ${warmup.zone}`:"Não usar nesta sessão"}</b></span><label>Tempo (0 remove)<input type="number" min="0" value={warmup.minutes} onChange={event=>setWarmup({...warmup,minutes:Math.max(0,+event.target.value)})}/></label><label>Intensidade<select value={warmup.zone} onChange={event=>setWarmup({...warmup,zone:event.target.value})}>{intensityOptions}</select></label></div>
      {repeatSteps.map((series,index)=><div className="series-builder" key={series.id}><div className="series-title"><i>{String(index+2).padStart(2,"0")}</i><span><small>SÉRIE PRINCIPAL</small><b>{series.repetitions} × ({amountText(series.effort,series.effortUnit)} {series.effortZone} + {amountText(series.recovery,series.recoveryUnit)} {series.recoveryZone})</b></span><button className="remove-step" onClick={()=>setRepeatSteps(current=>current.filter(step=>step.id!==series.id))}>Remover série</button></div><div className="series-fields"><label>Repetições<input type="number" min="1" max="30" value={series.repetitions} onChange={event=>changeRepeat(series.id,{repetitions:Math.max(1,+event.target.value)})}/></label><label>Quantidade<input type="number" min="1" max={series.effortUnit==="m"?10000:3600} value={series.effort} onChange={event=>changeRepeat(series.id,{effort:Math.max(1,+event.target.value)})}/></label><label>Medida<select value={series.effortUnit} onChange={event=>changeRepeat(series.id,{effortUnit:event.target.value as StepUnit,effort:event.target.value==="m"?200:event.target.value==="s"?20:1})}><option value="s">Segundos</option><option value="min">Minutos</option><option value="m">Metros</option></select></label><label>Intensidade<select value={series.effortZone} onChange={event=>changeRepeat(series.id,{effortZone:event.target.value})}>{intensityOptions}</select></label><label>Recuperação<input type="number" min="1" max="3600" value={series.recovery} onChange={event=>changeRepeat(series.id,{recovery:Math.max(1,+event.target.value)})}/></label><label>Medida rec.<select value={series.recoveryUnit} onChange={event=>changeRepeat(series.id,{recoveryUnit:event.target.value as "s"|"min",recovery:event.target.value==="s"?40:2})}><option value="s">Segundos</option><option value="min">Minutos</option></select></label><label>Zona rec.<select value={series.recoveryZone} onChange={event=>changeRepeat(series.id,{recoveryZone:event.target.value})}>{["Z1","Z2","Z3"].map(value=><option key={value}>{value}</option>)}</select></label></div><p>✓ A recuperação acontece após cada repetição, inclusive a última.</p></div>)}
      {extraSteps.map((step,index)=><div className="fixed-block editable-block" key={step.id}><i>{String(repeatSteps.length+index+2).padStart(2,"0")}</i><span><small><input aria-label="Nome do passo" value={step.label} onChange={event=>changeExtra(step.id,{label:event.target.value})}/></small><b>{amountText(step.amount,step.unit)} em {step.zone}</b></span><label>Quantidade<input type="number" min="1" value={step.amount} onChange={event=>changeExtra(step.id,{amount:Math.max(1,+event.target.value)})}/></label><label>Medida<select value={step.unit} onChange={event=>changeExtra(step.id,{unit:event.target.value as StepUnit,amount:event.target.value==="m"?1000:event.target.value==="s"?30:10})}><option value="s">Segundos</option><option value="min">Minutos</option><option value="m">Metros</option></select></label><label>Intensidade<select value={step.zone} onChange={event=>changeExtra(step.id,{zone:event.target.value})}>{intensityOptions}</select></label><button className="remove-step" onClick={()=>setExtraSteps(current=>current.filter(item=>item.id!==step.id))}>Remover</button></div>)}
      <div className="fixed-block editable-block"><i>{String(repeatSteps.length+extraSteps.length+2).padStart(2,"0")}</i><span><small>DESAQUECIMENTO</small><b>{cooldown.minutes?`${cooldown.minutes} min em ${cooldown.zone}`:"Não usar nesta sessão"}</b></span><label>Tempo (0 remove)<input type="number" min="0" value={cooldown.minutes} onChange={event=>setCooldown({...cooldown,minutes:Math.max(0,+event.target.value)})}/></label><label>Intensidade<select value={cooldown.zone} onChange={event=>setCooldown({...cooldown,zone:event.target.value})}>{intensityOptions}</select></label></div>
    </section>
    <div className={`builder-options zone-status-${zoneStatus}`}><label>Referência opcional de Tempo Run<select value={tempoRun} onChange={event=>setTempoRun(event.target.value)}>{["Nenhum","5 km","10 km","Meia maratona","Maratona"].map(value=><option key={value}>{value}</option>)}</select></label><label>Ritmos usados neste treino<input value={athleteName} readOnly/><small>{zoneStatus==="loading"?"Conferindo as zonas do aluno...":zoneStatus==="approved"?"Zonas aprovadas carregadas neste treino ✓":zoneStatus==="pending"?"As zonas deste aluno ainda precisam ser liberadas pelo professor.":"Não foi possível consultar as zonas agora."}</small></label>{zoneStatus==="pending"&&<button className="release-zones-shortcut" onClick={()=>{close();window.dispatchEvent(new CustomEvent("zonasapp:open-tests",{detail:athleteName}))}}>Liberar zonas de {athleteName.split(" ")[0]} agora →</button>}</div>
    <div className="student-builder-preview"><span className="overline">COMO {athleteName.split(" ")[0].toUpperCase()} VERÁ</span><h3>Leia e execute uma etapa por vez</h3>{instructions&&<p className="preview-instructions">Orientação: {instructions}</p>}<article><b>1</b><span><small>AQUECIMENTO</small><strong>Corra {warmup.minutes} min em {warmup.zone}</strong><em>{ref[warmup.zone]}</em></span></article>{repeatSteps.map((series,index)=><article className="preview-repeat" key={series.id}><b>{index+2}</b><span><small>REPITA {series.repetitions} VEZES</small><strong>Corra {amountText(series.effort,series.effortUnit)} em {series.effortZone}</strong><em>{ref[series.effortZone]}</em><i>Após cada repetição: {amountText(series.recovery,series.recoveryUnit)} em {series.recoveryZone} · {ref[series.recoveryZone]}</i></span></article>)}{extraSteps.map((step,index)=><article key={step.id}><b>{repeatSteps.length+index+2}</b><span><small>{step.label||"DEPOIS"}</small><strong>Corra {amountText(step.amount,step.unit)} em {step.zone}</strong><em>{ref[step.zone]}</em></span></article>)}<article><b>{repeatSteps.length+extraSteps.length+2}</b><span><small>PARA TERMINAR</small><strong>Corra {cooldown.minutes} min em {cooldown.zone}</strong><em>{ref[cooldown.zone]}</em></span></article>{tempoRun!=="Nenhum"&&<p>Referência adicional: Tempo Run {tempoRun}</p>}</div>
    <div className="summary"><span>Duração estimada<b>{Math.round(total)} min</b></span><span>Distância estimada<b>{estimatedKm.toFixed(1)} km</b></span><span>Estrutura<b>{repeatSteps.length?`${repeatSteps.reduce((sum,step)=>sum+step.repetitions,0)} repetições`:"Treino contínuo"}</b></span></div>
    <footer><button className="outline" onClick={close}>Cancelar</button><button className="gold" disabled={!hasMainBlock} onClick={saveStructured}>{initial?.steps?.length?`Atualizar treino completo de ${day} →`:`Usar treino completo no dia ${day} →`}</button></footer>
  </aside></div>
}
function completeSessionForStudent(session?:StructuredSession):StructuredSession|undefined{
  if(!session||session.removed||session.steps?.length)return session;
  const text=`${session.title||""} ${session.description||""}`;
  const repeated=text.match(/(\d+)\s*[×x]\s*\(?\s*(\d+(?:[.,]\d+)?)\s*min\s*(Z[1-5])\s*\+\s*(\d+(?:[.,]\d+)?)\s*min\s*(Z[1-5])/i);
  if(repeated){const repetitions=Number(repeated[1]);const effortMinutes=Number(repeated[2].replace(",","."));const recoveryMinutes=Number(repeated[4].replace(",","."));return{...session,title:session.title||"Treino intervalado",durationMinutes:session.durationMinutes||Math.round(20+repetitions*(effortMinutes+recoveryMinutes)),steps:[{kind:"simple",label:"Aquecimento",minutes:10,zone:"Z1"},{kind:"repeat",label:"Série principal",repetitions,effortMinutes,effortZone:repeated[3].toUpperCase(),recoveryMinutes,recoveryZone:repeated[5].toUpperCase()},{kind:"simple",label:"Desaquecimento",minutes:10,zone:"Z1"}]}}
  const continuous=text.match(/(\d+)\s*min(?:utos)?(?:\s+em)?\s*(Z[1-5])/i);
  if(continuous){const minutes=Number(continuous[1]);return{...session,title:session.title||session.type||"Corrida contínua",durationMinutes:session.durationMinutes||minutes,steps:[{kind:"simple",label:"Treino principal",minutes,zone:continuous[2].toUpperCase()}]}}
  return session;
}
function StructuredWorkoutCard({session}:{session:StructuredSession}){
  const target=(intensity:string)=>intensity?.startsWith("Tempo Run")?`no ${intensity}`:`em ${intensity}`;
  const effortAmount=(step:any)=>step.effortMeters?`${step.effortMeters} m`:step.effortSeconds?`${step.effortSeconds} s`:`${step.effortMinutes} min`;
  const simpleAmount=(step:any)=>step.distanceMeters?`${step.distanceMeters} m`:step.seconds?`${step.seconds} s`:`${step.minutes} min`;
  const recoveryAmount=(step:any)=>step.recoverySeconds?`${step.recoverySeconds} s`:`${step.recoveryMinutes} min`;
  return <article className="today-card interval-card saved-structured">
    <header><div><span className="pill">TREINO LIBERADO</span><h2>{session.title||session.description}</h2><p>{session.steps?.length||0} etapas na ordem definida pelo treinador</p></div><strong>{session.durationMinutes||"—"}<small>min aprox.</small></strong></header>
    {(session as any).instructions&&<p className="student-workout-note"><b>Orientação do treinador:</b> {(session as any).instructions}</p>}
    <div className="student-instructions">{session.steps?.map((step:any,index:number)=>step.kind==="repeat"?
      <article className="repeat-step" key={index}><i>{index+1}</i><div><small>REPITA {step.repetitions} VEZES</small><h3>Corra {effortAmount(step)} {target(step.effortZone)}</h3><b>Ritmo individual: {step.effortPace||"zona aprovada"}</b><em>Após cada repetição: {recoveryAmount(step)} {target(step.recoveryZone)} · {step.recoveryPace||"zona aprovada"}</em></div></article>:
      <article key={index}><i>{index+1}</i><div><small>{String(step.label||"ETAPA").toUpperCase()}</small><h3>Corra {simpleAmount(step)} {target(step.zone)}</h3><b>Ritmo individual: {step.pace||"zona aprovada"}</b></div></article>)}</div>
    {session.tempoRun&&session.tempoRun!=="Nenhum"&&<p className="structured-tempo">Referência complementar: Tempo Run {session.tempoRun}</p>}<p className="structured-confirm">✓ Este é o mesmo treino montado e liberado pelo treinador.</p>
  </article>
}

/**
 * Conclusão do treino pelo aluno.
 *
 * Antes esta tela só oferecia "analisar", e a análise exigia digitar tempo ou
 * distância: quem apenas correu não tinha como avisar o treinador de que fez o
 * treino. Agora a conclusão é o ato principal, os números são opcionais, e
 * quem não treinou também consegue registrar isso — informação igualmente útil
 * para o treinador reorganizar a semana.
 *
 * Quando há integração conectada, o servidor completa tempo, distância, ritmo
 * médio e frequência cardíaca com a atividade importada daquele dia.
 */

/**
 * Últimos sete dias do aluno.
 *
 * Sete dias cobrem a semana corrente sem virar uma lista interminável: o que
 * interessa a quem acabou de treinar é o passado recente, e o histórico longo
 * fica na aba Evolução.
 */
function RecentWorkouts({ secureStudentMode }: { secureStudentMode: boolean }) {
  type Execucao = {
    id: string; workout_day: string; week_start: string; status?: string;
    classification: string; correct_percentage: number;
    actual_minutes?: number; actual_km?: string; average_pace_seconds?: number;
    average_heart_rate?: number; source: string; created_at: number; note?: string;
  };
  const [itens, setItens] = useState<Execucao[]>([]);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "vazio">("carregando");

  useEffect(() => {
    if (!secureStudentMode) { setEstado("vazio"); return; }
    api.get<{ executions: Execucao[] }>("/api/student/workout-executions?days=7")
      .then(d => { setItens(d.executions || []); setEstado((d.executions || []).length ? "pronto" : "vazio"); })
      .catch(() => setEstado("vazio"));
  }, [secureStudentMode]);

  if (estado === "carregando") return <section className="recent-workouts"><p>Carregando…</p></section>;
  if (estado === "vazio") return null;

  const ritmo = (s?: number) => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : null;
  const dia = (ms: number) => new Date(Number(ms)).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

  return <section className="recent-workouts">
    <header>
      <span className="overline">ÚLTIMOS 7 DIAS</span>
      <h2>O que você registrou</h2>
    </header>
    {itens.map(item => {
      const naoFeito = item.status === "Não realizado";
      return <article key={item.id} className={naoFeito ? "faltou" : item.correct_percentage >= 80 ? "bom" : "parcial"}>
        <span className="recent-day">
          <b>{item.workout_day}</b>
          <small>{dia(item.created_at)}</small>
        </span>
        <span className="recent-info">
          <b>{item.classification}</b>
          <small>
            {naoFeito ? (item.note || "Sem observação") : [
              item.actual_minutes ? `${item.actual_minutes} min` : null,
              item.actual_km ? `${item.actual_km} km` : null,
              ritmo(item.average_pace_seconds) ? `${ritmo(item.average_pace_seconds)} /km` : null,
              item.average_heart_rate ? `${item.average_heart_rate} bpm` : null,
            ].filter(Boolean).join(" · ") || "sem medição"}
          </small>
        </span>
        {!naoFeito && item.correct_percentage > 0 && <strong>{item.correct_percentage}%</strong>}
      </article>;
    })}
  </section>;
}

function WorkoutAnalysis({secureStudentMode,weekStart,workoutDay,session}:{secureStudentMode:boolean;weekStart?:string;workoutDay:string;session?:StructuredSession}){
  const [actualMinutes,setActualMinutes]=useState("");
  const [actualKm,setActualKm]=useState("");
  const [note,setNote]=useState("");
  const [result,setResult]=useState<any>(null);
  const [state,setState]=useState<""|"saving"|"error">("");
  const [erro,setErro]=useState("");
  const [motivoAberto,setMotivoAberto]=useState(false);

  const registrar=async(action:"complete"|"skip")=>{
    setState("saving");setErro("");
    try{
      if(!secureStudentMode){
        // Prévia do treinador: calcula localmente, sem gravar nada.
        const plannedMinutes=Number(session?.durationMinutes)||0;
        const plannedKm=Number(session?.estimatedKm)||0;
        if(action==="skip"){setResult({status:"Não realizado",classification:"Não realizado",correct:0,wrong:100});setState("");return}
        const scores=[
          plannedMinutes&&actualMinutes?Math.max(0,100-Math.abs(Number(actualMinutes)-plannedMinutes)/plannedMinutes*100):null,
          plannedKm&&actualKm?Math.max(0,100-Math.abs(Number(actualKm)-plannedKm)/plannedKm*100):null,
        ].filter(v=>v!==null) as number[];
        const correct=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
        setResult(scores.length
          ?{status:"Concluído",measured:true,correct,wrong:100-correct,classification:correct>=80?"Dentro do planejado":correct>=60?"Parcialmente correto":"Fora do planejado"}
          :{status:"Concluído",measured:false,correct:0,wrong:0,classification:"Concluído sem medição"});
        setState("");return;
      }
      const execucao=await api.post<any>("/api/student/workout-executions",{
        weekStart,workoutDay,action,
        actualMinutes:Number(actualMinutes)||null,
        actualKm:Number(actualKm)||null,
        note:note||undefined,
      });
      setResult(execucao);setMotivoAberto(false);setState("");
    }catch(error){setErro(describeError(error,"Não foi possível registrar. Tente novamente."));setState("error")}
  };

  if(!session||session.removed)return null;

  const ritmo=(segundos?:number|null)=>segundos?`${Math.floor(segundos/60)}:${String(segundos%60).padStart(2,"0")} /km`:null;
  const concluido=result?.status==="Concluído";
  const naoRealizado=result?.status==="Não realizado";

  return <section className="student-workout-analysis">
    <span className="overline">DEPOIS DO TREINO</span>
    <h2>{result?"Registro enviado ao treinador":"Você fez este treino?"}</h2>
    {!result&&<p>Marque como concluído assim que terminar. Informar tempo e distância é opcional — se o seu relógio estiver conectado, a Zonas-App busca sozinha.</p>}

    <div className="analysis-plan">
      <span><small>PLANEJADO</small><b>{session.durationMinutes||"—"} min</b></span>
      <span><small>DISTÂNCIA ESTIMADA</small><b>{session.estimatedKm||"—"} km</b></span>
    </div>

    {!result&&<>
      <details className="analysis-optional" open={Boolean(actualMinutes||actualKm)}>
        <summary>Quero informar tempo e distância</summary>
        <div className="analysis-inputs">
          <label>Tempo realizado (min)<input type="number" min="1" value={actualMinutes} onChange={e=>setActualMinutes(e.target.value)} placeholder="Ex.: 42"/></label>
          <label>Distância realizada (km)<input type="number" min="0.1" step="0.01" value={actualKm} onChange={e=>setActualKm(e.target.value)} placeholder="Ex.: 8,20"/></label>
        </div>
      </details>

      {motivoAberto&&<label className="analysis-note">Por que não treinou? <small>opcional</small>
        <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={400} placeholder="Ex.: acordei indisposta, viagem, chuva forte"/>
      </label>}

      {erro&&<p className="pain-error">{erro}</p>}

      <div className="analysis-actions">
        <button className="analysis-complete" disabled={state==="saving"} onClick={()=>registrar("complete")}>
          {state==="saving"?"Registrando…":"✓ Concluí este treino"}
        </button>
        <button className="analysis-skip" disabled={state==="saving"} onClick={()=>motivoAberto?registrar("skip"):setMotivoAberto(true)}>
          {motivoAberto?"Confirmar que não treinei":"Não consegui treinar"}
        </button>
        {motivoAberto&&<button className="analysis-cancel" onClick={()=>{setMotivoAberto(false);setNote("")}}>Cancelar</button>}
      </div>
    </>}

    {result&&<article className={`analysis-result ${naoRealizado?"outside":!result.measured?"partial":result.correct>=80?"correct":result.correct>=60?"partial":"outside"}`}>
      <h3>{result.classification}</h3>
      {result.measured&&<div>
        <strong>{result.correct}%<small>treino certo</small></strong>
        <strong>{result.wrong}%<small>fora do planejado</small></strong>
      </div>}

      {concluido&&(result.actualMinutes||result.actualKm||result.averagePaceSeconds||result.averageHeartRate)&&
        <div className="analysis-metrics">
          {result.actualMinutes&&<span><small>TEMPO</small><b>{result.actualMinutes} min</b></span>}
          {result.actualKm&&<span><small>DISTÂNCIA</small><b>{result.actualKm} km</b></span>}
          {ritmo(result.averagePaceSeconds)&&<span><small>RITMO MÉDIO</small><b>{ritmo(result.averagePaceSeconds)}</b></span>}
          {result.averageHeartRate&&<span><small>FC MÉDIA</small><b>{result.averageHeartRate} bpm</b></span>}
        </div>}

      {result.fromIntegration&&<p className="analysis-source">Dados trazidos automaticamente de {result.source}.</p>}

      <p>{naoRealizado
        ?"O treinador foi avisado e poderá reorganizar a sua semana."
        :!result.measured
          ?"Conclusão registrada. Conecte o seu relógio em Mais → Integrações para que tempo, ritmo e frequência cardíaca venham sozinhos."
          :result.correct>=80?"Muito bom: tempo e distância ficaram próximos do planejado."
          :result.correct>=60?"Parte do objetivo foi cumprida. O treinador poderá ajustar o próximo treino."
          :"O resultado ficou distante do planejado. O treinador vai revisar com você."}</p>

      <button className="analysis-redo" onClick={()=>{setResult(null);setActualMinutes("");setActualKm("");setNote("")}}>Registrar novamente</button>
    </article>}
  </section>;
}


function parsedList(value:unknown){try{const result=JSON.parse(String(value||"[]"));return Array.isArray(result)?result:[]}catch{return[]}}
function StudentTestsView({data,back}:{data:any;back:()=>void}){
  const tests=data?.tests||[];const approved=tests.filter((test:any)=>test.status==="Aprovado");const waiting=tests.filter((test:any)=>test.status!=="Aprovado");
  return <><button className="student-back" onClick={back}>← Voltar</button><span className="overline">RITMOS INDIVIDUAIS</span><h1>Testes e zonas</h1><p>Somente ritmos revisados e liberados pelo professor são usados nos seus treinos.</p>{data===undefined?<section className="student-data-empty"><p>Carregando seus testes…</p></section>:approved.length===0?<section className="student-data-empty"><b>Ainda não há zonas liberadas</b><p>{waiting.length?"Seu teste foi registrado e está aguardando a revisão do professor.":"Quando o professor registrar e aprovar seu teste de 3 km ou 5 km, os ritmos aparecerão aqui."}</p></section>:<section className="student-tests-view">{approved.map((test:any,index:number)=>{const zones=parsedList(test.zones);const tempos=parsedList(test.tempo_runs);return <article key={test.id}><header><div><small>{index===0?"TESTE ATUAL APROVADO":"TESTE ANTERIOR"}</small><h2>{test.distance_km} km em {duration(Number(test.total_seconds))}</h2><p>{String(test.test_date).split("-").reverse().join("/")}</p></div><span>LIBERADO ✓</span></header><div className="student-test-summary"><span><small>RITMO DO TESTE</small><b>{pace(Number(test.pace_seconds))}/km</b></span><span><small>VAM</small><b>{Number(test.vam).toFixed(1)} km/h</b></span><span><small>FC MÁX.</small><b>{test.fc_max} bpm</b></span></div><h3>Zonas de ritmo</h3><div className="student-zone-cards">{zones.map((zone:any)=><span key={zone.z}><b>{zone.z}</b><em>{zone.label}</em><strong>{pace(Number(zone.slow))} – {pace(Number(zone.fast))}/km</strong></span>)}</div><h3>Tempo Run por distância</h3><div className="student-tempo-cards">{tempos.map((tempo:any)=><span key={tempo.label}><small>{tempo.label}</small><b>{pace(Number(tempo.targetPace))}/km</b></span>)}</div></article>})}{waiting.length>0&&<aside>Há {waiting.length} teste(s) aguardando revisão do professor.</aside>}</section>}</>;
}
function StudentProfileView({data,back}:{data:any;back:()=>void}){
  const days=parsedList(data?.profile?.training_days);const planning=data?.planning;
  return <><button className="student-back" onClick={back}>← Voltar</button><span className="overline">SEU CADASTRO</span><h1>Meu perfil</h1><p>Confira os dados usados pelo professor para organizar sua semana.</p>{data===undefined?<section className="student-data-empty"><p>Carregando seu cadastro…</p></section>:!data?<section className="student-data-empty"><b>Não foi possível carregar</b><p>Tente novamente em alguns instantes.</p></section>:<section className="student-profile-view"><header><i>{String(data.athlete?.name||"A").split(/\s+/).slice(0,2).map((part:string)=>part[0]).join("")}</i><div><h2>{data.athlete?.name}</h2><p>{data.athlete?.distance||data.profile?.objective||"Objetivo não informado"}</p></div></header><div className="student-profile-fields"><article><small>OBJETIVO</small><b>{data.profile?.objective||data.athlete?.distance||"Não informado"}</b></article><article><small>APLICATIVO / RELÓGIO</small><b>{data.profile?.integration||"Não informado"}</b></article><article><small>TELEFONE</small><b>{data.profile?.phone||"Não informado"}</b></article><article><small>DATA DE NASCIMENTO</small><b>{data.profile?.birth_date?String(data.profile.birth_date).split("-").reverse().join("/"):"Não informada"}</b></article></div><div className="student-training-days"><small>DIAS DISPONÍVEIS PARA TREINAR</small><div>{days.length?days.map((day:string)=><b key={day}>{day}</b>):<span>Nenhum dia informado</span>}</div></div>{planning&&<div className="student-current-plan"><span><small>PLANILHA ATUAL</small><b>{planning.plan}</b></span><span><small>FASE</small><b>{planning.phase}</b></span><span><small>SEMANA</small><b>{planning.week_number} de {planning.total_weeks}</b></span></div>}<footer>Encontrou algum dado errado? Avise o professor para que ele faça a correção no seu cadastro.</footer></section>}</>;
}

export function StudentView({ onBack, athleteName = "Everton Barbosa" }: { onBack?: () => void; athleteName?: string }) {
  const [tab, setTab] = useState("Hoje");
  const [feedback, setFeedback] = useState("");
  const [sent, setSent] = useState(false);
  const [feedbackState,setFeedbackState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const [savedWeek,setSavedWeek]=useState<any>(undefined);
  const [moreView,setMoreView]=useState("menu");
  const [painArea,setPainArea]=useState("");
  const [painIntensity,setPainIntensity]=useState(4);
  const [painImpact,setPainImpact]=useState("");
  const [painNote,setPainNote]=useState("");
  const [painState,setPainState]=useState("");
  const [raceData,setRaceData]=useState<any>({races:[],records:[]});
  const [raceForm,setRaceForm]=useState({name:"",raceDate:"",distance:"10 km",city:"",goal:""});
  const [recordForm,setRecordForm]=useState({distance:"10 km",resultTime:"",raceDate:"",eventName:""});
  const [raceState,setRaceState]=useState("");
  const [integrationPreference,setIntegrationPreference]=useState("Garmin");
  const [integrationState,setIntegrationState]=useState("");
  const [providers,setProviders]=useState<ProviderCard[]>([]);
  const [appleSetup,setAppleSetup]=useState<{ingestToken:string;ingestUrl:string}|null>(null);
  const [financialData,setFinancialData]=useState<any>(null);
  const [studentProfile,setStudentProfile]=useState<any>(undefined);
  const [studentTests,setStudentTests]=useState<any>(undefined);
  const [executionData,setExecutionData]=useState<any>(undefined);
  const [sessionInvalid,setSessionInvalid]=useState(false);
  const [openedWeekDay,setOpenedWeekDay]=useState("");
  const [dismissedAlerts,setDismissedAlerts]=useState<string[]>([]);
  useEffect(()=>{try{setDismissedAlerts(JSON.parse(localStorage.getItem("zonasapp:student-alerts-read")||"[]"))}catch{}},[]);
  useEffect(()=>{setFeedbackState("idle")},[feedback]);
  useEffect(()=>{if(!openedWeekDay)return;const timer=window.setTimeout(()=>{const detail=document.querySelector(".student-week-detail") as HTMLElement|null;detail?.scrollIntoView({behavior:"smooth",block:"start"});detail?.focus({preventScroll:true})},0);return()=>window.clearTimeout(timer)},[openedWeekDay]);
  const secureStudentMode = !onBack;
  useEffect(()=>{
    if(!secureStudentMode)return;
    let active=true;
    const verify=()=>fetch("/api/session",{cache:"no-store"}).then(response=>{if(active&&!response.ok)setSessionInvalid(true)}).catch(()=>undefined);
    verify();
    const timer=window.setInterval(verify,30000);
    return()=>{active=false;window.clearInterval(timer)};
  },[secureStudentMode]);
  useEffect(()=>{
    const currentWeekStart=mondayOf(new Date().toISOString().slice(0,10));
    const endpoint=secureStudentMode?"/api/student/dashboard":`/api/training-weeks?athlete=${encodeURIComponent(athleteName)}&weekStart=${currentWeekStart}`;
    fetch(endpoint).then(r=>r.ok?r.json():{week:null}).then(data=>{setSavedWeek(data.week??null);if(data.profile?.integration)setIntegrationPreference(data.profile.integration);if(data.races||data.records)setRaceData({races:data.races||[],records:data.records||[]})}).catch(()=>setSavedWeek(null));
  },[athleteName,secureStudentMode]);
  useEffect(()=>{const endpoint=secureStudentMode?"/api/student/races-records":`/api/races-records?athlete=${encodeURIComponent(athleteName)}`;fetch(endpoint).then(r=>r.ok?r.json():{races:[],records:[]}).then(setRaceData).catch(()=>undefined)},[moreView,athleteName,secureStudentMode]);
  const loadProviders=()=>fetch("/api/student/integrations").then(r=>r.ok?r.json():{providers:[]}).then(data=>setProviders(data.providers||[])).catch(()=>setProviders([]));
  useEffect(()=>{if(moreView!=="integrations"||!secureStudentMode)return;loadProviders()},[moreView,secureStudentMode]);
  useEffect(()=>{if(moreView!=="financial")return;if(!secureStudentMode){setFinancialData({settings:{pix_key:"Chave Pix definida pelo professor",pix_name:"ZonasApp"},payment:{amount_cents:11000,due_date:"2026-08-15",status:"Pendente"}});return}fetch("/api/student/financial").then(r=>r.ok?r.json():null).then(setFinancialData).catch(()=>setFinancialData(null))},[moreView,secureStudentMode]);
  useEffect(()=>{if(moreView!=="profile")return;const endpoint=secureStudentMode?"/api/student/profile":`/api/athlete-profile?athlete=${encodeURIComponent(athleteName)}`;fetch(endpoint).then(r=>r.ok?r.json():null).then(data=>setStudentProfile(secureStudentMode?data:{athlete:{name:athleteName,distance:"10 km"},profile:data?.profile??null,planning:{plan:"10 km Lion",phase:"Específica",week_number:8,total_weeks:16}})).catch(()=>setStudentProfile(null))},[moreView,secureStudentMode,athleteName]);
  useEffect(()=>{const endpoint=secureStudentMode?"/api/student/performance-tests":`/api/performance-tests?athlete=${encodeURIComponent(athleteName)}`;fetch(endpoint).then(r=>r.ok?r.json():{tests:[]}).then(setStudentTests).catch(()=>setStudentTests({tests:[]}))},[secureStudentMode,athleteName]);
  useEffect(()=>{if(tab!=="Evolução")return;const executionEndpoint=secureStudentMode?"/api/student/workout-executions":"";if(!executionEndpoint){setExecutionData({executions:[]});return}Promise.all([fetch(executionEndpoint).then(r=>r.ok?r.json():{executions:[]}),fetch("/api/student/profile").then(r=>r.ok?r.json():null)]).then(([executions,profile])=>{setExecutionData(executions);setStudentProfile(profile)}).catch(()=>setExecutionData({executions:[]}))},[tab,secureStudentMode]);
  const savedSessions=savedWeek?.status==="Liberada"?JSON.parse(savedWeek.sessions||"{}"):null;
  const today=brazilCalendar();
  const todaySession=completeSessionForStudent(savedSessions?.[today.key]);
  const studentWeekLabel=savedWeek?.week_start?weekDateLabel(savedWeek.week_start):"Semana atual";
  const weekDays=["SEG","TER","QUA","QUI","SEX","SÁB","DOM"];
  const showTraining=Boolean(savedWeek?.status==="Liberada"&&todaySession&&!todaySession.removed);
  const executions=executionData?.executions||[];
  const monthKey=new Date(Date.now()-3*60*60*1000).toISOString().slice(0,7);
  const monthExecutions=executions.filter((item:any)=>String(item.week_start||"").startsWith(monthKey));
  const monthKm=monthExecutions.reduce((sum:number,item:any)=>sum+(Number(item.actual_km)||0),0);
  const monthAccuracy=monthExecutions.length?Math.round(monthExecutions.reduce((sum:number,item:any)=>sum+(Number(item.correct_percentage)||0),0)/monthExecutions.length):0;
  const recentWeeks=Array.from(new Set(executions.map((item:any)=>String(item.week_start||"")))).filter(Boolean).sort().reverse().slice(0,4).map(week=>{const items=executions.filter((item:any)=>item.week_start===week);return{week,done:items.length,accuracy:items.length?Math.round(items.reduce((sum:number,item:any)=>sum+(Number(item.correct_percentage)||0),0)/items.length):0}});
  const tenKmRecord=raceData.records?.find((record:any)=>record.distance==="10 km");
  const nextRace=raceData.races?.find((race:any)=>race.race_date>=new Date().toISOString().slice(0,10));
  const raceDays=nextRace?Math.max(0,Math.ceil((new Date(`${nextRace.race_date}T12:00:00`).getTime()-Date.now())/86400000)):null;
  const approvedTest=studentTests?.tests?.find((test:any)=>test.status==="Aprovado");
  const waitingTest=studentTests?.tests?.find((test:any)=>test.status!=="Aprovado");
  const approvedRace=raceData.races?.find((race:any)=>race.status==="Aprovada");
  const studentAlerts=[
    savedWeek?.status==="Liberada"&&{id:`week-${savedWeek.week_start}`,tone:"released",icon:"✓",title:"Sua semana foi liberada",detail:`${savedWeek.plan} · ${savedWeek.phase} · ${savedWeek.week_label}`,action:"Abrir minha semana",open:()=>setTab("Minha semana")},
    approvedTest&&{id:`zones-${approvedTest.id}`,tone:"zones",icon:"Z",title:"Suas zonas de treino foram liberadas",detail:"Os próximos treinos já podem usar seus ritmos individuais.",action:"Ver zonas e ritmos",open:()=>{setTab("Mais");setMoreView("tests")}},
    waitingTest&&!approvedTest&&{id:`test-waiting-${waitingTest.id}`,tone:"waiting",icon:"⌛",title:"Seu teste está em análise",detail:"O professor recebeu o resultado e ainda precisa liberar suas zonas.",action:"Acompanhar teste",open:()=>{setTab("Mais");setMoreView("tests")}},
    approvedRace&&{id:`race-approved-${approvedRace.id}`,tone:"race",icon:"⚑",title:"Sua prova foi analisada",detail:`${approvedRace.name} foi incluída no planejamento como ${approvedRace.priority||"prova-alvo"}.`,action:"Ver prova",open:()=>{setTab("Mais");setMoreView("races")}},
  ].filter(Boolean).filter((alert:any)=>!dismissedAlerts.includes(alert.id)) as Array<{id:string;tone:string;icon:string;title:string;detail:string;action:string;open:()=>void}>;
  const dismissStudentAlert=(id:string)=>setDismissedAlerts(current=>{const next=[...current,id];localStorage.setItem("zonasapp:student-alerts-read",JSON.stringify(next));return next});
  const todaySummary=<section className="student-today-summary"><button onClick={()=>setTab("Minha semana")}><small>SEMANA ATUAL</small><b>{savedWeek?.week_label?`Semana ${savedWeek.week_label}`:"Aguardando liberação"}</b><span>Ver todos os treinos →</span></button><article><small>PRÓXIMA PROVA</small><b>{nextRace?.name||"Não cadastrada"}</b><span>{raceDays!==null?`${raceDays} dias restantes`:"Cadastre em Mais"}</span></article></section>;
  useEffect(()=>{if(!sent||!feedback||feedbackState!=="idle")return;setFeedbackState("saving");if(!secureStudentMode){setFeedbackState("saved");return}fetch("/api/student/feedbacks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({feeling:feedback,weekStart:savedWeek?.week_start||"",workoutDay:today.key})}).then(response=>{if(!response.ok)throw new Error();setFeedbackState("saved")}).catch(()=>{setSent(false);setFeedbackState("error")})},[sent,feedback,feedbackState,secureStudentMode,savedWeek?.week_start,today.key]);
  const sendPainReport=async()=>{
    if(!painArea||!painImpact)return;
    setPainState("saving");
    try{
      const response=await fetch(secureStudentMode?"/api/student/pain-reports":"/api/pain-reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({athleteName,bodyArea:painArea,intensity:painIntensity,trainingImpact:painImpact,note:painNote})});
      if(!response.ok)throw new Error("save_failed");
      setPainState("saved");
    }catch{setPainState("error")}
  };
  const saveRaceRecord=async(kind:"race"|"record")=>{
    setRaceState("saving"); const data=kind==="race"?raceForm:recordForm;
    try{const endpoint=secureStudentMode?"/api/student/races-records":"/api/races-records";const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,athleteName,...data})});if(!response.ok)throw new Error("save_failed");setRaceState(kind==="race"?"race-saved":"record-saved");const updated=await fetch(secureStudentMode?endpoint:`${endpoint}?athlete=${encodeURIComponent(athleteName)}`).then(r=>r.json());setRaceData(updated)}catch{setRaceState("error")}
  };
  const saveIntegration=async(integration:string)=>{setIntegrationState("saving");try{if(secureStudentMode){await api.post("/api/student/integration-preference",{integration})}setIntegrationPreference(integration);setIntegrationState("saved")}catch{setIntegrationState("error")}};
  /** Conecta, desconecta ou sincroniza um provedor pelo caminho unificado. */
  const providerAction=async(providerId:string,action:"connect"|"disconnect"|"sync")=>{
    setIntegrationState("saving");
    try{
      const response=await fetch("/api/student/integrations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:providerId,action})});
      const data=await response.json().catch(()=>({}));
      if(response.status===503){setIntegrationState("setup-required");return}
      if(!response.ok){setIntegrationState(data.error==="sync_not_available"?"sync-unavailable":"error");return}
      if(data.authType==="device"){setAppleSetup({ingestToken:data.ingestToken,ingestUrl:data.ingestUrl});setIntegrationState("apple-ready");await loadProviders();return}
      if(data.authorizationUrl){window.location.href=data.authorizationUrl;return}
      await loadProviders();
      setIntegrationState(action==="sync"?`sincronizado:${data.imported??0}`:"saved");
    }catch{setIntegrationState("error")}
  };
  const weekStatus = savedWeek!==undefined&&<section className={`student-week-status ${savedWeek?.status==="Liberada"?"released":"waiting"}`}><div><span className="overline">{studentWeekLabel.toUpperCase()}</span><h2>{savedWeek?.status==="Liberada"?"Semana liberada pelo treinador":"A próxima semana ainda não foi liberada"}</h2><p>{savedWeek?.status==="Liberada"?`${savedWeek.plan} · ${savedWeek.phase} · ${savedWeek.week_label}`:"Os treinos aparecerão assim que o treinador terminar a revisão."}</p></div><b>{savedWeek?.status==="Liberada"?"LIBERADA ✓":"AGUARDANDO"}</b></section>;
  const openedWeekSession=completeSessionForStudent(savedSessions?.[openedWeekDay]);
  const weekGrid = savedSessions&&<section className="student-week-grid">{weekDays.map(day=>{const session=completeSessionForStudent(savedSessions[day]);return <article key={day} role={session?"button":undefined} tabIndex={session?0:undefined} className={`${session?"has-session":""} ${openedWeekDay===day?"selected":""}`} onClick={()=>session&&setOpenedWeekDay(day)} onKeyDown={event=>session&&(event.key==="Enter"||event.key===" ")&&setOpenedWeekDay(day)}><small>{day}</small>{session?<><b>{session.title||session.type}</b><span>{session.steps?.length?`${session.steps.length} etapas · toque para abrir`:session.description}</span><strong>Ver treino completo →</strong></>:<em>Descanso</em>}</article>})}</section>;
  if(sessionInvalid)return <main className="secure-access-denied"><section><span>Z</span><small>SESSÃO ENCERRADA</small><h1>Seu acesso foi encerrado.</h1><p>Os dados desta área foram protegidos. Fale com o treinador caso precise reativar o acesso.</p><button onClick={()=>void signOut()}>Sair e voltar ao início</button></section></main>;
  return <main className="student"><header><div className="brand"><span>Z</span><div><strong>ZONASAPP</strong><small>{tab.toUpperCase()}</small></div></div>{onBack?<button onClick={onBack}>Área do professor</button>:<button className="student-signout" onClick={()=>void signOut()}>Sair da conta</button>}</header><section className="student-content">{tab==="Hoje"&&studentAlerts.length>0&&<section className="student-notification-center"><header><span>🔔</span><div><small>NOVIDADES DO SEU TREINADOR</small><b>{studentAlerts.length} aviso(s) para você</b></div></header>{studentAlerts.slice(0,3).map(alert=><article key={alert.id} className={alert.tone}><i>{alert.icon}</i><span><b>{alert.title}</b><small>{alert.detail}</small><button onClick={alert.open}>{alert.action} →</button></span><button aria-label="Marcar aviso como lido" onClick={()=>dismissStudentAlert(alert.id)}>×</button></article>)}</section>}{tab==="Hoje"&&todaySummary}
    {tab==="Hoje"&&<><span className="overline">{today.label.toUpperCase()}</span><h1>{showTraining?`Bom treino, ${athleteName.split(" ")[0]}.`:`Olá, ${athleteName.split(" ")[0]}.`}</h1><p>{showTraining?"Leia de cima para baixo e siga uma etapa por vez.":"Aqui aparece somente o treino liberado pelo seu treinador para hoje."}</p>{savedWeek===undefined?<section className="student-empty-week"><b>⌛</b><h2>Carregando seu treino</h2><p>Estamos conferindo a programação liberada.</p></section>:showTraining?<>{todaySession?.steps?.length?<StructuredWorkoutCard session={todaySession}/>:<article className="today-card interval-card saved-structured"><header><div><span className="pill">TREINO LIBERADO</span><h2>{todaySession.title||todaySession.description||todaySession.type}</h2><p>Programação liberada pelo treinador para hoje.</p></div><strong>{todaySession.durationMinutes||"—"}<small>min aprox.</small></strong></header><p className="structured-confirm">✓ Este treino foi liberado pelo treinador.</p></article>}<section className="quick-feedback"><span className="overline">DEPOIS DO TREINO</span><h2>Como você terminou?</h2><p>Leva poucos segundos e ajuda o treinador a ajustar o próximo treino.</p><div>{["Muito bem","Cansado","Sentiu dor"].map(item=><button key={item} className={feedback===item?"selected":""} onClick={()=>{setFeedback(item);setSent(false)}}>{item==="Muito bem"?"🙂":item==="Cansado"?"😮‍💨":"⚠️"}<b>{item}</b></button>)}</div><button className="feedback-send" disabled={!feedback||feedbackState==="saving"} onClick={()=>setSent(true)}>{feedbackState==="saving"?"Registrando…":sent?"Feedback registrado ✓":"Registrar feedback"}</button>{feedbackState==="error"&&<p className="pain-error">Não foi possível registrar. Tente novamente.</p>}</section></>:<section className="student-empty-week"><b>✓</b><h2>{savedWeek?"Hoje é dia de descanso":"Nenhum treino liberado para esta semana"}</h2><p>{savedWeek?"Não há sessão programada para hoje. Consulte “Minha semana” para ver os próximos treinos.":"Você receberá os treinos somente depois da liberação do professor."}</p></section>}</>}
    {tab==="Minha semana"&&<><span className="overline">PLANEJAMENTO</span><h1>Minha semana</h1><p>Toque no dia para abrir aquecimento, parte principal, recuperações e desaquecimento.</p>{weekStatus}{weekGrid}{openedWeekSession&&<section className="student-week-detail" tabIndex={-1}><header><div><span className="overline">TREINO DE {openedWeekDay}</span><h2>Treino completo</h2></div><button onClick={()=>setOpenedWeekDay("")}>Fechar ×</button></header><StructuredWorkoutCard session={openedWeekSession}/><WorkoutAnalysis secureStudentMode={secureStudentMode} weekStart={savedWeek?.week_start} workoutDay={openedWeekDay} session={openedWeekSession}/></section>}{!savedSessions&&savedWeek!==undefined&&<section className="student-empty-week"><b>⌛</b><h2>Semana em revisão</h2><p>Rascunhos não aparecem para você. Aguarde a liberação do treinador.</p></section>}</>}
    {tab==="Evolução"&&<><span className="overline">SEU PROGRESSO REAL</span><h1>Evolução</h1><p>Os números aparecem depois que você registra os resultados dos treinos liberados.</p>{executionData===undefined?<section className="student-data-empty"><p>Carregando sua evolução…</p></section>:<><section className="student-progress"><article><small>TREINOS REGISTRADOS NO MÊS</small><b>{monthExecutions.length}</b><span>{monthExecutions.length?`${monthAccuracy}% de acerto médio`:"Nenhum resultado registrado"}</span></article><article><small>VOLUME REGISTRADO NO MÊS</small><b>{monthKm.toLocaleString("pt-BR",{maximumFractionDigits:1})} <em>km</em></b><span>Somente resultados informados</span></article><article><small>RECORDE NOS 10 KM</small><b>{tenKmRecord?.result_time||"—"}</b><span>{tenKmRecord?"Melhor marca cadastrada":"Ainda não registrado"}</span></article></section>{recentWeeks.length?<section className="progress-weeks"><header><div><span className="overline">ÚLTIMAS SEMANAS COM RESULTADO</span><h2>Treinos e acerto</h2></div><b>{executions.length}</b></header>{recentWeeks.map((item:any)=><article key={item.week}><span>Semana {String(item.week).split("-").reverse().slice(0,2).join("/")}</span><div><i style={{width:`${item.accuracy}%`}}/></div><b>{item.done} · {item.accuracy}%</b></article>)}</section>:<section className="student-data-empty"><b>Sua evolução começará no primeiro treino</b><p>Depois do treino, informe tempo e distância na tela “Hoje”. A plataforma calculará a porcentagem de acerto.</p></section>}<div className="student-bottom"><article><span className="overline">PRÓXIMA PROVA</span><h3>{nextRace?.name||"Nenhuma prova cadastrada"}</h3>{nextRace&&<b>{raceDays} <small>dias</small></b>}</article><article><span className="overline">PLANEJAMENTO ATUAL</span><h3>{studentProfile?.planning?.phase||"Aguardando definição"}</h3><p>{studentProfile?.planning?`${studentProfile.planning.plan} · semana ${studentProfile.planning.week_number} de ${studentProfile.planning.total_weeks}`:"O professor ainda não definiu a fase."}</p></article></div></>}</>}
    {tab==="Mais"&&moreView==="menu"&&<><span className="overline">CONTA E APOIO</span><h1>Mais</h1><p>O essencial para manter seus treinos atualizados.</p><section className="student-more">{[["⚑","Provas e recordes","Próxima prova e melhores marcas","races"],["◎","Testes e zonas","Ritmos e frequência cardíaca","tests"],["♡","Dores e lesões","Avise rapidamente o treinador","pain"],["⌚","Integração com relógio","Strava, Garmin, Amazfit e Apple","integrations"],["$","Financeiro","Mensalidade e chave Pix","financial"],["○","Meu perfil","Cadastro e dias disponíveis","profile"]].map(([icon,title,desc,view])=><button key={title} onClick={()=>setMoreView(view)}><i>{icon}</i><span><b>{title}</b><small>{desc}</small></span><em>›</em></button>)}</section></>}
    {tab==="Mais"&&moreView==="tests"&&<StudentTestsView data={studentTests} back={()=>setMoreView("menu")}/>} 
    {tab==="Mais"&&moreView==="profile"&&<StudentProfileView data={studentProfile} back={()=>setMoreView("menu")}/>} 
    {tab==="Mais"&&moreView==="financial"&&<><button className="student-back" onClick={()=>setMoreView("menu")}>← Voltar</button><span className="overline">MENSALIDADE</span><h1>Financeiro</h1><p>Aqui aparece somente a situação informada pelo professor.</p>{!financialData?<section className="student-financial-card"><p>Carregando sua mensalidade…</p></section>:!financialData.payment?<section className="student-financial-card ok"><b>Sem pendência cadastrada</b><p>Nenhuma cobrança foi lançada para você.</p></section>:<section className={`student-financial-card ${financialData.payment.status==="Pago"?"ok":"pending"}`}><span>{financialData.payment.status==="Pago"?"PAGAMENTO REGISTRADO":"PENDÊNCIA"}</span><h2>{(financialData.payment.amount_cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</h2><p>Vencimento: {new Date(`${financialData.payment.due_date}T12:00:00`).toLocaleDateString("pt-BR")}</p>{financialData.payment.status==="Pendente"&&<div><small>CHAVE PIX</small><b>{financialData.settings?.pix_key||"Aguardando o professor informar"}</b><em>{financialData.settings?.pix_name||""}</em>{financialData.settings?.pix_key&&<button onClick={()=>void copyText(financialData.settings.pix_key)}>Copiar chave Pix</button>}</div>}{financialData.payment.status==="Pago"&&<strong>✓ Pago</strong>}</section>}</>}
    {tab==="Mais"&&moreView==="integrations"&&<><button className="student-back" onClick={()=>{setMoreView("menu");setIntegrationState("");setAppleSetup(null)}}>← Voltar</button><span className="overline">RELÓGIO E APLICATIVOS</span><h1>Integrações</h1><p>Conecte de onde a Zonas-App deve receber seus treinos realizados. Nada é acessado sem a sua autorização, e você pode desconectar quando quiser.</p>{appleSetup&&<section className="apple-ingest"><b>Seu token do Apple Saúde</b><p>O Apple Saúde não conversa direto com servidores. No iPhone, crie um Atalho que leia seus treinos e envie para o endereço abaixo com o cabeçalho <code>x-zonas-ingest-token</code>. Este token aparece uma única vez.</p><label>Endereço<code>{appleSetup.ingestUrl}</code></label><label>Token<code>{appleSetup.ingestToken}</code></label><div><button onClick={()=>void copyText(appleSetup.ingestToken)}>Copiar token</button><button onClick={()=>setAppleSetup(null)}>Já guardei</button></div></section>}<section className="integration-center">{(providers.length?providers:PROVIDER_PREVIEW).map((provider:ProviderCard)=>{const icons:Record<string,string>={strava:"S",garmin:"G",zepp:"A",apple:"●"};const connected=provider.connection?.status==="Conectado";const preferred=integrationPreference===provider.label;return <article key={provider.id} className={connected?"selected":""}><i>{icons[provider.id]||"○"}</i><div><b>{provider.label}</b><p>{provider.notes}</p><small>{connected?"CONECTADO COM AUTORIZAÇÃO SUA":!providers.length?"VERIFICANDO DISPONIBILIDADE…":provider.available===false?"AGUARDANDO CADASTRO OFICIAL DO PROFESSOR":"DISPONÍVEL PARA CONECTAR"}</small>{provider.connection?.last_sync_at&&<em className="integration-last-sync">Última importação: {new Date(Number(provider.connection.last_sync_at)).toLocaleString("pt-BR")}</em>}</div><div className="integration-actions">{connected?<><button onClick={()=>providerAction(provider.id,"disconnect")}>Desconectar</button>{provider.id==="strava"&&<button className="connected" disabled={integrationState==="saving"} onClick={()=>providerAction(provider.id,"sync")}>Sincronizar agora</button>}</>:<button disabled={integrationState==="saving"||provider.available===false} onClick={()=>providerAction(provider.id,"connect")}>{provider.available===false?"Indisponível":provider.authType==="device"?"Gerar token":"Conectar"}</button>}{!connected&&!preferred&&<button className="integration-prefer" disabled={integrationState==="saving"} onClick={()=>saveIntegration(provider.label)}>Marcar preferência</button>}</div></article>})}<footer><b>Como funciona</b><p>Você autoriza o serviço → a Zonas-App importa a atividade concluída → ela é comparada ao treino planejado → você e o professor veem a porcentagem de acerto. A Garmin também poderá receber o treino estruturado quando as APIs forem liberadas.</p></footer>{integrationState==="saved"&&<p className="integration-success">Pronto. Suas conexões foram atualizadas.</p>}{integrationState.startsWith("sincronizado:")&&<p className="integration-success">Importação concluída: {integrationState.split(":")[1]} atividade(s) nova(s).</p>}{integrationState==="sync-unavailable"&&<p className="integration-setup">A importação automática deste serviço ainda depende da liberação oficial da API.</p>}{integrationState==="setup-required"&&<p className="integration-setup">O fluxo seguro está pronto. Falta o professor cadastrar a Zonas-App no portal deste serviço e inserir as credenciais oficiais.</p>}{integrationState==="apple-ready"&&<p className="integration-success">Token gerado. Configure o Atalho no seu iPhone com os dados acima.</p>}{integrationState==="error"&&<p className="pain-error">Não foi possível concluir. Tente novamente.</p>}</section></>}
    {tab==="Mais"&&moreView==="pain"&&<><button className="student-back" onClick={()=>{setMoreView("menu");setPainState("")}}>← Voltar</button><span className="overline">AVISO AO TREINADOR</span><h1>Dores e lesões</h1><p>Preencha em menos de um minuto. O treinador receberá o aviso para revisar seu próximo treino.</p>{painState==="saved"?<section className="pain-success"><b>✓</b><h2>Aviso enviado ao treinador</h2><p>Evite treinos intensos enquanto houver dor. O treinador verá o relato antes de ajustar sua programação.</p><button onClick={()=>{setMoreView("menu");setPainState("")}}>Concluir</button></section>:<section className="pain-form"><label>Onde está o desconforto?<div className="pain-options">{["Joelho","Canela","Panturrilha","Coxa","Quadril","Pé/tornozelo","Coluna","Outro"].map(area=><button key={area} className={painArea===area?"selected":""} onClick={()=>setPainArea(area)}>{area}</button>)}</div></label><label>Intensidade da dor <b>{painIntensity}/10</b><input type="range" min="1" max="10" value={painIntensity} onChange={e=>setPainIntensity(+e.target.value)}/><div className="range-labels"><span>Leve</span><span>Forte</span></div></label><label>A dor atrapalhou o treino?<div className="pain-impact">{["Não treinei","Parei durante","Reduzi o ritmo","Consegui terminar"].map(item=><button key={item} className={painImpact===item?"selected":""} onClick={()=>setPainImpact(item)}>{item}</button>)}</div></label><label>Observação <small>opcional</small><textarea value={painNote} onChange={e=>setPainNote(e.target.value)} placeholder="Conte rapidamente quando começou ou qual movimento incomoda." maxLength={240}/></label>{painState==="error"&&<p className="pain-error">Não foi possível enviar. Tente novamente.</p>}<button className="pain-send" disabled={!painArea||!painImpact||painState==="saving"} onClick={sendPainReport}>{painState==="saving"?"Enviando…":"Avisar meu treinador"}</button><small className="pain-guidance">Em caso de dor intensa, inchaço importante ou dificuldade para caminhar, procure atendimento de saúde.</small></section>}</>}
    {tab==="Mais"&&moreView==="races"&&<><button className="student-back" onClick={()=>{setMoreView("menu");setRaceState("")}}>← Voltar</button><span className="overline">OBJETIVOS E MARCAS</span><h1>Provas e recordes</h1><p>Cadastre sua prova. O treinador analisa e confirma como ela entra no planejamento.</p><section className="race-record-head"><article><small>RECORDE NOS 10 KM</small><b>{raceData.records?.find((r:any)=>r.distance==="10 km")?.result_time||"33:28"}</b><span>Melhor marca registrada</span></article><article><small>PRÓXIMA PROVA</small><b>{raceData.races?.[0]?.name||"Corrida do SESI"}</b><span>{raceData.races?.[0]?`${raceData.races[0].race_date} · ${raceData.races[0].distance}`:"23/08/2026 · 10 km"}</span></article></section><section className="race-record-form"><span className="overline">NOVA PROVA</span><h2>Quero correr esta prova</h2><div className="race-fields"><label>Nome da prova<input value={raceForm.name} onChange={e=>setRaceForm({...raceForm,name:e.target.value})} placeholder="Ex.: Meia de Pomerode"/></label><label>Data<input type="date" value={raceForm.raceDate} onChange={e=>setRaceForm({...raceForm,raceDate:e.target.value})}/></label><label>Distância<select value={raceForm.distance} onChange={e=>setRaceForm({...raceForm,distance:e.target.value})}>{["5 km","10 km","21,1 km","42,2 km","Outra"].map(d=><option key={d}>{d}</option>)}</select></label><label>Cidade <small>opcional</small><input value={raceForm.city} onChange={e=>setRaceForm({...raceForm,city:e.target.value})}/></label><label className="full">Objetivo <small>opcional</small><input value={raceForm.goal} onChange={e=>setRaceForm({...raceForm,goal:e.target.value})} placeholder="Concluir, buscar recorde ou tempo desejado"/></label></div><button disabled={!raceForm.name||!raceForm.raceDate||raceState==="saving"} onClick={()=>saveRaceRecord("race")}>{raceState==="race-saved"?"Prova enviada para análise ✓":"Enviar prova ao treinador"}</button></section><section className="race-record-form compact"><span className="overline">NOVO RECORDE PESSOAL</span><h2>Registrar melhor marca</h2><div className="race-fields"><label>Distância<select value={recordForm.distance} onChange={e=>setRecordForm({...recordForm,distance:e.target.value})}>{["1,5 km","3 km","5 km","10 km","21,1 km","42,2 km"].map(d=><option key={d}>{d}</option>)}</select></label><label>Tempo<input value={recordForm.resultTime} onChange={e=>setRecordForm({...recordForm,resultTime:e.target.value})} placeholder="00:38:25"/></label><label>Data <small>opcional</small><input type="date" value={recordForm.raceDate} onChange={e=>setRecordForm({...recordForm,raceDate:e.target.value})}/></label><label>Prova <small>opcional</small><input value={recordForm.eventName} onChange={e=>setRecordForm({...recordForm,eventName:e.target.value})}/></label></div>{raceState==="error"&&<p className="pain-error">Não foi possível salvar. Tente novamente.</p>}<button disabled={!recordForm.resultTime||raceState==="saving"} onClick={()=>saveRaceRecord("record")}>{raceState==="record-saved"?"Recorde registrado ✓":"Salvar recorde"}</button></section></>}
    {tab==="Hoje"&&showTraining&&<WorkoutAnalysis secureStudentMode={secureStudentMode} weekStart={savedWeek?.week_start} workoutDay={today.key} session={todaySession}/>}{tab==="Hoje"&&<RecentWorkouts secureStudentMode={secureStudentMode}/>}  
  </section><nav className="student-nav">{[["Hoje","⌂"],["Minha semana","▤"],["Evolução","↗"],["Mais","≡"]].map(([name,icon])=><button key={name} className={tab===name?"active":""} onClick={()=>{setTab(name);if(name!=="Mais")setMoreView("menu")}}><i>{icon}</i><span>{name}</span></button>)}</nav></main>
}
