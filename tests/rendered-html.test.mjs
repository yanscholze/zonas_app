import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/**
 * O CSS passou a ser versionado formatado, mas as asserções abaixo foram
 * escritas contra a forma compacta. Compactar na leitura mantém os testes
 * verificando as regras em si, e não o recuo delas.
 */
async function readCss(path) {
  const source = typeof path === "string" && !path.startsWith("../")
    ? await readFile(path, "utf8")
    : await readFile(new URL(path, import.meta.url), "utf8");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([{};,>])\s*/g, "$1")
    .replace(/:\s+/g, ":")
    .replace(/;}/g, "}")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- *
 * Sessões da autenticação própria
 *
 * A identidade deixou de vir de um cabeçalho da plataforma e passou a vir de um
 * cookie de sessão resolvido no banco. Estes utilitários montam esse estado nos
 * bancos falsos dos testes, para que cada teste continue exercitando a sua
 * própria regra em vez do mecanismo de login.
 * -------------------------------------------------------------------------- */

const COACH_SESSION = "c".repeat(64);
const STUDENT_SESSION = "5".repeat(64);
const BLOCKED_SESSION = "b".repeat(64);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const SESSION_ACCOUNTS = {
  [sha256(COACH_SESSION)]: {
    id: "coach-account", email: "treinador@exemplo.com", name: "Jonas",
    role: "coach", athlete_name: null, status: "Ativo", must_change_password: 0,
  },
  [sha256(STUDENT_SESSION)]: {
    id: "student-account", email: "everton.teste@example.com", name: "Everton Barbosa",
    role: "student", athlete_name: "Everton Barbosa", status: "Ativo", must_change_password: 0,
  },
  [sha256(BLOCKED_SESSION)]: {
    id: "blocked-account", email: "aluno@example.com", name: "Aluno Bloqueado",
    role: "student", athlete_name: "Aluno Bloqueado", status: "Ativo", must_change_password: 0,
  },
};

const coachCookie = { cookie: `zonas_session=${COACH_SESSION}` };
const studentCookie = { cookie: `zonas_session=${STUDENT_SESSION}` };
const blockedCookie = { cookie: `zonas_session=${BLOCKED_SESSION}` };

function statement(resolveFirst, onRun) {
  return {
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return resolveFirst(this.values); },
    async all() { return { results: [] }; },
    async run() { onRun?.(this.values); return { success: true, meta: { changes: 1 } }; },
  };
}

/** Responde às consultas de sessão e delega todo o resto ao banco do teste. */
function withSession(prepare) {
  return (sql) => {
    if (sql.includes("FROM user_accounts WHERE role = 'coach'")) return statement(() => ({ id: "coach-account" }));
    if (sql.includes("FROM user_sessions WHERE token_hash")) {
      return statement(([tokenHash]) => {
        const account = SESSION_ACCOUNTS[tokenHash];
        return account ? { user_id: account.id, expires_at: Date.now() + 3_600_000 } : null;
      });
    }
    if (sql.includes("FROM user_accounts WHERE id")) {
      return statement(([id]) => Object.values(SESSION_ACCOUNTS).find((account) => account.id === id) ?? null);
    }
    if (sql.startsWith("UPDATE user_sessions")) return statement(() => null);
    return prepare(sql);
  };
}


test("makes ZonasApp installable on phones and computers", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const installer = await readFile(new URL("../app/InstallApp.tsx", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /<InstallApp \/>/);
  assert.match(installer, /beforeinstallprompt/);
  assert.match(installer, /Instalar ZonasApp/);
  assert.match(installer, /serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(installer, /registration\?\.update/);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.match(serviceWorker, /zonasapp-shell-v2/);
});

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("puts pending test approval directly on the tests screen", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /Testes aguardando liberação/);
  assert.match(source, /Revisar e liberar zonas/);
  assert.match(source, /Aprovar e usar nos treinos/);
  assert.match(source, /zonasapp:test-saved/);
  assert.match(source, /Zonas liberadas para os treinos de/);
});

test("opens the first reviewable workout from the calendar counter", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /const openFirstReview=/);
  assert.match(source, /programming-summary span:nth-child\(2\)/);
  assert.match(source, /Abrir \$\{statusCounts\.review\} treino para revisar/);
  assert.match(source, /\.weekly-planner/);
  assert.match(source, /scrollIntoView/);
});

test("continues from approved zones directly to the selected athlete calendar", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /Montar treino de \{athleteName\.split\(" "\)\[0\]\}/);
  assert.match(source, /sessionStorage\.setItem\("zonasapp:calendar-athlete",name\)/);
  assert.match(source, /sessionStorage\.getItem\("zonasapp:calendar-athlete"\)/);
  assert.match(source, /sessionStorage\.removeItem\("zonasapp:calendar-athlete"\)/);
  assert.match(source, /Agora monte a semana usando os ritmos individuais aprovados/);
});

test("keeps the same athlete selected through test calculation and zone approval", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("<PendingTestCenter") < source.indexOf("<TestCalculator"));
  assert.match(source, /new CustomEvent\("zonasapp:test-athlete",\{detail:athleteName\}\)/);
  assert.match(source, /addEventListener\("zonasapp:test-athlete",sync\)/);
  assert.match(source, /setAthleteName\(name\)/);
});

test("uses a computer-first workspace for weekly programming and workout building", async () => {
  const css = await readCss("../app/overrides.css");
  const globals = await readCss("../app/globals.css");
  assert.match(globals, /@import "\.\/overrides\.css"/);
  assert.match(css, /@media\(min-width:1200px\)/);
  assert.match(css, /\.programming-status\{position:sticky/);
  assert.match(css, /grid-template-columns:minmax\(0,1\.35fr\) minmax\(330px,\.65fr\)/);
  assert.match(css, /\.student-builder-preview\{grid-column:2/);
  assert.match(css, /width:min\(1120px,calc\(100vw - 260px\)\)/);
});

test("gives the student a polished mobile-first workout experience", async () => {
  const css = await readCss("../app/overrides.css");
  const globals = await readCss("../app/globals.css");
  assert.match(globals, /@import "\.\/overrides\.css"/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.today-card:before/);
  assert.match(css, /\.student-instructions:before/);
  assert.match(css, /\.student-nav button\.active/);
  assert.match(css, /\.quick-feedback>div button\.selected/);
  assert.match(css, /\.student-workout-analysis/);
});

test("lets the coach preview the exact experience of any selected athlete", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const css = await readCss("../app/overrides.css");
  assert.match(source, /previewAthleteName/);
  assert.match(source, /PRÉVIA DO PROFESSOR/);
  assert.match(source, /Visualizando como aluno/);
  assert.match(source, /<StudentView onBack=\{\(\) => setStudent\(false\)\} athleteName=/);
  assert.match(source, /athleteRecords\.map\(athlete=><option/);
  assert.match(css, /\.coach-student-preview/);
});

test("opens and reveals the complete workout when a student taps a week day", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const css = await readCss("../app/overrides.css");
  assert.match(source, /detail\?\.scrollIntoView\(\{behavior:"smooth",block:"start"\}\)/);
  assert.match(source, /detail\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(source, /className="student-week-detail" tabIndex=\{-1\}/);
  assert.match(css, /\.student-week-grid article\.selected/);
  assert.match(css, /scroll-margin-top/);
});

test("locks the visible app after thirty minutes of inactivity", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /30\*60\*1000/);
  assert.match(source, /Tela bloqueada por inatividade/);
  assert.match(source, /fetch\("\/api\/session",\{cache:"no-store"\}\)/);
});

test("requires a second confirmation for sensitive coach actions", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /Confirmar bloqueio de/);
  assert.match(source, /Confirmar: trancar semana/);
  assert.match(source, /Os treinos deixarão de aparecer imediatamente na área do aluno/);
  assert.match(source, /window\.confirm\(`CONFERÊNCIA AUTOMÁTICA/);
  assert.match(source, /Liberar esta semana para o aluno\?/);
  assert.match(source, /Complete os treinos estruturados antes de liberar/);
});

test("advances a plan week only after explicit coach approval", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /if\(!advanceConfirm\)\{setAdvanceConfirm\(true\);return\}/);
  assert.match(source, /await saveWeek\("Concluída"\)/);
  assert.match(source, /released&&currentPlanningWeek<currentPlanningTotal/);
  assert.match(source, /Os treinos próprios da semana seguinte serão carregados como rascunho/);
  assert.match(source, /await sessionsForSavedPlanWeek\(current\.plan,nextPlanningWeek,current\.days\)/);
  assert.match(source, /status:"Rascunho"/);
  assert.match(source, /phaseForPlanWeek\(current\.plan,nextPlanningWeek\)/);
});

test("shows a different base-plan template when the coach navigates between weeks", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /calendarPlanWeek/);
  assert.match(source, /await sessionsForSavedPlanWeek\(current\.plan,calendarPlanWeek,current\.days\)/);
  assert.match(source, /weekLabel:`\$\{calendarPlanWeek\} de \$\{currentPlanningTotal\}`/);
  assert.match(source, /setCalendarPlanWeek\(value=>Math\.min\(currentPlanningTotal,value\+1\)\)/);
  assert.match(source, /Usar semana \$\{calendarPlanWeek\} da planilha-base/);
  assert.match(source, /replaceWithBasePlanWeek/);
  assert.match(source, /sessions:expected,status:"Rascunho"/);
  assert.match(source, /O aluno deixará de ver a versão anterior até você revisar e liberar novamente/);
});

test("uses permanent library edits when loading or advancing an athlete week", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /api\/plan-template-overrides\?plan=/);
  assert.match(source, /data\.override\?\.sessions/);
  assert.match(source, /await sessionsForSavedPlanWeek\(current\.plan,nextPlanningWeek,current\.days\)/);
  assert.match(worker, /plan_template_overrides/);
  assert.match(worker, /ON CONFLICT\(plan_name,week_number\) DO UPDATE/);
});

test("links the structured workout to an athlete and shows the released steps to the student", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /TREINO DE \{athleteName\.toUpperCase\(\)\} · \{day\}/);
  assert.match(source, /steps:\[\.\.\.\(warmup\.minutes\?\[\{kind:"simple",label:"Aquecimento"/);
  assert.match(source, /Após cada repetição:/);
  assert.match(source, /Este é o mesmo treino montado e liberado pelo treinador/);
  assert.match(source, /todaySession\?\.steps\?\.length\?<StructuredWorkoutCard/);
  assert.match(source, /initialRepeats\.map/);
  assert.match(source, /Editar treino por etapas/);
  assert.match(source, /Atualizar treino completo de/);
  assert.match(source, /Confirmar troca/);
  assert.match(source, /Treino removido pelo treinador/);
  assert.match(source, /O aluno só verá a mudança depois de salvar e liberar/);
  assert.match(source, /!todaySession\.removed/);
  assert.match(source, /workoutDay=\{openedWeekDay\} session=\{openedWeekSession\}/);
});

test("uses approved Tempo Run paces as first-class workout intensities", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /"Tempo Run 5 km","Tempo Run 10 km","Tempo Run Meia maratona","Tempo Run Maratona"/);
  assert.match(source, /JSON\.parse\(approved\.tempo_runs\|\|"\[\]"\)/);
  assert.match(source, /ritmo individual aprovado/);
  assert.match(source, /Este aluno ainda não tem \$\{missingTempoRun\} aprovado/);
  assert.match(source, /intensity\?\.startsWith\("Tempo Run"\)\?`no \$\{intensity\}`/);
  assert.match(source, /Ritmo individual:/);
});

test("builds workout steps by minutes or meters without separating the recovery", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /<option value="min">Minutos<\/option><option value="m">Metros<\/option>/);
  assert.match(source, /effortUnit:"s",effortZone:"Z5",recovery:40,recoveryUnit:"s",recoveryZone:"Z1"/);
  assert.match(source, /effortMeters:step\.effort/);
  assert.match(source, /distanceMeters:step\.amount/);
  assert.match(source, /A recuperação acontece após cada repetição, inclusive a última/);
  assert.match(source, /step\.effortMeters\?`\$\{step\.effortMeters\} m`/);
});

test("allows a continuous workout without mandatory repeats or fixed blocks", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /setRepeatSteps\(current=>current\.filter\(step=>step\.id!==series\.id\)\)/);
  assert.match(source, /Remover série/);
  assert.match(source, /Treino contínuo/);
  assert.match(source, /Tempo \(0 remove\)/);
  assert.match(source, /warmup\.minutes\?\[\{kind:"simple",label:"Aquecimento"/);
  assert.match(source, /cooldown\.minutes\?\[\{kind:"simple",label:"Desaquecimento"/);
});

test("selects and persists the real calendar week instead of a fixed date", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /mondayOf\(new Date\(\)\.toISOString\(\)\.slice\(0,10\)\)/);
  assert.match(source, /Semana anterior/);
  assert.match(source, /Próxima semana/);
  assert.match(source, /weekStart=\$\{weekStart\}/);
  assert.match(source, /body:JSON\.stringify\(\{athleteName:selected,weekStart,plan:/);
  assert.match(source, /studentWeekLabel\.toUpperCase\(\)/);
});

test("copies the selected athlete's actual previous week into a reviewable draft", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /const previousStart=shiftIsoDate\(weekStart,-7\)/);
  assert.match(source, /weekStart=\$\{previousStart\}/);
  assert.match(source, /setSessions\(previousSessions\)/);
  assert.match(source, /Treinos copiados para esta semana como rascunho/);
  assert.match(source, /Nenhuma programação foi encontrada na semana anterior deste aluno/);
});

test("copies selected days from another athlete without replacing the rest of the week", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /COPIAR ENTRE ALUNOS/);
  assert.match(source, /weekStart=\$\{copyOtherWeek\}/);
  assert.match(source, /copyOtherDays\.filter\(day=>sourceSessions\[day\]\)/);
  assert.match(source, /setSessions\(value=>\(\{\.\.\.value,\.\.\.Object\.fromEntries\(copiedEntries\)\}\)\)/);
  assert.match(source, /Somente os dias marcados serão substituídos/);
});

test("loads the calendar from real athlete registrations and excludes blocked access", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/athletes"\)/);
  assert.match(client, /filter\(\(row:any\)=>row\.access_status!=="Bloqueado"\)/);
  assert.match(client, /JSON\.parse\(row\.training_days\|\|"\[\]"\)/);
  assert.match(client, /defaultPlanForDistance\(row\.distance\)/);
  assert.match(client, /Nenhum aluno disponível para receber treino/);
  assert.match(worker, /LEFT JOIN athlete_access ON athlete_access\.athlete_name = athletes\.name/);
  assert.match(worker, /LEFT JOIN athlete_planning ON athlete_planning\.athlete_name = athletes\.name/);
  assert.match(client, /row\.saved_plan\|\|defaultPlanForDistance/);
});

test("saves and reloads each athlete profile through protected persistence", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("athlete-profile", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return sql.includes("SELECT * FROM athlete_profiles") ? { athlete_name:"Everton Barbosa", phone:"47999990000", birth_date:"1997-11-11", objective:"10 km", integration:"Garmin", training_days:'["Ter","Qui","Sáb"]' } : null; },
    async all() { return { results: [] }; },
    async run() { writes.push({ sql, values:this.values }); return { success:true }; },
  });
  const env = { ASSETS:{fetch:async()=>new Response("Not found",{status:404})}, DB:{prepare:withSession(prepare),async batch(items){for(const item of items)await item.run();return[];}} };
  const headers = { "content-type":"application/json", ...coachCookie };
  const save = await worker.fetch(new Request("https://zonasapp.example/api/athlete-profile", {method:"POST",headers,body:JSON.stringify({athleteName:"Everton Barbosa",phone:"47999990000",birthDate:"1997-11-11",objective:"10 km",integration:"Garmin",trainingDays:["Ter","Qui","Sáb"]})}), env, {waitUntil(){},passThroughOnException(){}});
  assert.equal(save.status, 200);
  assert.ok(writes.some(({sql,values}) => sql.includes("INSERT INTO athlete_profiles") && values.includes("Everton Barbosa") && values.includes('["Ter","Qui","Sáb"]')));
  const load = await worker.fetch(new Request("https://zonasapp.example/api/athlete-profile?athlete=Everton%20Barbosa", {headers:{...coachCookie}}), env, {waitUntil(){},passThroughOnException(){}});
  assert.equal(load.status, 200);
  assert.equal((await load.json()).profile.integration, "Garmin");
});

test("saves the athlete's base plan, phase and selected week", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("athlete-planning", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes=[];
  const prepare=(sql)=>({values:[],bind(...values){this.values=values;return this},async first(){return sql.includes("SELECT * FROM athlete_planning")?{athlete_name:"Everton Barbosa",plan:"10 km Lion",phase:"Específica",week_number:8,total_weeks:16}:null},async run(){writes.push({sql,values:this.values});return{success:true}}});
  const env={ASSETS:{fetch:async()=>new Response("Not found",{status:404})},DB:{prepare:withSession(prepare),async batch(items){for(const item of items)await item.run();return[]}}};
  const headers={"content-type":"application/json",...coachCookie};
  const save=await worker.fetch(new Request("https://zonasapp.example/api/athlete-planning",{method:"POST",headers,body:JSON.stringify({athleteName:"Everton Barbosa",plan:"10 km Lion",phase:"Específica",weekNumber:8,totalWeeks:16})}),env,{waitUntil(){},passThroughOnException(){}});
  assert.equal(save.status,200);
  assert.ok(writes.some(({sql,values})=>sql.includes("INSERT INTO athlete_planning")&&values.includes("10 km Lion")&&values.includes(8)));
  const load=await worker.fetch(new Request("https://zonasapp.example/api/athlete-planning?athlete=Everton%20Barbosa",{headers:{...coachCookie}}),env,{waitUntil(){},passThroughOnException(){}});
  assert.equal((await load.json()).planning.week_number,8);
});

test("calculates and saves 3 km performance tests on the server", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("performance-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes=[];
  const prepare=(sql)=>({values:[],bind(...values){this.values=values;return this},async first(){return null},async all(){return{results:[]}},async run(){writes.push({sql,values:this.values});return{success:true}}});
  const env={ASSETS:{fetch:async()=>new Response("Not found",{status:404})},DB:{prepare:withSession(prepare),async batch(items){for(const item of items)await item.run();return[];}}};
  const response=await worker.fetch(new Request("https://zonasapp.example/api/performance-tests",{method:"POST",headers:{"content-type":"application/json",...coachCookie},body:JSON.stringify({athleteName:"Everton Barbosa",testDate:"2026-08-21",distanceKm:3,minutes:10,seconds:0,age:28})}),env,{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,201);
  const saved=await response.json();
  assert.equal(saved.status,"Aguardando revisão");
  assert.equal(saved.vam,18);
  assert.equal(saved.fcMax,192);
  assert.equal(saved.zones.length,5);
  assert.equal(saved.tempoRuns.length,4);
  assert.ok(writes.some(({sql,values})=>sql.includes("INSERT INTO performance_tests")&&values.includes("Everton Barbosa")&&values.includes("Aguardando revisão")));
});

test("approves only complete and valid coach-reviewed zones", async () => {
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("approve-zones",`${process.pid}-${Date.now()}`);const{default:worker}=await import(workerUrl.href);
  const writes=[];const prepare=(sql)=>({values:[],bind(...values){this.values=values;return this},async first(){return null},async all(){return{results:[]}},async run(){writes.push({sql,values:this.values});return{success:true}}});const env={ASSETS:{fetch:async()=>new Response("Not found",{status:404})},DB:{prepare:withSession(prepare),async batch(items){for(const item of items)await item.run();return[];}}};
  const zones=[1,2,3,4,5].map((n)=>({z:`Z${n}`,label:"Zona",slow:480-n*35,fast:450-n*35}));
  const tempoRuns=[["5 km",240],["10 km",250],["Meia maratona",265],["Maratona",280]].map(([label,targetPace])=>({label,targetPace,projectedTotal:3600}));
  const response=await worker.fetch(new Request("https://zonasapp.example/api/performance-tests",{method:"POST",headers:{"content-type":"application/json",...coachCookie},body:JSON.stringify({id:"test-1",action:"approve",zones,tempoRuns})}),env,{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,200);assert.equal((await response.json()).status,"Aprovado");assert.ok(writes.some(({sql,values})=>sql.includes("UPDATE performance_tests")&&values.includes("Aprovado")&&values.includes("test-1")));
});

test("does not expose development preview metadata in production", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "terminal.local:4173" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.doesNotMatch(await response.text(), developmentPreviewMeta);
});

test("adds browser security headers and prevents private API caching", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("browser-security", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: {
      prepare: withSession(() => ({ bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { success: true }; } })),
      async batch(items) { for (const item of items) await item.run(); return []; },
    },
  };

  const page = await worker.fetch(new Request("https://zonasapp.example/"), env, ctx);
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'self' https:\/\/chatgpt\.com https:\/\/\*\.chatgpt\.com/);
  assert.match(page.headers.get("content-security-policy") ?? "", /object-src 'none'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("x-frame-options"), null);
  assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(page.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");

  const api = await worker.fetch(new Request("https://zonasapp.example/api/session"), env, ctx);
  assert.equal(api.headers.get("cache-control"), "no-store, private");
  assert.equal(api.headers.get("pragma"), "no-cache");
});

test("protects coach APIs from anonymous and non-coach users", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("security", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: {
      prepare: withSession(() => ({ bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { success: true }; } })),
      async batch(statements) { for (const item of statements) await item.run(); return []; },
    },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const anonymous = await worker.fetch(
    new Request("https://zonasapp.example/api/session"),
    env,
    ctx,
  );
  assert.equal(anonymous.status, 401);

  const student = await worker.fetch(
    new Request("https://zonasapp.example/api/session", {
      headers: { ...blockedCookie },
    }),
    env,
    ctx,
  );
  assert.equal(student.status, 403);
});

test("identifies an active student and scopes every student query to that athlete", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("student-scope", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const reads = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; reads.push({ sql, values }); return this; },
    async first() {
      if (sql.includes("FROM athlete_access")) return { athlete_name: "Everton Barbosa", status: "Ativo" };
      if (sql.includes("FROM training_weeks")) return { athlete_name: "Everton Barbosa", status: "Liberada", sessions: "{}" };
      return null;
    },
    async all() { return { results: [] }; },
    async run() { return { success: true }; },
  });
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(statements) { for (const item of statements) await item.run(); return []; } },
  };
  const headers = { ...studentCookie };

  const session = await worker.fetch(new Request("https://zonasapp.example/api/session", { headers }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authenticated: true, role: "student", userId: "student-account", name: "Everton Barbosa",
    email: "everton.teste@example.com", athleteName: "Everton Barbosa", mustChangePassword: false,
  });

  const dashboard = await worker.fetch(new Request("https://zonasapp.example/api/student/dashboard?athlete=Marina%20Costa", { headers }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(dashboard.status, 200);
  assert.equal((await dashboard.json()).athleteName, "Everton Barbosa");
  const athleteDataReads = reads.filter(({ sql }) => /training_weeks|athlete_races|personal_records/.test(sql) && /SELECT/.test(sql));
  assert.ok(athleteDataReads.length >= 3);
  assert.ok(athleteDataReads.every(({ values }) => values[0] === "Everton Barbosa"));
  assert.ok(athleteDataReads.every(({ values }) => !values.includes("Marina Costa")));
});

test("identifies the authorized coach on protected APIs", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("coach", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://zonasapp.example/api/session", {
      headers: { ...coachCookie },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: withSession(() => ({ bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return { success: true }; } })),
        async batch(statements) { for (const item of statements) await item.run(); return []; },
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    role: "coach",
    userId: "coach-account",
    name: "Jonas",
    email: "treinador@exemplo.com",
    mustChangePassword: false,
  });
});

test("saves a normalized student email only through the authorized coach", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("athlete-access", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const statement = (sql) => ({
    bind(...values) { this.values = values; return this; },
    async first() { return null; },
    async run() { writes.push({ sql, values: this.values ?? [] }); return { success: true }; },
  });
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: {
      prepare: withSession(statement),
      async batch(statements) { for (const prepared of statements) await prepared.run(); return []; },
    },
  };
  const response = await worker.fetch(
    new Request("https://zonasapp.example/api/athlete-access", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...coachCookie,
      },
      body: JSON.stringify({ athleteName: "Everton", email: " Everton.Teste@Example.com ", status: "Convite preparado" }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.email, "everton.teste@example.com");
  assert.equal(body.athleteName, "Everton");
  assert.ok(writes.some(({ sql, values }) => sql.includes("INSERT INTO athlete_access") && values.includes("everton.teste@example.com")));
});

test("records final activation and denies a blocked student", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("activation", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  let activeLookup = false;
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() {
      if (sql.includes("FROM athlete_access") && sql.includes("status = 'Ativo'")) return activeLookup ? { athlete_name: "Everton Barbosa" } : null;
      return null;
    },
    async run() { writes.push({ sql, values: this.values }); return { success: true }; },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const coachHeaders = { "content-type": "application/json", ...coachCookie };

  const activation = await worker.fetch(new Request("https://zonasapp.example/api/athlete-access", { method: "POST", headers: coachHeaders, body: JSON.stringify({ athleteName: "Everton Barbosa", email: "everton@example.com", status: "Ativo" }) }), env, ctx);
  assert.equal(activation.status, 201);
  const activated = await activation.json();
  assert.equal(activated.status, "Ativo");
  assert.ok(Number.isFinite(activated.activatedAt));
  assert.ok(writes.some(({ sql, values }) => sql.includes("INSERT INTO athlete_access") && values.includes("Ativo") && values.filter(value => value === activated.activatedAt).length >= 2));
  assert.ok(writes.some(({ sql, values }) => sql.includes("INSERT INTO access_audit_log") && values.includes("Acesso ativado") && values.includes("treinador@exemplo.com") && !sql.toLowerCase().includes("password")));

  const existingAccess = { email: "everton@example.com", status: "Ativo" };
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = (sql) => {
    const prepared = originalPrepare(sql);
    if (sql.includes("SELECT email, status FROM athlete_access")) prepared.first = async () => existingAccess;
    return prepared;
  };
  const revoke = await worker.fetch(new Request("https://zonasapp.example/api/athlete-access", { method: "POST", headers: coachHeaders, body: JSON.stringify({ athleteName: "Everton Barbosa", email: "everton@example.com", status: "Bloqueado" }) }), env, ctx);
  assert.equal(revoke.status, 201);
  assert.ok(writes.some(({ sql, values }) => sql.includes("INSERT INTO access_audit_log") && values.includes("Sessões e acesso encerrados")));

  activeLookup = false;
  const blocked = await worker.fetch(new Request("https://zonasapp.example/api/session", { headers: { ...studentCookie } }), env, ctx);
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "access_not_active" });
});

test("keeps a self-registration pending until the coach approves it", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const entry = await readFile(new URL("../app/StudentEntry.tsx", import.meta.url), "utf8");
  assert.match(source, /url\.pathname === "\/api\/access-request"/);
  assert.match(source, /status:"Pendente"/);
  assert.match(source, /action\s*===\s*"approve"/);
  assert.match(source, /Cadastro solicitado aprovado/);
  assert.match(entry, /Aguardando liberação do professor/);
  assert.match(entry, /Enviar para aprovação do professor/);
});

test("offers the coach a copyable and shareable student registration link", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(source, /LINK PARA NOVOS ALUNOS/);
  // A cópia passa pelo helper compartilhado, que sabe cair para o caminho
  // alternativo quando a Clipboard API não existe.
  assert.match(source, /copyText\(message\)/);
  assert.match(source, /navigator\.share/);
  assert.match(source, /Enviar no WhatsApp/);
  assert.match(source, /https:\/\/wa\.me/);
  assert.match(source, /Instalar ZonasApp/);
});

test("gives coach and student actionable notification centers", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const css = await readCss("../app/globals.css");
  assert.match(source, /CENTRAL DE AVISOS/);
  assert.match(source, /Novo aluno aguardando liberação/);
  assert.match(source, /Teste aguardando liberação das zonas/);
  assert.match(source, /NOVIDADES DO SEU TREINADOR/);
  assert.match(source, /Sua semana foi liberada/);
  assert.match(source, /Suas zonas de treino foram liberadas/);
  assert.match(source, /Marcar aviso como lido/);
  assert.match(css, /\.coach-notification-center/);
  assert.match(css, /\.student-notification-center/);
});

test("simplifies finance, refreshes student visuals, and exports recovery backups", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const visual = await readCss("../app/overrides.css");
  assert.match(client, /PASSO A PASSO FINANCEIRO/);
  assert.match(client, /Gerar cobranças do mês/);
  assert.match(client, /Baixar cópia/);
  assert.match(client, /Última cópia há/);
  assert.match(worker, /zonasapp-backup-v1/);
  assert.match(worker, /content-disposition/);
  assert.match(visual, /\.student-week-grid/);
  assert.match(visual, /grid-template-columns:1fr/);
});

test("persists student workout feedback for coach review", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(worker, /\/api\/student\/feedbacks/);
  assert.match(worker, /INSERT INTO training_feedbacks/);
  assert.match(worker, /status='Revisado'/);
  assert.match(app, /RETORNO REAL DOS TREINOS/);
  assert.match(app, /Marcar como revisado/);
});

test("creates a coach-only recovery snapshot without student access records", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("backup", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async all() { return { results: sql.includes("FROM athletes") ? [{ id: "a1", name: "Aluno Teste" }] : [] }; },
    async first() { return null; },
    async run() { writes.push({ sql, values: this.values }); return { success: true }; },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const response = await worker.fetch(new Request("https://zonasapp.example/api/backups", { method: "POST", headers: { "content-type": "application/json", ...coachCookie }, body: JSON.stringify({ label: "Backup de teste" }) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 201);
  const saved = writes.find(({ sql }) => sql.includes("INSERT INTO data_backups"));
  assert.ok(saved);
  assert.ok(saved.values.some(value => typeof value === "string" && value.includes("Aluno Teste")));
  assert.ok(saved.values.every(value => typeof value !== "string" || !value.includes("athlete_access")));
});

test("temporarily blocks excessive sensitive actions and records the event", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("rate-limit", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  let requestCount = 0;
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async all() { return { results: [] }; },
    async first() { return sql.includes("SELECT request_count") ? { request_count: requestCount } : null; },
    async run() {
      if (sql.includes("INSERT INTO request_rate_limits")) requestCount += 1;
      writes.push({ sql, values: this.values });
      return { success: true };
    },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const request = () => new Request("https://zonasapp.example/api/backups", { method: "POST", headers: { "content-type": "application/json", ...coachCookie }, body: JSON.stringify({ label: "Backup de teste" }) });
  for (let index = 0; index < 10; index += 1) assert.equal((await worker.fetch(request(), env, ctx)).status, 201);
  const blocked = await worker.fetch(request(), env, ctx);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.ok(writes.some(({ sql, values }) => sql.includes("INSERT INTO security_events") && values.includes("treinador@exemplo.com") && values.includes("/api/backups")));
  const auditWrites = writes.filter(({ sql }) => /INSERT INTO (security_events|request_rate_limits)/.test(sql));
  assert.ok(auditWrites.length > 0);
  assert.ok(auditWrites.every(({ sql }) => !sql.toLowerCase().includes("password") && !sql.toLowerCase().includes("ip_address")));
  assert.ok(auditWrites.every(({ values }) => values.every((value) => !/senha|password/i.test(String(value)))));
});

test("rejects oversized, malformed, and unexpected API input before saving", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("payload-validation", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return null; },
    async run() { writes.push({ sql, values: this.values }); return { success: true }; },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const headers = { "content-type": "application/json", ...coachCookie };

  const oversized = await worker.fetch(new Request("https://zonasapp.example/api/athletes", { method: "POST", headers, body: JSON.stringify({ name: "A".repeat(70_000) }) }), env, ctx);
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "payload_too_large");

  const malformed = await worker.fetch(new Request("https://zonasapp.example/api/athletes", { method: "POST", headers, body: "{nome" }), env, ctx);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "invalid_json");

  const unexpected = await worker.fetch(new Request("https://zonasapp.example/api/athletes", { method: "POST", headers, body: JSON.stringify({ name: "Aluno", password: "não deve entrar" }) }), env, ctx);
  assert.equal(unexpected.status, 400);
  assert.equal((await unexpected.json()).error, "unexpected_field");
  assert.ok(writes.every(({ sql }) => !sql.includes("INSERT INTO athletes")));
});

test("accepts a save once and blocks an identical repeated submission", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("deduplication", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  let reservedToken = null;
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() {
      if (sql.includes("SELECT request_token")) return reservedToken ? { request_token: reservedToken } : null;
      return null;
    },
    async run() {
      if (sql.includes("INSERT OR IGNORE INTO request_deduplication") && !reservedToken) reservedToken = this.values[1];
      writes.push({ sql, values: this.values });
      return { success: true };
    },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const request = () => new Request("https://zonasapp.example/api/athletes", { method: "POST", headers: { "content-type": "application/json", ...coachCookie }, body: JSON.stringify({ name: "Aluno Único", initials: "AU", distance: "5 km", phase: "Base", week: "1", nextWorkout: "Terça" }) });

  assert.equal((await worker.fetch(request(), env, ctx)).status, 201);
  const repeated = await worker.fetch(request(), env, ctx);
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).error, "duplicate_submission");
  assert.equal(writes.filter(({ sql }) => sql.includes("INSERT INTO athletes")).length, 1);
});

test("records who changed a training week and preserves both snapshots", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("week-audit", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return sql.includes("SELECT * FROM training_weeks") ? { athlete_name: "Everton Barbosa", week_start: "2026-08-10", plan: "10 km Lion", phase: "Base", week_label: "3 de 16", training_days: "[]", sessions: "{}", status: "Rascunho", updated_at: 100 } : null; },
    async run() { writes.push({ sql, values: this.values }); return { success: true }; },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const structured = { description: "Treino completo", steps: [{ type: "Parte principal", duration: 30, unit: "min", intensity: "Z3" }] };
  const response = await worker.fetch(new Request("https://zonasapp.example/api/training-weeks", { method: "POST", headers: { "content-type": "application/json", ...coachCookie }, body: JSON.stringify({ athleteName: "Everton Barbosa", weekStart: "2026-08-10", plan: "10 km Lion", phase: "Específica", weekLabel: "4 de 16", trainingDays: ["TER","QUI","SÁB"], sessions: { TER: structured, QUI: structured, SÁB: structured }, status: "Liberada" }) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 201);
  const audit = writes.find(({ sql }) => sql.includes("INSERT INTO training_week_audit"));
  assert.ok(audit);
  assert.ok(audit.values.includes("treinador@exemplo.com"));
  assert.ok(audit.values.some(value => typeof value === "string" && value.startsWith("Semana liberada")));
  assert.ok(audit.values.some(value => typeof value === "string" && value.includes("updated_at") && value.includes("100")));
  assert.ok(audit.values.some(value => typeof value === "string" && value.includes("Específica") && value.includes("Liberada")));
});

test("records operational failures without storing personal data", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("error-monitor", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return null; },
    async all() { if (sql.includes("FROM athletes")) throw new Error("private database detail"); return { results: [] }; },
    async run() { writes.push({ sql, values: this.values }); return { success: true }; },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const response = await worker.fetch(new Request("https://zonasapp.example/api/athletes", { headers: { ...coachCookie } }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 503);
  const logged = writes.find(({ sql }) => sql.includes("INSERT INTO application_errors"));
  assert.ok(logged);
  assert.ok(logged.values.includes("alunos"));
  assert.ok(logged.values.includes("database_unavailable"));
  assert.ok(logged.values.every(value => value !== "treinador@exemplo.com" && value !== "private database detail"));
  assert.ok(!logged.sql.toLowerCase().includes("email") && !logged.sql.toLowerCase().includes("password"));
});

test("automatically removes only expired technical security records", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("retention", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return sql.includes("COUNT(*)") ? { total: 0 } : null; },
    async all() { return { results: [] }; },
    async run() { writes.push({ sql, values: this.values }); return { success: true }; },
  });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } } };
  const response = await worker.fetch(new Request("http://terminal.local:4173/api/application-errors", { headers: { ...coachCookie } }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).retentionDays, 90);
  const cleanup = writes.find(({ sql }) => sql.includes("DELETE FROM application_errors WHERE created_at <"));
  assert.ok(cleanup);
  assert.equal(cleanup.values.length, 1);
  assert.ok(cleanup.values[0] <= Date.now() - 89 * 86_400_000);
  assert.ok(writes.every(({ sql }) => !/DELETE FROM (athletes|training_weeks|pain_reports|athlete_races|personal_records|data_backups)/.test(sql)));
});

test("compares each completed workout with the released plan and shows both percentages", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /status = 'Liberada'/);
  assert.match(worker, /100 - Math\.abs\(actualMinutes - plannedMinutes\)/);
  assert.match(worker, /correct >= 80 \? "Dentro do planejado"/);
  assert.match(worker, /wrong: 100 - correct/);
  assert.match(client, /Concluí este treino/);
  assert.match(client, /treino certo/);
  assert.match(client, /fora do planejado/);
  assert.match(client, /WorkoutAccuracy/);
  assert.match(client, /Strava, Garmin, Amazfit e Apple/);
});

test("offers a truthful integration center without claiming external authorization", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /RELÓGIO E APLICATIVOS/);
  assert.match(client, /Nada é acessado sem a sua autorização/);
  assert.match(client, /Strava/);
  assert.match(client, /Apple Saúde \/ Apple Watch/);
  assert.match(client, /AGUARDANDO CADASTRO OFICIAL DO PROFESSOR/);
  assert.match(worker, /student\/integration-preference/);
  assert.match(worker, /Aguardando conexão oficial/);
});

test("gives the coach a real overview of every athlete integration", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /Integrações dos alunos/);
  assert.match(client, /Sem conexão falsa/);
  assert.match(client, /ÚLTIMA IMPORTAÇÃO/);
  assert.match(client, /Integrações prioritárias: Garmin e Amazfit/);
  assert.match(worker, /integration-overview/);
  assert.match(worker, /Aguardando conexão oficial/);
  assert.match(worker, /last_import_at/);
});

test("prepares Garmin and Amazfit without pretending they are connected", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /PRIMEIRAS CONEXÕES/);
  assert.match(client, /Cadastro e credenciais oficiais/);
  assert.match(client, /Receber atividades realizadas/);
  assert.match(client, /Enviar treinos estruturados/);
  assert.match(client, /developer\.garmin\.com/);
  assert.match(client, /developer\.zepp\.com/);
  assert.match(worker, /GARMIN_ACTIVITY_API_ENABLED/);
  assert.match(worker, /GARMIN_TRAINING_API_ENABLED/);
  assert.match(worker, /ZEPP_WEBHOOK_SECRET/);
  assert.match(worker, /integration-readiness/);
  assert.doesNotMatch(client, /GARMIN_CONSUMER_SECRET|ZEPP_APP_SECRET|ZEPP_WEBHOOK_SECRET/);
});

test("provides the public documents and application profile required by device portals", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  const terms = await readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
  assert.match(client, /Ficha oficial da Zonas-App/);
  assert.match(client, /Política de Privacidade/);
  assert.match(client, /Termos de Uso/);
  assert.match(client, /PRONTA PARA COPIAR/);
  assert.match(client, /As credenciais recebidas depois nunca devem ser coladas nesta tela/);
  assert.match(privacy, /Dados de relógios e aplicativos somente serão acessados depois da autorização expressa/);
  assert.match(terms, /não exibirá uma integração como ativa antes da confirmação oficial/);
});

test("prepares a secure Strava OAuth flow without exposing tokens to the browser", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const providers = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  assert.match(client, /providerAction\(provider\.id,"connect"\)/);
  assert.match(client, /portal deste serviço/);
  assert.match(providers, /https:\/\/www\.strava\.com\/oauth\/authorize/);
  assert.match(providers, /https:\/\/www\.strava\.com\/api\/v3\/oauth\/token/);
  assert.match(providers, /activity:read_all/);
  assert.match(worker, /AES-GCM/);
  // O `state` só existe hasheado no banco e o fluxo expira em dez minutos.
  assert.match(worker, /oauth_flows/);
  assert.match(worker, /sha256Text\(rawState\)/);
  assert.doesNotMatch(client, /access_token_encrypted|refresh_token_encrypted|STRAVA_CLIENT_SECRET/);
});

test("provides individual Pix charges scoped to each authenticated student", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /COBRANÇAS INDIVIDUAIS/);
  assert.match(client, /Valor e vencimento de cada aluno/);
  assert.match(client, /Lançar pendência/);
  assert.match(client, /Atualizar cobrança/);
  assert.match(client, /Vencidos e próximos do vencimento/);
  assert.match(client, /Marcar pago/);
  assert.match(client, /Copiar chave Pix/);
  assert.match(client, /Sem pendência cadastrada/);
  assert.match(client, /const parseMoney=/);
  assert.match(client, /formatMoneyInput\(row\.amount_cents\/100\)/);
  assert.match(client, /inputMode="decimal"/);
  assert.match(client, /Exemplo: 95,00/);
  assert.match(client, /financial-month-controls/);
  assert.match(client, /Mês anterior/);
  assert.match(client, /paymentFilter/);
  assert.match(client, /Vencidos/);
  assert.match(client, /Vence em breve/);
  assert.match(client, /const paymentTiming=/);
  assert.match(client, /sem bloquear os treinos/);
  assert.match(client, /Sem cobrança/);
  assert.match(worker, /update_payment/);
  assert.match(worker, /delete_payment/);
  assert.match(worker, /DELETE FROM student_payments WHERE athlete_name=\? AND reference_month=\?/);
  assert.match(worker, /student_payments/);
  assert.match(client, /Remover a cobrança de/);
  assert.match(client, /O aluno não verá mais essa pendência/);
  assert.match(worker, /student\/financial/);
  assert.match(worker, /studentFinancialApi/);
  assert.match(worker, /WHERE athlete_name=\?/);
  assert.match(client, /Valor padrão/);
  assert.match(client, /Gerar cobranças do mês/);
  assert.match(worker, /generate_month/);
});

test("shows only the real released workout for the current Brazilian day", async () => {
  const source = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /function brazilCalendar\(\)/);
  assert.match(source, /const todaySession=completeSessionForStudent\(savedSessions\?\.\[today\.key\]\)/);
  assert.match(source, /function completeSessionForStudent/);
  assert.match(source, /Ver treino completo/);
  assert.match(source, /Aquecimento/);
  assert.match(source, /Desaquecimento/);
  assert.match(source, /applyQuickModel/);
  assert.match(source, /showTraining=Boolean\(savedWeek\?\.status==="Liberada"&&todaySession&&!todaySession\.removed\)/);
  assert.match(source, /workoutDay=\{today\.key\}/);
  assert.doesNotMatch(source, /SÁBADO, 15 DE AGOSTO/);
  assert.doesNotMatch(source, /TREINO ENVIADO AO GARMIN/);
  assert.doesNotMatch(source, /Garmin conectado · alertas/);
  assert.match(workerSource, /week_start = \? AND status = 'Liberada'/);
  assert.match(workerSource, /currentWeekStart/);
});

test("uses the current calendar week when the coach previews the student area", async () => {
  const source = await readFile("app/ZonasAppClient.tsx", "utf8");
  assert.match(source, /const currentWeekStart=mondayOf\(new Date\(\)\.toISOString\(\)\.slice\(0,10\)\)/);
  assert.match(source, /weekStart=\$\{currentWeekStart\}/);
  assert.doesNotMatch(source, /weekStart=2026-08-10/);
});

test("opens the student's real profile and only coach-approved training zones", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /\["◎","Testes e zonas","Ritmos e frequência cardíaca","tests"\]/);
  assert.match(client, /\["○","Meu perfil","Cadastro e dias disponíveis","profile"\]/);
  assert.match(client, /\/api\/student\/performance-tests/);
  assert.match(client, /test\.status==="Aprovado"/);
  assert.match(client, /Somente ritmos revisados e liberados pelo professor/);
  assert.match(client, /\/api\/student\/profile/);
  assert.match(worker, /studentProfileApi\(request, env, identity\.athleteName\)/);
  assert.match(worker, /studentPerformanceTestsApi\(request, env, identity\.athleteName\)/);
  assert.match(worker, /WHERE athlete_name = \? ORDER BY test_date DESC,created_at DESC/);
});

test("builds student evolution from recorded workouts instead of demonstration numbers", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(client, /\/api\/student\/workout-executions/);
  assert.match(client, /PLANEJADO/);
  assert.match(client, /REALIZADO/);
  assert.match(client, /ÚLTIMOS RETORNOS REAIS/);
  assert.match(client, /Este aluno ainda não registrou resultados ou feedbacks/);
  assert.match(client, /const monthExecutions=executions\.filter/);
  assert.match(client, /correct_percentage/);
  assert.match(client, /VOLUME REGISTRADO NO MÊS/);
  assert.match(client, /Sua evolução começará no primeiro treino/);
  assert.doesNotMatch(client, /86,4 <em>km<\/em>/);
  assert.doesNotMatch(client, /83% concluídos/);
  assert.doesNotMatch(client, /\[\["20–26 jul",3,3\]/);
});

test("uses real coach dashboard counts and reviews every registered race", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(client, /athletes\.filter\(athlete=>athlete\.distance===name\)\.length/);
  assert.match(client, /racesWaiting=pendingRaces\.filter/);
  assert.match(client, /fetch\("\/api\/races-records"\)/);
  assert.match(client, /action:"review_race"/);
  assert.match(client, /Aprovar e usar no planejamento/);
  assert.match(worker, /SELECT \* FROM athlete_races ORDER BY race_date ASC/);
  assert.match(worker, /UPDATE athlete_races SET status = \?, priority = \?/);
  assert.doesNotMatch(client, /<b>48<\/b>/);
  assert.doesNotMatch(client, /31<em>\/48<\/em>/);
});

test("applies a selected base plan, phase and week to a real athlete", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const css = await readCss("../app/globals.css");
  assert.match(client, /className="template-athlete-select"/);
  assert.match(client, /const applyPlan=async/);
  assert.match(client, /const meiaStartPlanWeeks/);
  assert.match(client, /"Meia Start":meiaStartPlanWeeks/);
  assert.match(client, /Primeira meia maratona/);
  assert.match(client, /adaptedTemplate/);
  assert.match(client, /Ver e editar treino/);
  assert.match(client, /editingTemplateIndex/);
  assert.match(client, /onSave=\{saveTemplateEdit\}/);
  assert.match(client, /effectiveTemplate\[editingTemplateIndex\]/);
  assert.match(client, /As alterações serão usadas neste rascunho/);
  assert.match(client, /const meiaFinishPlanWeeks/);
  assert.match(client, /"Meia Finish":meiaFinishPlanWeeks/);
  assert.match(client, /Tempo Run combinado 5 km e meia/);
  assert.match(client, /Prova-alvo de meia maratona/);
  assert.match(client, /const oneMarathonPlanWeeks/);
  assert.match(client, /"One Marathon":oneMarathonPlanWeeks/);
  assert.match(client, /Longão principal com ritmo/);
  assert.match(client, /Primeira maratona/);
  assert.match(client, /const fullMarathonPlanWeeks/);
  assert.match(client, /"Full Marathon":fullMarathonPlanWeeks/);
  assert.match(client, /Maior longão específico/);
  assert.match(client, /Maratona-alvo Full/);
  assert.match(client, /athleteName:targetAthlete,plan:plan\.name,phase:planningPhaseFor\(week\),weekNumber:week,totalWeeks:plan\.weeks/);
  assert.match(client, /Aplicar base, fase e semana/);
  assert.match(client, /Semana \{week\} criada como rascunho em/);
  assert.match(client, /const beginnerPlanWeeks/);
  assert.match(client, /const bronzePlanWeeks/);
  assert.match(client, /const prataPlanWeeks/);
  assert.match(client, /const ouroPlanWeeks/);
  assert.match(client, /const elitePlanWeeks/);
  assert.match(client, /const lion10kPlanWeeks/);
  assert.match(client, /"5 km Bronze":bronzePlanWeeks/);
  assert.match(client, /"5 km Prata":prataPlanWeeks/);
  assert.match(client, /"5 km Ouro":ouroPlanWeeks/);
  assert.match(client, /"5 km Elite":elitePlanWeeks/);
  assert.match(client, /"10 km Lion":lion10kPlanWeeks/);
  assert.match(client, /Prova-alvo de 10 km/);
  assert.match(client, /Prova-alvo de 5 km Elite/);
  assert.match(client, /Prova-alvo de 5 km Ouro/);
  assert.match(client, /Prova-alvo de 5 km/);
  assert.match(client, /Desafio ou prova de 5 km/);
  assert.match(client, /Treinos reais cadastrados em todas as semanas/);
  assert.match(client, /status:"Rascunho"/);
  assert.match(client, /Escolha a base em três passos/);
  assert.match(client, /savePlanningOnly/);
  assert.match(client, /Salvar planilha, fase e semana/);
  assert.match(client, /A montagem dos treinos fica no Calendário/);
  assert.match(css, /\.athlete-profile \.training-tab\{display:none\}/);
  assert.match(client, /useState\("Hoje"\)/);
});

test("guides the coach through a simpler three-step weekly workflow", async () => {
  const client = await readFile("app/ZonasAppClient.tsx", "utf8");
  const css = await readCss("app/globals.css");
  assert.match(client, /Prepare a semana em 3 passos/);
  assert.match(client, /Aluno e semana/);
  assert.match(client, /Conferir treinos/);
  assert.match(client, /Só aparece depois de liberar/);
  assert.match(client, /Usar semana.*da planilha-base/);
  assert.match(client, /Abrir treino completo/);
  assert.match(client, /aria-label="Escolher data da semana"/);
  assert.match(css, /\.coach-week-guide\{/);
  assert.match(css, /\.planner-footer\{position:sticky/);
});

test("prevents incomplete workouts and gives the coach one clear finish action", async () => {
  const client = await readFile("app/ZonasAppClient.tsx", "utf8");
  const css = await readCss("app/globals.css");
  assert.match(client, /O aluno receberá o treino completo\?/);
  assert.match(client, /Aquecimento/);
  assert.match(client, /Parte principal/);
  assert.match(client, /Recuperações/);
  assert.match(client, /Desaquecimento/);
  assert.match(client, /if\(!hasMainBlock\)/);
  assert.match(client, /Adicione a parte principal antes de concluir o treino/);
  assert.match(client, /onClick=\{close\}>Cancelar/);
  assert.match(client, /Usar treino completo no dia/);
  assert.match(css, /\.workout-completeness\{/);
  assert.match(css, /\.workout-drawer>footer\{order:10;position:sticky/);
});

test("turns a written workout into structured steps before release", async () => {
  const client = await readFile("app/ZonasAppClient.tsx", "utf8");
  const css = await readCss("app/globals.css");
  assert.match(client, /TRANSFORMAR TREINO ESCRITO/);
  assert.match(client, /Transformar em etapas/);
  assert.match(client, /15 min Z1 \+ 6 x 1 min Z4 \/ 1 min Z1 \+ 10 min Z1/);
  assert.match(client, /parseWrittenWorkout/);
  assert.match(client, /etapas reconhecidas\. Confira abaixo antes de usar no dia/);
  assert.match(css, /\.written-workout-converter/);
});

test("implements the approved mobile coach dashboard instead of leaving it as a mockup", async () => {
  const client = await readFile("app/ZonasAppClient.tsx", "utf8");
  const mobileCss = await readCss("app/overrides.css");
  const css = await readCss("app/globals.css");
  assert.match(client, /VISÃO DO PROFESSOR/);
  assert.match(client, /Olá, \{coachName\.split\(" "\)\[0\]\}/);
  assert.match(client, /Treinos hoje/);
  assert.match(client, /Pendentes/);
  assert.match(client, /Concluídos/);
  assert.match(client, /Novo treino/);
  assert.match(client, /Atividade recente/);
  assert.match(client, /Transforme cada treino em evolução/);
  assert.match(mobileCss, /\.mobile-coach-home/);
  assert.match(mobileCss, /\.sidebar nav button:nth-child\(n\+5\)\{display:none\}/);
  // A barra flutuante precisa ser declarada em globals.css: overrides.css é
  // importado na primeira linha dele e perde qualquer empate de especificidade.
  // Enquanto ela morava só em overrides.css, `position:static` a anulava.
  assert.match(css, /\.sidebar\{position:fixed;z-index:50;top:auto;left:10px;right:10px;bottom:10px/);
  assert.doesNotMatch(css, /\.sidebar\{position:static/);
  assert.doesNotMatch(mobileCss, /\.sidebar\{position:fixed/);
  // O conteúdo reserva o espaço da barra.
  assert.match(css, /\.content\{padding:0 14px 92px\}/);
});

test("opens the student on today's workout with a friendlier mobile experience", async () => {
  const client = await readFile("app/ZonasAppClient.tsx", "utf8");
  const css = await readCss("app/overrides.css");
  assert.match(client, /useState\("Hoje"\)/);
  assert.match(client, /\[\["Hoje","⌂"\],\["Minha semana","▤"\]/);
  assert.match(css, /\.student-instructions>article/);
  assert.match(css, /\.quick-feedback/);
  assert.match(css, /\.student-week-grid/);
  assert.match(css, /\.student-nav\{left:10px/);
});

test("shows exactly which base-plan week will be created on which calendar dates", async () => {
  const client = await readFile("app/ZonasAppClient.tsx", "utf8");
  const css = await readCss("app/globals.css");
  assert.match(client, /targetWeekStart/);
  assert.match(client, /Semana no calendário/);
  assert.match(client, /Este será o rascunho no Calendário/);
  assert.match(client, /PLANILHA E SEMANA/);
  assert.match(client, /DATA NO CALENDÁRIO/);
  assert.match(client, /DIAS ADAPTADOS/);
  assert.match(client, /weekStart:targetWeekStart/);
  assert.match(client, /training_days/);
  assert.match(client, /Criar semana \$\{week\} como rascunho/);
  assert.match(css, /\.plan-application-summary\{/);
  assert.match(css, /\.template-week-date\{/);
});

/* -------------------------------------------------------------------------- *
 * Autenticação própria, contas separadas e integrações
 * -------------------------------------------------------------------------- */

test("no longer depends on the ChatGPT sign-in headers or routes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const entry = await readFile(new URL("../app/StudentEntry.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  for (const source of [page, worker, entry, client]) {
    assert.doesNotMatch(source, /oai-authenticated-user-email/);
    assert.doesNotMatch(source, /signin-with-chatgpt|signout-with-chatgpt/);
    assert.doesNotMatch(source, /requireChatGPTUser|chatgpt-auth/);
  }
  // O bypass de identidade em localhost saiu junto: o login vale em toda parte.
  assert.doesNotMatch(worker, /isLocalAgentPreview/);
  assert.match(worker, /identityFromRequest\(env\.DB, request\)/);
});

test("stores passwords derived with PBKDF2 and never in plain text", async () => {
  const auth = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /"PBKDF2"/);
  assert.match(auth, /hash: "SHA-256"/);
  assert.match(auth, /PASSWORD_ITERATIONS = 210_000/);
  assert.match(auth, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(auth, /function constantTimeEquals/);
  // O cookie carrega o token; o banco guarda apenas o hash dele.
  assert.match(auth, /INSERT INTO user_sessions \(token_hash/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
});

test("signs a coach in, rejects a wrong password and issues a session cookie", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("login", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  // Banco falso com uma única conta, cuja senha é derivada de verdade no primeiro uso.
  let storedAccount = null;
  const prepare = (sql) => statement((values) => {
    if (sql.includes("FROM user_accounts WHERE role = 'coach'")) return storedAccount;
    if (sql.includes("FROM user_accounts WHERE email")) return storedAccount;
    return null;
  }, (values) => {
    if (sql.includes("INSERT INTO user_accounts")) {
      const [id, email, name, role, athleteName, hash, salt, iterations, status, mustChange] = values;
      storedAccount = {
        id, email, name, role, athlete_name: athleteName, password_hash: hash, password_salt: salt,
        password_iterations: iterations, status, must_change_password: mustChange, failed_attempts: 0, locked_until: null,
      };
    }
  });
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    COACH_EMAIL: "treinador@exemplo.com",
    COACH_INITIAL_PASSWORD: "primeiro-acesso-2026",
    DB: { prepare, async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const login = (password) => worker.fetch(new Request("https://zonasapp.example/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "treinador@exemplo.com", password }),
  }), env, ctx);

  const wrong = await login("senha-errada-9999");
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "invalid_credentials");
  assert.equal(wrong.headers.get("set-cookie"), null);

  const right = await login("primeiro-acesso-2026");
  assert.equal(right.status, 200);
  const body = await right.json();
  assert.equal(body.role, "coach");
  assert.equal(body.mustChangePassword, true);
  const cookie = right.headers.get("set-cookie");
  assert.match(cookie, /^zonas_session=[a-f0-9]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  // A senha não volta de forma alguma para o navegador.
  assert.doesNotMatch(JSON.stringify(body), /primeiro-acesso-2026|password_hash/);
});

test("gives every athlete a separate login bound to their own athlete record", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("accounts", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => statement(() => null, (values) => writes.push({ sql, values }));
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const created = await worker.fetch(new Request("https://zonasapp.example/api/accounts", {
    method: "POST", headers: { "content-type": "application/json", ...coachCookie },
    body: JSON.stringify({ action: "create", athleteName: "Marina Alves", name: "Marina Alves", email: "Marina@Example.com" }),
  }), env, ctx);
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.athleteName, "Marina Alves");
  assert.match(body.temporaryPassword, /^[a-z]+-\d{4}$/);

  const accountWrite = writes.find(({ sql }) => sql.includes("INSERT INTO user_accounts"));
  assert.ok(accountWrite);
  assert.ok(accountWrite.values.includes("marina@example.com"), "o e-mail é normalizado antes de virar chave de login");
  assert.ok(accountWrite.values.includes("student"));
  assert.ok(accountWrite.values.includes("Marina Alves"));
  // A senha temporária vai para o banco derivada, nunca como texto.
  assert.ok(!accountWrite.values.includes(body.temporaryPassword));
  // O vínculo de acesso do aluno é criado junto, para o painel refletir de imediato.
  assert.ok(writes.some(({ sql }) => sql.includes("INSERT INTO athlete_access")));
});

test("blocks a student account and drops its active sessions", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("block-account", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => statement(() => (sql.includes("FROM user_accounts WHERE email")
    ? { id: "student-account", email: "everton.teste@example.com", role: "student", athlete_name: "Everton Barbosa", status: "Ativo" }
    : null), (values) => writes.push({ sql, values }));
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const response = await worker.fetch(new Request("https://zonasapp.example/api/accounts", {
    method: "POST", headers: { "content-type": "application/json", ...coachCookie },
    body: JSON.stringify({ action: "block", email: "everton.teste@example.com" }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "Bloqueado");
  assert.ok(writes.some(({ sql, values }) => sql.startsWith("UPDATE user_accounts SET status") && values.includes("Bloqueado")));
  assert.ok(writes.some(({ sql }) => sql.includes("DELETE FROM user_sessions WHERE user_id")));
});

test("describes the four providers honestly, including Apple's device-only path", async () => {
  const { PROVIDERS, SUPPORTED_PROVIDER_LABELS } = await import(new URL("../worker/integrations.ts", import.meta.url).href.replace(".ts", ".ts"))
    .catch(async () => {
      // O módulo é TypeScript; quando não puder ser importado, valida-se o texto.
      const source = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
      return { PROVIDERS: null, SUPPORTED_PROVIDER_LABELS: null, source };
    });
  const source = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  void PROVIDERS; void SUPPORTED_PROVIDER_LABELS;
  // Cada provedor declara o seu tipo real de autorização.
  assert.match(source, /id: "strava"[\s\S]*?authType: "oauth2"/);
  assert.match(source, /id: "garmin"[\s\S]*?authType: "oauth2-pkce"/);
  assert.match(source, /id: "zepp"[\s\S]*?authType: "oauth2"/);
  assert.match(source, /id: "apple"[\s\S]*?authType: "device"/);
  // A Apple não tem endpoint de autorização em servidor, e o código diz isso.
  assert.match(source, /Sem API de servidor/);
  assert.match(source, /HealthKit só existe dentro do iPhone/);
  // Só a Garmin recebe treinos estruturados.
  assert.match(source, /id: "garmin"[\s\S]*?canSendWorkouts: true/);
});

test("uses PKCE for Garmin and keeps the verifier on the server", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /code_challenge_method/);
  assert.match(worker, /"S256"/);
  assert.match(worker, /function createCodeVerifier/);
  assert.match(worker, /code_verifier/);
  // O verifier é gravado no fluxo e só sai de lá na troca do código.
  assert.match(worker, /INSERT INTO oauth_flows \(state_hash, athlete_name, actor_email, provider, code_verifier/);
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client, /code_verifier|code_challenge|GARMIN_CONSUMER_SECRET/);
});

test("normalizes activities from every provider into the same shape", async () => {
  const source = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  assert.match(source, /provider === "strava"[\s\S]*?raw\.start_date/);
  assert.match(source, /provider === "garmin"[\s\S]*?startTimeInSeconds/);
  assert.match(source, /provider === "zepp"[\s\S]*?raw\.trackid/);
  assert.match(source, /raw\.workoutActivityType/);
  // A atividade importada já chega ligada à semana e ao dia do treino planejado.
  assert.match(source, /export function weekStartOf/);
  assert.match(source, /export function workoutDayOf/);
  assert.match(source, /export function averagePaceSeconds/);
});

test("accepts Apple Health workouts only with a valid ingest token", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("apple-ingest", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const knownHash = createHash("sha256").update("a".repeat(48)).digest("hex");
  const prepare = (sql) => statement((values) => (
    sql.includes("FROM device_ingest_tokens") && values[0] === knownHash
      ? { athlete_name: "Everton Barbosa" }
      : null
  ), (values) => writes.push({ sql, values }));
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare, async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const send = (token) => worker.fetch(new Request("https://zonasapp.example/api/ingest/device", {
    method: "POST",
    headers: { "content-type": "application/json", "x-zonas-ingest-token": token },
    body: JSON.stringify({ workouts: [{ uuid: "AAA", startDate: "2026-08-25T10:00:00Z", totalDistanceMeters: 10000, durationSeconds: 3000 }] }),
  }), env, ctx);

  assert.equal((await send("b".repeat(48))).status, 401);
  const accepted = await send("a".repeat(48));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).imported, 1);

  const insert = writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO external_activities"));
  assert.ok(insert, "a atividade é gravada de forma idempotente");
  assert.ok(insert.values.includes("Everton Barbosa"), "sempre no atleta dono do token, nunca no informado pelo corpo");
  assert.ok(insert.values.includes(300), "10 km em 50 min viram 300 s/km");
});

test("keeps a provider unavailable until its credentials exist", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("provider-readiness", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const prepare = (sql) => statement(() => (sql.includes("FROM athlete_access") ? { athlete_name: "Everton Barbosa", status: "Ativo" } : null));
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const listed = await worker.fetch(new Request("https://zonasapp.example/api/student/integrations", { headers: { ...studentCookie } }), env, ctx);
  assert.equal(listed.status, 200);
  const { providers } = await listed.json();
  assert.equal(providers.length, 4);
  assert.ok(providers.every((provider) => provider.available === false));
  assert.ok(providers.every((provider) => provider.status === "Credenciais não configuradas"));

  const attempt = await worker.fetch(new Request("https://zonasapp.example/api/student/integrations", {
    method: "POST", headers: { "content-type": "application/json", ...studentCookie },
    body: JSON.stringify({ provider: "garmin", action: "connect" }),
  }), env, ctx);
  assert.equal(attempt.status, 503);
  const failure = await attempt.json();
  assert.equal(failure.error, "provider_setup_required");
  // O erro diz o que falta, sem revelar valor de credencial nenhum.
  assert.deepEqual(failure.missing, ["GARMIN_CONSUMER_KEY", "GARMIN_CONSUMER_SECRET", "STRAVA_TOKEN_ENCRYPTION_KEY"]);
});

test("gives the coach a way back in, since no one can reset that password in the app", async () => {
  const script = await readFile(new URL("../scripts/reset-coach-password.mjs", import.meta.url), "utf8");
  const auth = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["coach:reset-password"], "node scripts/reset-coach-password.mjs");
  // A derivação precisa ser idêntica à do Worker, senão o hash gerado não entra.
  assert.match(script, /PASSWORD_ITERATIONS = 210_000/);
  assert.match(auth, /PASSWORD_ITERATIONS = 210_000/);
  assert.match(script, /iterations: PASSWORD_ITERATIONS, hash: "SHA-256"/);
  assert.match(script, /new Uint8Array\(16\)/);
  // Redefinir encerra as sessões abertas, como a troca de senha dentro do app.
  assert.match(script, /DELETE FROM user_sessions WHERE user_id/);
  assert.match(script, /role = 'coach'/);
});

test("seeds the coach account only while none exists", async () => {
  const auth = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
  // O seed é ignorado assim que existe uma conta de treinador, então trocar
  // COACH_INITIAL_PASSWORD depois disso não reabre o acesso.
  assert.match(auth, /SELECT id FROM user_accounts WHERE role = 'coach' LIMIT 1/);
  assert.match(auth, /if \(existing\) return "ready";/);
  assert.match(auth, /mustChangePassword: true/);
});

test("lets the coach email be configured instead of hardcoding one address", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // Quem instala a plataforma precisa entrar com o próprio endereço.
  assert.match(worker, /COACH_EMAIL\?: string;/);
  assert.match(worker, /const coachEmailOf = \(env: Env\) =>/);
  assert.match(worker, /env\.COACH_EMAIL\?\.trim\(\)\.toLowerCase\(\)/);
  assert.match(worker, /ensureCoachAccount\(env\.DB, coachEmailOf\(env\), env\.COACH_INITIAL_PASSWORD\)/);
  // Nenhum endereço de e-mail pode estar fixo no código: um e-mail conhecido
  // somado a uma senha inicial conhecida seria porta aberta em toda instalação
  // onde as variáveis fossem esquecidas.
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
  // Placeholders genéricos de formulário ("aluno@email.com") são aceitáveis; o
  // que não pode existir é o endereço real de uma pessoa em provedor conhecido.
  for (const [nome, fonte] of [["worker", worker], ["cliente", client], ["auth", auth]]) {
    assert.doesNotMatch(fonte, /[\w.+-]+@(gmail|hotmail|outlook|yahoo|icloud|proton)\./i, `${nome} não pode conter e-mail pessoal fixo`);
  }
  // E nenhuma senha inicial embutida: sem a variável, não se cria conta alguma.
  assert.doesNotMatch(auth, /initialPassword\s*(\?\?|\|\|)\s*"/, "não pode haver senha padrão embutida");
  assert.match(auth, /if \(!initialPassword \|\| passwordProblem\(initialPassword\)\) return "not_configured";/);
  assert.match(auth, /if \(!coachEmail \|\| !isValidEmail\(coachEmail\)\) return "not_configured";/);
  assert.match(worker, /coach_account_not_configured/);
});

test("explains why the sign-in form refuses instead of freezing the button", async () => {
  const gate = await readFile(new URL("../app/AuthGate.tsx", import.meta.url), "utf8");
  // Um botão desabilitado sem motivo visível é indistinguível de um botão quebrado.
  assert.doesNotMatch(gate, /disabled=\{!canSubmit/);
  assert.match(gate, /const validationProblem = \(\)/);
  assert.match(gate, /Confira o endereço de e-mail\./);
  assert.match(gate, /A senha precisa de pelo menos \$\{MIN_PASSWORD\} caracteres\./);
  assert.match(gate, /Digite a senha temporária que você recebeu\./);
  // Os dois formulários só bloqueiam o botão enquanto a requisição está em voo.
  const disabled = gate.match(/disabled=\{[^}]*\}/g) ?? [];
  assert.ok(disabled.length >= 2);
  assert.ok(disabled.every((value) => value.includes('state === "sending"')));
});

/* -------------------------------------------------------------------------- *
 * Correções de confiabilidade — reenvio, diagnóstico e dados de demonstração
 * -------------------------------------------------------------------------- */

test("treats a duplicate submission as saved instead of reporting failure", async () => {
  const client = await readFile(new URL("../app/api-client.ts", import.meta.url), "utf8");
  // O 409 da deduplicação significa "já foi aceita": tratá-lo como erro fazia a
  // interface dizer que o salvamento falhou com os dados já gravados.
  assert.match(client, /response\.status === 409 && code === "duplicate_submission"/);
  assert.match(client, /alreadySaved: true/);
  // O erro precisa carregar o suficiente para diagnosticar sem reproduzir.
  assert.match(client, /class ApiError extends Error/);
  assert.match(client, /this\.status = init\.status/);
  assert.match(client, /this\.code = init\.code/);
  assert.match(client, /this\.path = init\.path/);
  assert.match(client, /console\.error\("\[zonasapp\] erro de API"/);
});

test("skips deduplication on routes whose write is an upsert", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /const idempotentWriteRoutes = new Set\(\[/);
  for (const route of ["/api/athlete-profile", "/api/athlete-planning", "/api/training-weeks"]) {
    assert.ok(worker.includes(`"${route}",`), `${route} deve estar isenta da deduplicação`);
  }
  assert.match(worker, /if \(idempotentWriteRoutes\.has\(url\.pathname\)\) return null;/);
  // A proteção continua existindo para o que cria registro novo a cada envio.
  assert.match(worker, /INSERT OR IGNORE INTO request_deduplication/);
});

test("saves the same athlete profile twice without reporting an error", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("profile-twice", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const writes = [];
  const prepare = (sql) => statement(() => null, (values) => writes.push({ sql, values }));
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const send = () => worker.fetch(new Request("https://zonasapp.example/api/athlete-profile", {
    method: "POST", headers: { "content-type": "application/json", ...coachCookie },
    body: JSON.stringify({ athleteName: "Everton Barbosa", phone: "", birthDate: "", objective: "10 km", integration: "Garmin", trainingDays: ["SEG"] }),
  }), env, ctx);

  assert.equal((await send()).status, 200);
  // Era aqui que o treinador recebia 409 e a mensagem "não foi possível salvar".
  assert.equal((await send()).status, 200);
  assert.equal(writes.filter(({ sql }) => sql.includes("INSERT INTO athlete_profiles")).length, 2);
});

test("still blocks a repeated submission on routes that create new records", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dedup-kept", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const reservations = new Map();
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() {
      if (sql.includes("SELECT request_token FROM request_deduplication")) {
        return reservations.has(this.values[0]) ? { request_token: reservations.get(this.values[0]) } : null;
      }
      return null;
    },
    async all() { return { results: [] }; },
    async run() {
      if (sql.includes("INSERT OR IGNORE INTO request_deduplication") && !reservations.has(this.values[0])) {
        reservations.set(this.values[0], this.values[1]);
      }
      return { success: true, meta: { changes: 1 } };
    },
  });
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(items) { for (const item of items) await item.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const send = () => worker.fetch(new Request("https://zonasapp.example/api/performance-tests", {
    method: "POST", headers: { "content-type": "application/json", ...coachCookie },
    body: JSON.stringify({ athleteName: "Everton Barbosa", testDate: "2026-08-27", distanceKm: 3, minutes: 12, seconds: 0, age: 30 }),
  }), env, ctx);

  assert.equal((await send()).status, 201);
  const repeated = await send();
  assert.equal(repeated.status, 409, "um segundo clique não pode criar um segundo teste");
  assert.equal((await repeated.json()).error, "duplicate_submission");
});

test("ships without demonstration athletes so a new coach starts empty", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(client, /const athletes: Athlete\[\] = \[\];/);
  // A lista vinha de uma constante fixa e o banco vazio a mantinha na tela,
  // permitindo salvar fichas e testes para alunos que não existiam.
  for (const invented of ["Everton Barbosa", "Marina Costa", "João Ribeiro", "Ana Martins", "Rafael Lima"]) {
    assert.ok(!client.includes(`name: "${invented}"`), `${invented} não pode voltar como dado fixo`);
  }
  assert.match(client, /setAthleteRecords\(saved\);/);
  assert.doesNotMatch(client, /if \(saved\.length\) setAthleteRecords/);
});

test("tells the user whether copying actually worked", async () => {
  const helpers = await readFile(new URL("../app/api-client.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Antes o botão chamava a Clipboard API sem await e sem retorno: quando
  // falhava, ou mesmo quando funcionava, nada acontecia na tela.
  assert.match(helpers, /export async function copyText/);
  assert.match(helpers, /document\.execCommand\("copy"\)/);
  assert.doesNotMatch(client, /navigator\.clipboard/);
  assert.match(client, /Senha copiada ✓/);
  assert.match(client, /Não foi possível copiar automaticamente/);
});

test("keeps the install prompt below open dialogs", async () => {
  const css = await readCss("../app/globals.css");
  // O cartão de instalação usava z-index 120 e cobria o botão de salvar dos
  // modais, que ficam em z-index 20.
  const install = css.match(/\.install-app-card\{[^}]*\}/);
  assert.ok(install, "a regra do cartão de instalação precisa existir");
  const zIndex = Number(install[0].match(/z-index:(\d+)/)?.[1]);
  const overlay = Number(css.match(/\.overlay\{[^}]*z-index:(\d+)/)?.[1]);
  assert.ok(Number.isFinite(zIndex) && Number.isFinite(overlay));
  assert.ok(zIndex < overlay, `instalação (${zIndex}) precisa ficar abaixo dos modais (${overlay})`);
});

test("gives the invite buttons one shared shape", async () => {
  const css = await readCss("../app/globals.css");
  // O botão do WhatsApp não tinha .gold nem .outline, então não herdava raio
  // nem espaçamento e destoava em altura dos vizinhos.
  assert.match(css, /\.invite-link-actions button\{[^}]*border-radius:9px/);
  assert.match(css, /\.invite-link-actions button\{[^}]*padding:11px 16px/);
  assert.match(css, /\.account-issued-actions\{display:flex/);
  // Um provedor indisponível não pode ter o mesmo peso visual de uma ação real.
  assert.match(css, /\.integration-center article button:disabled\{[^}]*cursor:not-allowed/);
});

test("greets the coach by the name on the account, not a name baked into the code", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const entry = await readFile(new URL("../app/StudentEntry.tsx", import.meta.url), "utf8");
  // O sistema chamava todo treinador de "Jonas" e rotulava o registro de
  // auditoria comparando o e-mail com esse nome, o que errava para qualquer
  // outra instalação.
  for (const [nome, fonte] of [["cliente", client], ["cadastro do aluno", entry]]) {
    assert.ok(!fonte.includes("Jonas"), `${nome} não pode ter nome de pessoa fixo`);
  }
  assert.match(client, /const initialsOf =/);
  assert.match(client, /function greeting\(\)/);
  assert.match(client, /\$\{session\.name\.split\(" "\)\[0\]\}/);
  assert.match(client, /coachInitials = initialsOf\(session\.name\)/);
  // A auditoria mostra o e-mail real de quem agiu.
  assert.doesNotMatch(client, /actor_email\.toLowerCase\(\)\.includes/);
});

/* -------------------------------------------------------------------------- *
 * Etapa 2 — conclusão do treino e vazamento do calendário
 * -------------------------------------------------------------------------- */

test("scopes the training weeks query to the requested athlete", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("weeks-scope", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const consultas = [];
  const prepare = (sql) => ({
    values: [],
    bind(...values) { this.values = values; consultas.push({ sql, values }); return this; },
    async first() { return null; },
    async all() { consultas.push({ sql, values: this.values }); return { results: [] }; },
    async run() { return { success: true }; },
  });
  const env = {
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(i) { for (const x of i) await x.run(); return []; } },
  };
  const r = await worker.fetch(
    new Request("https://zonasapp.example/api/training-weeks?athlete=Ana%20Souza", { headers: { ...coachCookie } }),
    env, { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(r.status, 200);
  // Só o atleta, sem semana, caía num SELECT sem WHERE e devolvia as semanas de
  // todos — quem lesse o primeiro resultado acabaria no treino de outra pessoa.
  const leitura = consultas.find(({ sql }) => sql.includes("SELECT * FROM training_weeks") && !sql.includes("LIMIT 1"));
  assert.ok(leitura, "deve haver uma leitura da tabela de semanas");
  assert.match(leitura.sql, /WHERE athlete_name = \?/);
  assert.deepEqual(leitura.values, ["Ana Souza"]);
});

test("lets the student finish a workout without typing any number", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Antes o registro exigia tempo ou distância: quem só correu não conseguia
  // avisar o treinador de que tinha feito o treino.
  assert.doesNotMatch(worker, /actual_result_required/);
  assert.match(worker, /Concluído sem medição/);
  assert.match(worker, /const temMedida =/);
  // E quem não treinou também precisa conseguir registrar.
  assert.match(worker, /if \(acao === "skip"\)/);
  assert.match(worker, /'Não realizado'/);
  assert.match(client, /registrar\("complete"\)/);
  assert.match(client, /registrar\("skip"\)/);
  assert.match(client, /Não consegui treinar/);
});

test("fills the completed workout with the imported activity when there is one", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // A atividade importada casa por semana e dia, e traz o que o formulário
  // manual não captura: ritmo médio e frequência cardíaca.
  assert.match(worker, /FROM external_activities\s+WHERE athlete_name = \? AND matched_week_start = \? AND matched_workout_day = \?/);
  assert.match(worker, /averageHeartRate: heartRate/);
  assert.match(worker, /averagePaceSeconds: paceSeconds/);
  assert.match(worker, /fromIntegration: Boolean\(importada\)/);
  assert.match(client, /RITMO MÉDIO/);
  assert.match(client, /FC MÉDIA/);
  assert.match(client, /Dados trazidos automaticamente de/);
});

test("adds new execution columns without rewriting existing rows", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // `CREATE TABLE IF NOT EXISTS` não altera tabela existente, então um banco em
  // uso ficaria sem as colunas novas. O reparo só acrescenta.
  assert.match(worker, /async function ensureColumns/);
  assert.match(worker, /PRAGMA table_info/);
  assert.match(worker, /ALTER TABLE \$\{table\} ADD COLUMN/);
  assert.doesNotMatch(worker, /DROP COLUMN|DROP TABLE workout_executions/);
  // O reparo de colunas agora é derivado do schema, para toda tabela garantida.
  assert.match(worker, /await ensureColumns\(env, nomeDaTabela\(tabela\), tableColumns\(tabela\)\)/);
  assert.match(worker, /ensureTables\(env, schema\.workoutExecutions\)/);
});

test("lets the student read back their own feedback history", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // A rota só aceitava POST: o aluno escrevia e nunca mais via o que contou.
  assert.match(worker, /FROM training_feedbacks WHERE athlete_name = \? ORDER BY created_at DESC/);
  assert.match(worker, /if \(request\.method === "GET"\) \{\s*const result = await env\.DB\.prepare\(\s*"SELECT id, week_start, workout_day, feeling/);
});

test("gives every pain report a trackable history", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // O treinador via a contagem de relatos e não podia fazer nada com eles.
  for (const acao of ["review", "contact", "link_week", "resolve", "reopen"]) {
    assert.ok(worker.includes(`acao === "${acao}"`), `falta a ação ${acao}`);
  }
  assert.match(worker, /ensureTables\(env, schema\.painReports, schema\.painReportUpdates\)/);
  assert.match(worker, /async function registraMovimentoDor/);
  // O vínculo com a planilha só aceita uma semana que exista para aquele atleta.
  assert.match(worker, /week_not_found_for_athlete/);

  assert.match(client, /function PainCaseScreen/);
  assert.match(client, /HISTÓRICO DO CASO/);
  assert.match(client, /Vincular a um ajuste na planilha/);
});

test("keeps one single source of truth for the database schema", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const integrations = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  // O esquema vinha declarado duas vezes: tabelas Drizzle em db/schema.ts e
  // constantes CREATE TABLE escritas à mão aqui. As duas divergiram de fato —
  // pain_reports e workout_executions ganharam colunas só de um lado.
  // Ignora as menções em comentários; o que não pode existir é SQL literal.
  const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(semComentarios(worker), /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(semComentarios(integrations), /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(worker, /const create[A-Z]\w*Sql/);
  assert.match(worker, /import \* as schema from "\.\.\/db\/schema"/);
  assert.match(worker, /import \{ tableColumns, tableSql \} from "\.\.\/db\/sql"/);
  // Conferir o esquema é trabalho de uma vez por instância, não de toda chamada.
  assert.match(worker, /const tabelasConferidas = new Set<string>\(\)/);
  assert.match(worker, /if \(!pendentes\.length\) return;/);
});

test("generates the same columns the schema declares", async () => {
  // Garante que o SQL gerado cobre cada coluna declarada, sem sobra nem falta.
  const { execSync } = await import("node:child_process");
  const saida = execSync(
    `npx tsx -e "import * as s from './db/schema.ts';import {createTableSql,tableColumns} from './db/sql.ts';` +
    `let n=0;for(const t of Object.values(s)){try{const sql=createTableSql(t);const cols=Object.keys(tableColumns(t));` +
    `for(const c of cols){if(!sql.includes(c+' '))throw new Error('coluna ausente: '+c)}n++}catch(e){if(String(e).includes('coluna ausente'))throw e}}` +
    `console.log(n)"`,
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 120000 },
  );
  const tabelas = Number(saida.trim().split("\n").pop());
  assert.ok(tabelas >= 25, `esperava ao menos 25 tabelas geradas, veio ${tabelas}`);
});

/* -------------------------------------------------------------------------- *
 * Inativação de aluno, histórico recente e integridade do nome
 * -------------------------------------------------------------------------- */

test("inactivates an athlete instead of deleting, keeping the history", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Não existe exclusão de aluno: apagar destruiria treinos, testes e queixas.
  assert.doesNotMatch(worker, /DELETE FROM athletes/);
  assert.match(schema, /archivedAt: integer\("archived_at"\)/);
  assert.match(worker, /acao === "archive" \|\| acao === "restore"/);
  // Inativar tira o acesso na hora; reativar não devolve sozinho.
  assert.match(worker, /UPDATE user_accounts SET status = 'Bloqueado'/);
  assert.match(worker, /DELETE FROM user_sessions WHERE user_id = \?/);
  // A lista traz só ativos por padrão, com filtro para ver os inativos.
  // A condição virou composta ao ganhar o recorte por treinador.
  assert.match(worker, /athletes\.archived_at IS NULL/);
  assert.match(worker, /condicoes\.length \? `WHERE \$\{condicoes\.join\(" AND "\)\}` : ""/);
  assert.match(worker, /incluir === "archived"/);
  assert.match(client, /className=\{situation===item\?"selected":""\}/);
  assert.match(client, /Alunos inativos mantêm todo o histórico/);
});

test("refuses a second athlete with the same name", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  // `athlete_name` liga ficha, treinos, testes, provas e cobranças: dois
  // homônimos compartilhariam em silêncio todo o histórico um do outro.
  assert.match(worker, /athlete_name_taken/);
  assert.match(worker, /SELECT name FROM athletes WHERE name = \? LIMIT 1/);
  assert.match(schema, /uniqueIndex\("athletes_name_idx"\)\.on\(table\.name\)/);
});

test("shows the student the last seven days without turning it into a wall", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  assert.match(worker, /Number\(url\.searchParams\.get\("days"\)\) \|\| 7/);
  assert.match(worker, /created_at >= \?/);
  assert.match(client, /function RecentWorkouts/);
  assert.match(client, /ÚLTIMOS 7 DIAS/);
  // O registro mostra o que veio do relógio, não só a porcentagem.
  assert.match(client, /average_pace_seconds/);
  assert.match(client, /average_heart_rate/);
});

/* -------------------------------------------------------------------------- *
 * Conta de manutenção e painel de diagnóstico
 * -------------------------------------------------------------------------- */

test("creates the maintenance account only from the environment", async () => {
  const auth = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // Uma conta de acesso irrestrito não pode existir por padrão nem ter
  // credencial escrita no código — vale o mesmo cuidado da conta do treinador.
  assert.match(auth, /export async function ensureDevAccount/);
  assert.match(auth, /if \(!devLogin \|\| !isValidDevLogin\(devLogin\)\) return "not_configured";/);
  assert.match(auth, /if \(!devPassword \|\| devPassword\.length < MIN_PASSWORD_LENGTH\) return "not_configured";/);
  assert.match(worker, /ensureDevAccount\(env\.DB, env\.DEV_LOGIN, env\.DEV_INITIAL_PASSWORD\)/);
  // A senha de manutenção nunca aparece no código.
  for (const fonte of [auth, worker]) {
    assert.doesNotMatch(fonte, /Yan\.\d+/, "senha de manutenção não pode estar no código");
  }
});

test("keeps the diagnostics panel out of reach for coach and student", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dev-scope", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const prepare = (sql) => statement(() => (sql.includes("FROM athlete_access") ? { athlete_name: "Ana Souza", status: "Ativo" } : null));
  const env = {
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(i) { for (const x of i) await x.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const chamar = (cookie) => worker.fetch(
    new Request("https://zonasapp.example/api/dev/overview", { headers: { ...cookie } }), env, ctx);

  const doTreinador = await chamar(coachCookie);
  assert.equal(doTreinador.status, 403);
  assert.equal((await doTreinador.json()).error, "dev_access_required");
  assert.equal((await chamar(studentCookie)).status, 403);
  assert.equal((await worker.fetch(new Request("https://zonasapp.example/api/dev/overview"), env, ctx)).status, 401);
});

test("never exposes password hashes or session tokens in the diagnostics", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const inicio = worker.indexOf("async function devOverviewApi");
  const fim = worker.indexOf("async function racesRecordsApi", inicio);
  const corpo = worker.slice(inicio, fim);
  assert.ok(inicio > 0 && fim > inicio, "devOverviewApi precisa existir");
  // Nem a conta de manutenção precisa de hash ou token para diagnosticar, e
  // devolvê-los transformaria esta rota num alvo.
  assert.doesNotMatch(corpo, /password_hash|password_salt|token_hash/);
  // Do ambiente só sai a presença da variável, nunca o valor.
  assert.match(corpo, /coachEmailConfigurado: Boolean\(env\.COACH_EMAIL\)/);
  assert.doesNotMatch(corpo, /valor: env\.|env\.DEV_INITIAL_PASSWORD/);
});

test("gives the maintenance account both views", async () => {
  const root = await readFile(new URL("../app/AppRoot.tsx", import.meta.url), "utf8");
  const dash = await readFile(new URL("../app/DevDashboard.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // Abre no diagnóstico e alcança o painel do treinador pelo mesmo lugar.
  assert.match(root, /session\.role === "dev"/);
  assert.match(root, /modoTreinador/);
  assert.match(worker, /function isCoachLevel/);
  assert.match(worker, /identity\?\.role === "coach" \|\| identity\?\.role === "dev"/);
  for (const aba of ["Resumo", "Erros", "Contas", "Segurança", "Banco"]) {
    assert.ok(dash.includes(aba), `falta a aba ${aba}`);
  }
});

/* -------------------------------------------------------------------------- *
 * Carteiras por treinador e visita da conta de manutenção
 * -------------------------------------------------------------------------- */

test("separates each coach's athletes into their own book", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // Nenhuma tabela guardava o vínculo com o treinador: o sistema nasceu para
  // um só. Como todas se ligam ao aluno por athlete_name, marcar o dono em
  // `athletes` basta para separar o que cada treinador enxerga.
  assert.match(schema, /coachEmail: text\("coach_email"\)/);
  assert.match(worker, /function carteiraDe\(request: Request\)/);
  // O recorte é estrito: incluir os alunos sem dono faria os mesmos aparecerem
  // em todas as carteiras.
  assert.match(worker, /clausula: `\$\{coluna\} = \?`/);
  assert.doesNotMatch(worker, /OR \$\{coluna\} IS NULL/);
  // Os alunos anteriores à separação ganham o treinador principal, uma vez só.
  assert.match(worker, /UPDATE athletes SET coach_email = \? WHERE coach_email IS NULL/);
  assert.match(worker, /if \(alunosAtribuidos\) return;/);
  // Aluno novo nasce na carteira de quem o cadastrou.
  assert.match(worker, /createdAt, carteiraDe\(request\)\)/);
});

test("keeps the visit on the session, not in the browser", async () => {
  const auth = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // Quem decide o recorte é o servidor; a interface não escolhe o que vê.
  assert.match(schema, /impersonatingUserId: text\("impersonating_user_id"\)/);
  assert.match(auth, /export async function setImpersonation/);
  assert.match(auth, /AND role = 'coach' LIMIT 1/);
  // Visitar a área de outra pessoa deixa rastro.
  assert.match(worker, /Manutenção visitou um treinador/);
  // Só a manutenção alcança a rota.
  assert.match(worker, /url\.pathname === "\/api\/dev\/coaches"[\s\S]{0,120}requireDevApiAccess/);
});

test("says out loud whose area is open", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const dash = await readFile(new URL("../app/DevDashboard.tsx", import.meta.url), "utf8");
  // Operar na área de outra pessoa sem aviso é como se perde a noção de onde
  // se está — e de quem vai receber a alteração.
  assert.match(client, /dev-visiting-banner/);
  assert.match(client, /Você está na área de/);
  assert.match(dash, /Entrar nesta área/);
  assert.match(dash, /\+ Novo treinador/);
});

test("only the maintenance account can list or visit coaches", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dev-coaches", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const prepare = (sql) => statement(() => (sql.includes("FROM athlete_access") ? { athlete_name: "Ana Souza", status: "Ativo" } : null));
  const env = {
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
    DB: { prepare: withSession(prepare), async batch(i) { for (const x of i) await x.run(); return []; } },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const chamar = (cookie) => worker.fetch(
    new Request("https://zonasapp.example/api/dev/coaches", { headers: { ...cookie } }), env, ctx);
  assert.equal((await chamar(coachCookie)).status, 403);
  assert.equal((await chamar(studentCookie)).status, 403);
  assert.equal((await worker.fetch(new Request("https://zonasapp.example/api/dev/coaches"), env, ctx)).status, 401);
});

test("keeps the visiting banner out of the coach grid", async () => {
  const css = await readCss("../app/globals.css");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // `.shell` é um grid de duas colunas. Como filho comum, a faixa ocupava a
  // segunda célula — o lugar do conteúdo — e empurrava `.content` para a linha
  // de baixo, com a largura da barra lateral e fora da tela: só a faixa
  // aparecia.
  assert.match(css, /\.dev-visiting-banner\{position:fixed/);
  assert.match(css, /--faixa-visita:\d+px/);
  // O espaço é reservado por padding, não por uma célula do grid.
  assert.match(css, /\.shell\.com-visita\{padding-top:var\(--faixa-visita\)\}/);
  assert.match(css, /\.shell\.com-visita \.sidebar\{top:var\(--faixa-visita\)/);
  assert.match(client, /className=\{`shell\$\{visitando \? " com-visita" : ""\}`\}/);
});







test("keeps an injury attached to the athlete, not in a section of its own", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Uma queixa pertence a um atleta e só faz sentido ao lado da ficha dele.
  assert.doesNotMatch(client, /"Testes e zonas", "Lesões"/);
  assert.doesNotMatch(client, /active === "Lesões"/);
  assert.match(client, /function AthletePainList/);
  assert.match(client, /LESÃO EM ACOMPANHAMENTO/);
  assert.match(client, /onOpenPain && <AthletePainList athleteName=\{athlete\.name\}/);
});

test("opens the injury screen straight from the notification", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // O aviso levava para a lista de alunos e obrigava a procurar o caso.
  assert.match(client, /action:"Acompanhar lesão"/);
  assert.match(client, /pain:\{id:item\.id,athleteName:item\.athlete_name\}/);
  assert.match(client, /alert\.pain\?openPain\(alert\.pain\):go\(alert\.section\)/);
  assert.match(client, /<PainCaseScreen reportId=\{painCase\.id\}/);
});

test("moves a finished injury into the athlete's history", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Encerrada deixa de ser pendência: sai do destaque e vira histórico.
  assert.match(client, /const abertas = relatos\.filter\(r => r\.status !== "Resolvido"\)/);
  assert.match(client, /const encerradas = relatos\.filter\(r => r\.status === "Resolvido"\)/);
  assert.match(client, /Lesões encerradas \(\{encerradas\.length\}\)/);
  assert.match(client, /className="athlete-pain-past"/);
  // A ficha do aluno pede só as lesões daquele aluno.
  assert.match(client, /\/api\/pain-reports\?athlete=\$\{encodeURIComponent\(athleteName\)\}/);
});

test("still records what happened together with the case status", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /if \(acao === "update"\)/);
  assert.match(worker, /novoStatus === "Resolvido" \? "resolution = \?" : "coach_note = \?"/);
  assert.match(client, /O que aconteceu\?/);
  assert.match(client, /Situação do caso/);
  assert.match(client, /Escreva o que aconteceu ou mude a situação do caso\./);
  // A ficha do aluno se atualiza quando o caso muda.
  assert.match(client, /zonasapp:pain-refresh/);
});

/* -------------------------------------------------------------------------- *
 * Avisos, cartões do painel e decisão de prova
 * -------------------------------------------------------------------------- */

test("drops resolved injuries out of the notice board", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Um caso encerrado não é pendência. Filtrar na origem impede que ele volte
  // a aparecer em qualquer lugar que use esta lista.
  assert.match(client, /\.filter\(\(item:any\)=>item\.status!=="Resolvido"\)/);
  assert.match(client, /const refreshPainReports=/);
  // E a lista se atualiza quando um caso é encerrado em outra tela.
  assert.match(client, /addEventListener\("zonasapp:pain-refresh",atualiza\)/);
});

test("makes every number on the panel lead somewhere", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const css = await readCss("../app/globals.css");
  // Um número que indica pendência e não leva a lugar nenhum obriga a
  // procurar no menu o que já estava na tela.
  const cartoes = client.match(/<button className="stat-card"/g) ?? [];
  assert.equal(cartoes.length, 4, "os quatro números do painel precisam ser clicáveis");
  assert.match(client, /className="stat-card" onClick=\{\(\)=>go\("Alunos"\)\}/);
  assert.match(client, /className="stat-card" onClick=\{\(\)=>go\("Provas"\)\}/);
  // O de dor abre a lesão em vez de mandar para a lista de alunos.
  assert.match(client, /openPain\(\{id:painReports\[0\]\.id,athleteName:painReports\[0\]\.athlete_name\}\)/);
  assert.match(css, /\.stats \.stat-card\{/);
});

test("leaves only an undo on a race that was already approved", async () => {
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  const css = await readCss("../app/globals.css");
  // Aprovada, a decisão está tomada: oferecer "aprovar" e "não periodizar" de
  // novo só confunde. Resta poder desfazer.
  assert.match(client, /race\.status==="Aprovada"\s*\?\s*<button className="race-cancel"/);
  assert.match(client, /review\(race,"Aguardando análise"/);
  assert.match(css, /\.race-cancel\{[^}]*color:var\(--red\)/);
});

/* -------------------------------------------------------------------------- *
 * Integrações — normalização, erros e honestidade de estado
 * -------------------------------------------------------------------------- */

test("normalizes a real activity from each provider", async () => {
  const { execSync } = await import("node:child_process");
  const saida = execSync(
    `npx tsx -e "` +
    `import {normalizeActivity,averagePaceSeconds,weekStartOf,workoutDayOf} from './worker/integrations.ts';` +
    `const s=normalizeActivity('strava',{id:1,start_date:'2026-08-24T07:00:00Z',distance:10000,moving_time:3000,average_heartrate:155});` +
    `const g=normalizeActivity('garmin',{summaryId:'g1',startTimeInSeconds:1787554800,distanceInMeters:10000,durationInSeconds:3000,averageHeartRateInBeatsPerMinute:150});` +
    `const z=normalizeActivity('zepp',{trackid:'z1',start_time:1787554800,dis:10000,run_time:3000,avg_heart_rate:145});` +
    `const a=normalizeActivity('apple',{uuid:'a1',startDate:'2026-08-24T07:00:00Z',totalDistanceMeters:10000,durationSeconds:3000,averageHeartRate:140});` +
    `console.log(JSON.stringify({s,g,z,a,pace:averagePaceSeconds(s),semana:weekStartOf(s.startedAt),dia:workoutDayOf(s.startedAt)}))"`,
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 180000 },
  );
  const d = JSON.parse(saida.trim().split("\n").pop());
  // Os quatro formatos, muito diferentes entre si, chegam ao mesmo resultado.
  for (const provedor of ["s", "g", "z", "a"]) {
    assert.equal(d[provedor].distanceMeters, 10000, `${provedor}: distância`);
    assert.equal(d[provedor].movingSeconds, 3000, `${provedor}: duração`);
    assert.ok(d[provedor].averageHeartRate > 0, `${provedor}: frequência cardíaca`);
    assert.equal(d[provedor].startedAt, 1787554800000, `${provedor}: instante de início`);
  }
  // 10 km em 50 min são 5:00/km, e a atividade cai na semana e no dia certos.
  assert.equal(d.pace, 300);
  assert.equal(d.semana, "2026-08-24");
  assert.equal(d.dia, "SEG");
});

test("refuses an activity without the data that identifies it", async () => {
  const { execSync } = await import("node:child_process");
  const saida = execSync(
    `npx tsx -e "` +
    `import {normalizeActivity,averagePaceSeconds} from './worker/integrations.ts';` +
    `console.log(JSON.stringify({semId:normalizeActivity('strava',{start_date:'2026-08-24T07:00:00Z'}),` +
    `semData:normalizeActivity('strava',{id:5}),dataRuim:normalizeActivity('strava',{id:5,start_date:'ontem'}),` +
    `paceCurto:averagePaceSeconds(normalizeActivity('strava',{id:7,start_date:'2026-08-24T07:00:00Z',distance:200,moving_time:90}))}))"`,
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 180000 },
  );
  const d = JSON.parse(saida.trim().split("\n").pop());
  // Sem id ou sem instante não há como evitar duplicata nem casar com o treino.
  assert.equal(d.semId, null);
  assert.equal(d.semData, null);
  assert.equal(d.dataRuim, null);
  // Distância curta demais produziria um ritmo sem sentido.
  assert.equal(d.paceCurto, null);
});

test("blames the right side when a stored token cannot be read", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/api-client.ts", import.meta.url), "utf8");
  // Token que não decifra é problema desta instalação — a chave mudou —, não do
  // Strava. Reportar "falha no Strava" mandaria quem investiga para o lado errado.
  assert.match(worker, /if \(!acesso\) return \{ erro: "token_unreadable" \};/);
  assert.match(client, /token_unreadable: "A autorização guardada não pode mais ser lida/);
  assert.match(client, /refresh_failed: "A autorização expirou e não pôde ser renovada/);
});

test("uses PKCE only where the provider asks for it", async () => {
  const integrations = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(integrations, /id: "garmin"[\s\S]*?authType: "oauth2-pkce"/);
  assert.match(integrations, /id: "zepp"[\s\S]*?authType: "oauth2"/);
  // O desafio só é montado para quem pede PKCE, e o verifier fica no servidor.
  assert.match(worker, /provider\.authType === "oauth2-pkce" \? createCodeVerifier\(\) : null/);
  assert.match(worker, /if \(verifier\) \{\s*params\.set\("code_challenge"/);
});

test("keeps an Apple workout on the athlete who owns the token", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // O corpo da requisição não escolhe o atleta: quem escolhe é o token.
  assert.match(worker, /SELECT athlete_name FROM device_ingest_tokens WHERE token_hash = \? AND revoked_at IS NULL/);
  assert.match(worker, /storeActivity\(env, record\.athlete_name, "apple"/);
  // Um token novo revoga o anterior, e desconectar revoga o que estiver ativo.
  assert.match(worker, /UPDATE device_ingest_tokens SET revoked_at = \? WHERE athlete_name = \? AND provider = 'apple' AND revoked_at IS NULL/);
  // A gravação é idempotente: reenviar o mesmo treino não duplica.
  assert.match(worker, /INSERT OR IGNORE INTO external_activities/);
});

test("never shows a connection as live when the service lost its credentials", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/ZonasAppClient.tsx", import.meta.url), "utf8");
  // Uma autorização antiga não vale nada se as credenciais saíram do ambiente:
  // nada seria importado, e dizer "Conectado" faria o atleta acreditar que os
  // treinos estão chegando.
  assert.match(worker, /const conexaoUtil = conexao && !pronto/);
  assert.match(worker, /status: "Suspensa", reason: "provider_not_configured"/);
  assert.match(client, /CONEXÃO SUSPENSA/);
});

/* -------------------------------------------------------------------------- *
 * Integrações completas — webhook, importação genérica e envio de treino
 * -------------------------------------------------------------------------- */

test("answers the Strava subscription handshake and refuses a wrong token", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // O Strava valida a inscrição devolvendo `hub.challenge`; sem conferir o
  // token combinado, qualquer um poderia inscrever um endpoint nosso.
  assert.match(worker, /async function stravaWebhookApi/);
  assert.match(worker, /"hub\.challenge": desafio/);
  assert.match(worker, /token !== env\.STRAVA_WEBHOOK_VERIFY_TOKEN/);
  // O evento diz de quem é a atividade pelo id do atleta no Strava.
  assert.match(worker, /external_athlete_id = \? AND status = 'Conectado'/);
  // Exclusão no Strava tira a atividade daqui também.
  assert.match(worker, /evento\.aspect_type === "delete"/);
  // A resposta sai antes do trabalho: o Strava reenvia se demorar.
  assert.match(worker, /ctx\.waitUntil/);
});

test("shares one import path between the providers that have a list endpoint", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const integrations = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  // A renovação de token vale para qualquer OAuth2, não só para o Strava.
  assert.match(worker, /async function tokenValidoDe/);
  assert.match(worker, /grant_type: "refresh_token"/);
  assert.doesNotMatch(worker, /async function syncStravaActivities/);
  assert.match(worker, /async function importarAtividades/);
  // Cada provedor declara o próprio endpoint; quem não tem, não finge ter.
  assert.match(integrations, /activitiesUrl: "https:\/\/www\.strava\.com\/api\/v3\/athlete\/activities"/);
  assert.match(integrations, /activitiesUrl: "https:\/\/apis\.garmin\.com\/wellness-api\/rest\/activities"/);
  assert.match(worker, /if \(!provider\.activitiesUrl\)/);
});

test("does not invent an API where the provider has none", async () => {
  const integrations = await readFile(new URL("../worker/integrations.ts", import.meta.url), "utf8");
  // O Zepp só expõe publicamente o SDK do relógio e uma API interna do
  // aplicativo. Usar a segunda quebraria os termos e poria a conta do atleta
  // em risco, então a importação passa pelo Strava.
  assert.match(integrations, /id: "zepp"[\s\S]*?activitiesUrl: null/);
  assert.match(integrations, /id: "zepp"[\s\S]*?canImportActivities: false/);
  assert.match(integrations, /O caminho oficial é o Zepp enviar ao Strava/);
  assert.doesNotMatch(integrations, /huami\.com\/v1\/sport/);
  // A Apple também não tem endpoint de servidor: entra pelo Atalho do iOS.
  assert.match(integrations, /id: "apple"[\s\S]*?activitiesUrl: null/);
});

test("translates a session into a Garmin workout", async () => {
  const { execSync } = await import("node:child_process");
  const saida = execSync(
    `npx tsx -e "import {toGarminWorkout} from './worker/integrations.ts';` +
    `console.log(JSON.stringify(toGarminWorkout('Intervalado','Limiar',[` +
    `{kind:'simple',label:'Aquecimento',minutes:10,zone:'Z1'},` +
    `{kind:'repeat',label:'Série',repetitions:3,effortMinutes:3,effortZone:'Z4',recoveryMinutes:2,recoveryZone:'Z1'},` +
    `{kind:'simple',label:'Desaquecimento',minutes:8,zone:'Z1'}])))"`,
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", timeout: 180000 },
  );
  const w = JSON.parse(saida.trim().split("\n").pop());
  // A repetição é expandida em passos, para o treino ficar legível no relógio.
  assert.equal(w.steps.length, 8);
  assert.equal(w.sport, "RUNNING");
  assert.equal(w.steps[0].intensity, "WARMUP");
  // "desaquecimento" contém "aquec": sem cuidado, o treino terminava marcado
  // como aquecimento.
  assert.equal(w.steps[w.steps.length - 1].intensity, "COOLDOWN");
  assert.equal(w.steps[0].durationValue, 600);
  assert.equal(w.steps[0].durationValueType, "SECOND");
  assert.ok(w.steps.some((p) => p.intensity === "RECOVERY"));
});

test("refuses to send a Garmin workout until the program is approved", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  // O endereço da Training API só vem no material que o Garmin entrega ao
  // aprovar a conta. Inventar uma URL faria a integração parecer pronta.
  assert.match(worker, /if \(env\.GARMIN_TRAINING_API_ENABLED !== "true"\) return \{ enviado: false, erro: "training_api_not_enabled" \};/);
  assert.match(worker, /if \(!env\.GARMIN_TRAINING_API_URL\) return \{ enviado: false, erro: "training_api_url_missing" \};/);
  assert.doesNotMatch(worker, /https:\/\/apis\.garmin\.com\/training-api/);
  // O resto do caminho está pronto e passa a valer no dia da aprovação.
  assert.match(worker, /const treino = toGarminWorkout\(/);
  assert.match(worker, /action === "send_workout"/);
});
