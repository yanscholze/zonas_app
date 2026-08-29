/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  MIN_PASSWORD_LENGTH,
  accountByEmail,
  createAccount,
  createSession,
  destroySession,
  destroySessionsForUser,
  ensureCoachAccount,
  ensureDevAccount,
  expiredSessionCookie,
  generateTemporaryPassword,
  hashPassword,
  identityFromRequest,
  isLockedOut,
  isValidEmail,
  passwordProblem,
  readSessionToken,
  registerFailedAttempt,
  registerSuccessfulLogin,
  sessionCookie,
  setImpersonation,
  setPassword,
  verifyPassword,
} from "./auth";
import {
  PROVIDERS,
  SUPPORTED_PROVIDER_LABELS,
  averagePaceSeconds,
  normalizeActivity,
  providerById,
  weekStartOf,
  workoutDayOf,
  type ProviderDefinition,
  type ProviderId,
} from "./integrations";
import * as schema from "../db/schema";
import { tableColumns, tableSql } from "../db/sql";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  COACH_EMAIL?: string;
  DEV_LOGIN?: string;
  DEV_INITIAL_PASSWORD?: string;
  COACH_INITIAL_PASSWORD?: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  STRAVA_TOKEN_ENCRYPTION_KEY?: string;
  GARMIN_CONSUMER_KEY?: string;
  GARMIN_CONSUMER_SECRET?: string;
  GARMIN_ACTIVITY_API_ENABLED?: string;
  GARMIN_TRAINING_API_ENABLED?: string;
  ZEPP_APP_ID?: string;
  ZEPP_APP_SECRET?: string;
  ZEPP_WEBHOOK_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * E-mail da conta do treinador, vindo de `COACH_EMAIL`. Não há endereço padrão:
 * um e-mail fixo no código, somado a uma senha inicial também fixa, seria uma
 * porta conhecida em toda instalação onde as variáveis fossem esquecidas.
 * Enquanto não estiver configurado, nenhuma conta de treinador é criada.
 */
const coachEmailOf = (env: Env) => env.COACH_EMAIL?.trim().toLowerCase() || null;
const JSON_BODY_LIMIT = 64 * 1024;
const TRAINING_BODY_LIMIT = 256 * 1024;
const SECURITY_LOG_RETENTION_DAYS = 90;
const SECURITY_LOG_RETENTION_MS = SECURITY_LOG_RETENTION_DAYS * 86_400_000;

const allowedBodyKeys: Record<string, Set<string>> = {
  "/api/athletes": new Set(["name","initials","distance","phase","week","nextWorkout","status","phone","email","trainingDays","integration","action","reason"]),
  "/api/athlete-profile": new Set(["athleteName","phone","birthDate","objective","integration","trainingDays"]),
  "/api/athlete-planning": new Set(["athleteName","plan","phase","weekNumber","totalWeeks"]),
  "/api/performance-tests": new Set(["athleteName","testDate","distanceKm","minutes","seconds","age","id","action","zones","tempoRuns"]),
  "/api/training-weeks": new Set(["athleteName","weekStart","plan","phase","weekLabel","trainingDays","sessions","status","auditDifferences","expectedUpdatedAt"]),
  "/api/pain-reports": new Set(["athleteName","bodyArea","intensity","trainingImpact","note","action","id","weekStart","status"]),
  "/api/races-records": new Set(["kind","athleteName","name","raceDate","distance","city","goal","priority","resultTime","eventName","action","id","status"]),
  "/api/athlete-access": new Set(["athleteName","email","status"]),
  "/api/access-request": new Set(["name","phone","objective","distance","trainingDays","integration"]),
  "/api/access-requests": new Set(["id","action"]),
  "/api/backups": new Set(["action","id","label"]),
  "/api/student/pain-reports": new Set(["bodyArea","intensity","trainingImpact","note"]),
  "/api/student/feedbacks": new Set(["feeling","note","weekStart","workoutDay"]),
  "/api/student/workout-executions": new Set(["weekStart","workoutDay","actualMinutes","actualKm","action","note"]),
  "/api/student/integration-preference": new Set(["integration"]),
  "/api/financial": new Set(["action","pixKey","pixName","defaultAmount","dueDay","athleteName","referenceMonth","amount","status","dueDate"]),
  "/api/feedbacks": new Set(["id","status"]),
  "/api/student/races-records": new Set(["kind","name","raceDate","distance","city","goal","priority","resultTime","eventName"]),
  "/api/plan-template-overrides": new Set(["plan","weekNumber","sessions"]),
  "/api/auth/login": new Set(["email","password"]),
  "/api/auth/register": new Set(["name","email","password"]),
  "/api/auth/password": new Set(["currentPassword","newPassword"]),
  "/api/accounts": new Set(["action","email","name","athleteName","password"]),
  "/api/integrations": new Set(["action","provider","athleteName","payload"]),
  "/api/dev/coaches": new Set(["action","email","name","password"]),
  "/api/student/integrations": new Set(["action","provider"]),
};

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function validStructuredValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === "string") return value.length <= 12_000;
  if (value === null || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 200 && value.every(item => validStructuredValue(item, depth + 1));
  if (typeof value !== "object") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 200 && entries.every(([key, item]) => !["__proto__","prototype","constructor"].includes(key) && validStructuredValue(item, depth + 1));
}

async function validateApiEnvelope(request: Request, url: URL): Promise<Response | null> {
  if (["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase())) return null;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "json_content_type_required" }, { status: 415 });
  }
  const limit = url.pathname.includes("training-weeks") ? TRAINING_BODY_LIMIT : JSON_BODY_LIMIT;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > limit) return Response.json({ error: "payload_too_large", maxBytes: limit }, { status: 413 });
  const raw = await request.clone().text();
  if (new TextEncoder().encode(raw).byteLength > limit) return Response.json({ error: "payload_too_large", maxBytes: limit }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!input || Array.isArray(input) || typeof input !== "object" || !validStructuredValue(input)) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }
  const allowed = allowedBodyKeys[url.pathname];
  if (allowed && Object.keys(input as Record<string, unknown>).some(key => !allowed.has(key))) {
    return Response.json({ error: "unexpected_field" }, { status: 400 });
  }
  return null;
}

/**
 * A identidade é resolvida uma única vez por requisição, no início de
 * `routeRequest`, e guardada aqui. As dezenas de chamadas espalhadas pelos
 * handlers continuam podendo ler o ator de forma síncrona, sem repetir a
 * consulta da sessão a cada uso.
 */
const resolvedIdentities = new WeakMap<Request, ApiIdentity | null>();

function normalizedAuthenticatedEmail(request: Request): string | null {
  return resolvedIdentities.get(request)?.email ?? null;
}

function isLocalDevelopmentHost(url: URL): boolean {
  return url.hostname === "terminal.local" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function requireCoachApiAccess(request: Request): Response | null {
  const identity = resolvedIdentities.get(request) ?? null;
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  if (!isCoachLevel(identity)) {
    return Response.json({ error: "coach_access_required" }, { status: 403 });
  }
  return null;
}

/**
 * De quem é a carteira que esta requisição enxerga.
 *
 * Um treinador vê os próprios alunos. A conta de manutenção vê a carteira do
 * treinador que estiver visitando e, sem visita nenhuma, vê tudo — é o modo de
 * diagnóstico. `null` significa "sem recorte".
 */
function carteiraDe(request: Request): string | null {
  const identity = resolvedIdentities.get(request) ?? null;
  if (identity?.role === "coach") return identity.email;
  if (identity?.role === "dev") return identity.visitandoEmail ?? null;
  return null;
}

/**
 * Recorte SQL dos alunos de um treinador.
 *
 * O recorte é estrito. Um primeiro rascunho incluía também os alunos sem dono,
 * para não esconder os que existiam antes desta separação — mas com mais de um
 * treinador isso fazia os mesmos alunos aparecerem em todas as carteiras. Os
 * alunos antigos são atribuídos ao treinador principal uma única vez, por
 * `atribuiAlunosSemDono`, e a partir daí cada um vê só os seus.
 */
function recorteDeAlunos(carteira: string | null, coluna = "athletes.coach_email"): { clausula: string; valores: string[] } {
  if (!carteira) return { clausula: "", valores: [] };
  return { clausula: `${coluna} = ?`, valores: [carteira] };
}

let alunosAtribuidos = false;

/**
 * Dá dono aos alunos cadastrados antes de existir separação por treinador.
 *
 * Roda uma vez por instância e só age sobre linhas sem dono, então repetir é
 * inofensivo e nenhum vínculo já definido é sobrescrito.
 */
async function atribuiAlunosSemDono(env: Env): Promise<void> {
  if (alunosAtribuidos) return;
  const principal = coachEmailOf(env);
  if (!principal) return;
  await env.DB.prepare("UPDATE athletes SET coach_email = ? WHERE coach_email IS NULL").bind(principal).run();
  alunosAtribuidos = true;
}

/** Só a conta de manutenção alcança o diagnóstico. */
function requireDevApiAccess(request: Request): Response | null {
  const identity = resolvedIdentities.get(request) ?? null;
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  if (identity.role !== "dev") return Response.json({ error: "dev_access_required" }, { status: 403 });
  return null;
}

type ApiIdentity =
  | { role: "dev"; email: string; visitandoEmail?: string }
  | { role: "coach"; email: string }
  | { role: "student"; email: string; athleteName: string };

/** A conta de manutenção alcança tudo o que o treinador alcança, e mais. */
function isCoachLevel(identity: ApiIdentity | null): boolean {
  return identity?.role === "coach" || identity?.role === "dev";
}



const recoverableTables = ["athletes", "athlete_profiles", "athlete_planning", "performance_tests", "training_weeks", "pain_reports", "training_feedbacks", "workout_executions", "athlete_races", "personal_records", "financial_settings", "student_payments"] as const;


/**
 * Garante que as tabelas existam, a partir do schema Drizzle.
 *
 * Antes cada uma destas instruções era uma constante SQL escrita à mão aqui,
 * paralela à declaração em `db/schema.ts`. As duas podiam divergir em silêncio
 * — e divergiam: `pain_reports` e `workout_executions` ganharam colunas no
 * schema que nunca chegaram ao SQL do Worker. Agora há uma fonte só.
 */
/**
 * Tabelas já conferidas nesta instância do Worker.
 *
 * O esquema não muda enquanto o processo vive, então conferir uma vez basta.
 * Sem esta memória, cada requisição repetiria um `PRAGMA table_info` por
 * tabela — trabalho inútil no caminho quente de toda chamada de API.
 */
const tabelasConferidas = new Set<string>();

async function ensureTables(env: Env, ...tabelas: Array<Parameters<typeof tableSql>[0]>): Promise<void> {
  const pendentes = tabelas.filter(tabela => !tabelasConferidas.has(nomeDaTabela(tabela)));
  if (!pendentes.length) return;

  const instrucoes = pendentes.flatMap(tabela => tableSql(tabela));
  await env.DB.batch(instrucoes.map(sql => env.DB.prepare(sql)));

  // Um banco criado por uma versão anterior não ganha colunas novas com
  // `CREATE TABLE IF NOT EXISTS`; este passo completa o que falta sem tocar
  // no que já está gravado.
  for (const tabela of pendentes) {
    await ensureColumns(env, nomeDaTabela(tabela), tableColumns(tabela));
    tabelasConferidas.add(nomeDaTabela(tabela));
  }
}

function nomeDaTabela(tabela: Parameters<typeof tableSql>[0]): string {
  return tableSql(tabela)[0].match(/EXISTS (\w+)/)?.[1] ?? "";
}

async function ensureRecoverableData(env: Env) {
  await ensureTables(env, schema.athletes, schema.athleteProfiles, schema.athletePlanning, schema.performanceTests, schema.trainingWeeks, schema.painReports, schema.trainingFeedbacks, schema.workoutExecutions, schema.athleteRaces, schema.personalRecords, schema.financialSettings, schema.studentPayments, schema.dataBackups);
}

async function ensureTrafficProtection(env: Env) {
  await ensureTables(env, schema.requestRateLimits, schema.securityEvents);
}

/**
 * Rotas cuja gravação é um UPSERT sobre uma chave estável — salvar duas vezes o
 * mesmo conteúdo produz exatamente o mesmo estado final. Elas são idempotentes
 * por construção e não precisam da proteção contra reenvio.
 *
 * Aplicar a deduplicação aqui era ativamente prejudicial: o treinador que
 * conferia a ficha e clicava em salvar de novo recebia `409` e uma mensagem de
 * falha, embora os dados já estivessem gravados. A proteção continua valendo
 * para as rotas que criam registros novos a cada envio, que é onde um duplo
 * clique realmente duplicaria dados.
 */
const idempotentWriteRoutes = new Set([
  "/api/athlete-profile",
  "/api/athlete-planning",
  "/api/athlete-access",
  "/api/plan-template-overrides",
  "/api/training-weeks",
  "/api/student/integration-preference",
]);

async function preventDuplicateSubmission(request: Request, url: URL, env: Env, actorEmail: string): Promise<Response | null> {
  if (["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase())) return null;
  if (idempotentWriteRoutes.has(url.pathname)) return null;
  await ensureTables(env, schema.requestDeduplication);
  const body = await request.clone().text();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${request.method}|${url.pathname}|${body}`));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const id = `${actorEmail}|${hash}`;
  const token = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_deduplication WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT OR IGNORE INTO request_deduplication (id, request_token, actor_email, route, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, token, actorEmail, url.pathname, now + 30_000, now),
  ]);
  const reservation = await env.DB.prepare("SELECT request_token FROM request_deduplication WHERE id = ? LIMIT 1").bind(id).first() as { request_token?: string } | null;
  if (!reservation?.request_token) return null;
  if (reservation?.request_token === token) return null;
  return Response.json({ error: "duplicate_submission", message: "Esta ação já foi recebida e não será repetida." }, { status: 409 });
}

function trafficRule(url: URL, method: string) {
  if (url.pathname === "/api/backups" && method !== "GET") return { max: 10, windowMs: 10 * 60_000 };
  if (url.pathname === "/api/access-request" && method !== "GET") return { max: 6, windowMs: 10 * 60_000 };
  if (url.pathname === "/api/athlete-access" && method !== "GET") return { max: 30, windowMs: 60_000 };
  if (url.pathname.startsWith("/api/student/") && method !== "GET") return { max: 20, windowMs: 60_000 };
  if (method !== "GET") return { max: 60, windowMs: 60_000 };
  return { max: 120, windowMs: 60_000 };
}

/**
 * Freia tentativas de login e de cadastro por origem, antes de qualquer
 * identidade existir. Sem isso, `/api/auth/login` seria a única rota da
 * aplicação sem nenhum limite de tentativas.
 */
async function enforceAuthThrottle(request: Request, url: URL, env: Env): Promise<Response | null> {
  if (request.method.toUpperCase() !== "POST") return null;
  if (isLocalDevelopmentHost(url)) return null;
  await ensureTrafficProtection(env);
  const origin = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "desconhecido";
  const windowMs = 10 * 60_000;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = `auth|${origin}|${url.pathname}|${windowStart}`;
  await env.DB.prepare(`INSERT INTO request_rate_limits (id, actor_email, route, method, window_start, request_count, updated_at)
    VALUES (?, ?, ?, 'POST', ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at`)
    .bind(id, `origem:${origin}`, url.pathname, windowStart, now).run();
  const row = await env.DB.prepare("SELECT request_count FROM request_rate_limits WHERE id = ? LIMIT 1").bind(id).first() as { request_count?: number } | null;
  if (Number(row?.request_count ?? 0) <= 20) return null;
  const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  await env.DB.prepare("INSERT INTO security_events (id, actor_email, event_type, route, details, created_at) VALUES (?, ?, 'Excesso de tentativas de acesso', ?, ?, ?)")
    .bind(crypto.randomUUID(), `origem:${origin}`, url.pathname, "POST bloqueado temporariamente", now).run();
  return Response.json({ error: "too_many_requests", retryAfter }, { status: 429, headers: { "retry-after": String(retryAfter) } });
}

async function enforceTrafficProtection(request: Request, url: URL, env: Env, actorEmail: string): Promise<Response | null> {
  if (isLocalDevelopmentHost(url)) return null;
  await ensureTrafficProtection(env);
  const method = request.method.toUpperCase();
  const rule = trafficRule(url, method);
  const now = Date.now();
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const id = `${actorEmail}|${method}|${url.pathname}|${windowStart}`;
  await env.DB.prepare(`INSERT INTO request_rate_limits (id, actor_email, route, method, window_start, request_count, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET request_count=request_count+1, updated_at=excluded.updated_at`)
    .bind(id, actorEmail, url.pathname, method, windowStart, now).run();
  const row = await env.DB.prepare("SELECT request_count FROM request_rate_limits WHERE id = ? LIMIT 1").bind(id).first() as { request_count?: number } | null;
  if (Number(row?.request_count ?? 0) <= rule.max) return null;
  const retryAfter = Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO security_events (id, actor_email, event_type, route, details, created_at) VALUES (?, ?, 'Limite de uso acionado', ?, ?, ?)").bind(crypto.randomUUID(), actorEmail, url.pathname, `${method} bloqueado temporariamente`, now),
    env.DB.prepare("DELETE FROM request_rate_limits WHERE window_start < ?").bind(now - 86_400_000),
  ]);
  return Response.json({ error: "too_many_requests", retryAfter }, { status: 429, headers: { "retry-after": String(retryAfter) } });
}

async function securityEventsApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTrafficProtection(env);
  await env.DB.prepare("DELETE FROM security_events WHERE created_at < ?").bind(Date.now() - SECURITY_LOG_RETENTION_MS).run();
  const events = await env.DB.prepare("SELECT id, actor_email, event_type, route, details, created_at FROM security_events ORDER BY created_at DESC LIMIT 20").all();
  return Response.json({ events: events.results, retentionDays: SECURITY_LOG_RETENTION_DAYS });
}

async function recordApplicationError(env: Env, request: Request, area: string, errorCode: string, statusCode = 503): Promise<void> {
  try {
    await ensureTables(env, schema.applicationErrors);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM application_errors WHERE created_at < ?").bind(now - SECURITY_LOG_RETENTION_MS),
      env.DB.prepare("INSERT INTO application_errors (id, area, error_code, method, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), area, errorCode, request.method.toUpperCase(), statusCode, now),
    ]);
  } catch { /* Monitoring must never hide the original failure. */ }
}

async function applicationFailure(env: Env, request: Request, area: string, errorCode: string): Promise<Response> {
  await recordApplicationError(env, request, area, errorCode);
  return Response.json({ error: errorCode }, { status: 503 });
}

async function applicationErrorsApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTables(env, schema.applicationErrors);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM application_errors WHERE created_at < ?").bind(now - SECURITY_LOG_RETENTION_MS).run();
  const since = now - 86_400_000;
  const [recent, summary] = await Promise.all([
    env.DB.prepare("SELECT id, area, error_code, method, status_code, created_at FROM application_errors ORDER BY created_at DESC LIMIT 20").all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM application_errors WHERE created_at >= ?").bind(since).first() as Promise<{ total?: number } | null>,
  ]);
  return Response.json({ errors: recent.results, last24Hours: Number(summary?.total ?? 0), healthy: Number(summary?.total ?? 0) === 0, retentionDays: SECURITY_LOG_RETENTION_DAYS });
}

async function createDataSnapshot(env: Env, label: string, actor: string) {
  await ensureRecoverableData(env);
  const results = await Promise.all(recoverableTables.map(table => env.DB.prepare(`SELECT * FROM ${table}`).all()));
  const data = Object.fromEntries(recoverableTables.map((table, index) => [table, results[index].results]));
  const recordCount = results.reduce((sum, result) => sum + result.results.length, 0);
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB.prepare("INSERT INTO data_backups (id, label, payload, record_count, created_by, created_at, restored_by, restored_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)")
    .bind(id, label, JSON.stringify(data), recordCount, actor, createdAt).run();
  return { id, label, recordCount, createdAt };
}

async function backupsApi(request: Request, env: Env): Promise<Response> {
  await ensureRecoverableData(env);
  const actor = normalizedAuthenticatedEmail(request) || "preview@zonasapp.local";
  if (request.method === "GET") {
    const downloadId = boundedText(new URL(request.url).searchParams.get("download"), 80);
    if (downloadId) {
      const backup = await env.DB.prepare("SELECT id, label, payload, created_at FROM data_backups WHERE id = ? LIMIT 1").bind(downloadId).first() as {id?:string;label?:string;payload?:string;created_at?:number}|null;
      if (!backup?.payload) return Response.json({ error: "backup_not_found" }, { status: 404 });
      return new Response(JSON.stringify({format:"zonasapp-backup-v1",label:backup.label,created_at:backup.created_at,data:JSON.parse(backup.payload)},null,2),{headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="zonasapp-backup-${new Date(Number(backup.created_at)).toISOString().slice(0,10)}.json"`,"cache-control":"no-store"}});
    }
    const backups = await env.DB.prepare("SELECT id, label, record_count, created_by, created_at, restored_by, restored_at FROM data_backups ORDER BY created_at DESC LIMIT 20").all();
    return Response.json({ backups: backups.results });
  }
  if (request.method === "POST") {
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (input.action !== "restore") {
      const label = boundedText(input.label ?? "Backup manual", 80) || "Backup manual";
      return Response.json(await createDataSnapshot(env, label, actor), { status: 201 });
    }
    const id = boundedText(input.id, 80);
    if (!id) return Response.json({ error: "backup_required" }, { status: 400 });
    const backup = await env.DB.prepare("SELECT payload FROM data_backups WHERE id = ? LIMIT 1").bind(id).first() as { payload?: string } | null;
    if (!backup?.payload) return Response.json({ error: "backup_not_found" }, { status: 404 });
    await createDataSnapshot(env, "Automático antes da restauração", actor);
    const data = JSON.parse(backup.payload) as Record<string, Array<Record<string, unknown>>>;
    const statements: D1PreparedStatement[] = [];
    for (const table of recoverableTables) {
      statements.push(env.DB.prepare(`DELETE FROM ${table}`));
      for (const row of Array.isArray(data[table]) ? data[table] : []) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        statements.push(env.DB.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...columns.map(column => row[column])));
      }
    }
    statements.push(env.DB.prepare("UPDATE data_backups SET restored_by = ?, restored_at = ? WHERE id = ?").bind(actor, Date.now(), id));
    await env.DB.batch(statements);
    return Response.json({ restored: true, id });
  }
  return new Response("Method not allowed", { status: 405 });
}

async function ensureAthleteAccess(env: Env) {
  await ensureTables(env, schema.athleteAccess, schema.accessAuditLog);
}

/**
 * Traduz a sessão em cookie para o formato de identidade usado pelos handlers.
 * Um aluno só é aceito se a conta continuar vinculada a um `athlete_access`
 * ativo, para que bloquear o acesso pelo painel encerre o uso de imediato.
 */
async function resolveApiIdentity(request: Request, env: Env): Promise<ApiIdentity | null> {
  const session = await identityFromRequest(env.DB, request);
  if (!session) return null;
  if (session.role === "dev") return { role: "dev", email: session.email, visitandoEmail: session.visitando?.email };
  if (session.role === "coach") return { role: "coach", email: session.email };
  await ensureAthleteAccess(env);
  const row = await env.DB.prepare(
    "SELECT athlete_name FROM athlete_access WHERE athlete_name = ? AND status = 'Ativo' LIMIT 1",
  ).bind(session.athleteName).first() as { athlete_name?: string } | null;
  return row?.athlete_name ? { role: "student", email: session.email, athleteName: row.athlete_name } : null;
}

async function sessionApi(request: Request, env: Env): Promise<Response> {
  const session = await identityFromRequest(env.DB, request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });
  if (session.role === "student") {
    await ensureAthleteAccess(env);
    const row = await env.DB.prepare(
      "SELECT status FROM athlete_access WHERE athlete_name = ? LIMIT 1",
    ).bind(session.athleteName).first() as { status?: string } | null;
    if (row?.status !== "Ativo") return Response.json({ error: "access_not_active" }, { status: 403 });
  }
  return Response.json({ authenticated: true, ...session });
}

/* -------------------------------------------------------------------------- */
/* Autenticação própria                                                        */
/* -------------------------------------------------------------------------- */

function isSecureRequest(url: URL): boolean {
  return url.protocol === "https:";
}

/** Falhas de login não dizem se foi o e-mail ou a senha que não bateu. */
const invalidCredentials = () => Response.json({ error: "invalid_credentials" }, { status: 401 });

async function authLoginApi(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  // A conta de manutenção entra por um identificador curto, não por e-mail.
  const email = boundedText(input.email, 254).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password) return invalidCredentials();

  const account = await accountByEmail(env.DB, email);
  if (!account) {
    // Gasta um tempo parecido com o de uma verificação real para que a
    // ausência da conta não seja detectável pela latência da resposta.
    await hashPassword(password);
    return invalidCredentials();
  }
  if (isLockedOut(account)) {
    return Response.json({ error: "account_temporarily_locked" }, { status: 429 });
  }
  if (account.status === "Bloqueado") {
    return Response.json({ error: "account_blocked" }, { status: 403 });
  }
  if (!await verifyPassword(password, account)) {
    await registerFailedAttempt(env.DB, account);
    return invalidCredentials();
  }

  await registerSuccessfulLogin(env.DB, account);
  const token = await createSession(env.DB, account);
  return Response.json(
    {
      authenticated: true,
      role: account.role,
      email: account.email,
      name: account.name,
      athleteName: account.athlete_name,
      mustChangePassword: Number(account.must_change_password) === 1,
    },
    { headers: { "set-cookie": sessionCookie(token, isSecureRequest(url)) } },
  );
}

async function authLogoutApi(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = readSessionToken(request);
  if (token) await destroySession(env.DB, token);
  return Response.json({ signedOut: true }, { headers: { "set-cookie": expiredSessionCookie(isSecureRequest(url)) } });
}

/**
 * Autocadastro do atleta: cria a conta já com senha, mas sem vínculo a um
 * aluno. Ela só vira acesso de verdade quando o treinador aprova a solicitação,
 * que é o momento em que `athlete_name` e `athlete_access` são preenchidos.
 */
async function authRegisterApi(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const email = boundedText(input.email, 254).toLowerCase();
  const name = boundedText(input.name, 120);
  const password = typeof input.password === "string" ? input.password : "";
  if (!isValidEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
  if (name.length < 3) return Response.json({ error: "name_too_short" }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return Response.json({ error: problem, minLength: MIN_PASSWORD_LENGTH }, { status: 400 });

  const existing = await accountByEmail(env.DB, email);
  if (existing) return Response.json({ error: "email_already_registered" }, { status: 409 });

  await createAccount(env.DB, { email, name, role: "student", password, status: "Aguardando aprovação" });
  const account = await accountByEmail(env.DB, email);
  if (!account) return Response.json({ error: "registration_failed" }, { status: 503 });
  const token = await createSession(env.DB, account);
  return Response.json(
    { registered: true, email, name },
    { status: 201, headers: { "set-cookie": sessionCookie(token, isSecureRequest(url)) } },
  );
}

async function authPasswordApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const session = await identityFromRequest(env.DB, request);
  if (!session) return Response.json({ error: "authentication_required" }, { status: 401 });
  const input = await request.json() as Record<string, unknown>;
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  const problem = passwordProblem(newPassword);
  if (problem) return Response.json({ error: problem, minLength: MIN_PASSWORD_LENGTH }, { status: 400 });

  const account = await accountByEmail(env.DB, session.email);
  if (!account || !await verifyPassword(currentPassword, account)) return invalidCredentials();

  await setPassword(env.DB, account.id, newPassword, false);
  // Trocar a senha derruba as outras sessões; a atual continua válida.
  const token = readSessionToken(request);
  await destroySessionsForUser(env.DB, account.id);
  const refreshed = await accountByEmail(env.DB, session.email);
  if (!refreshed) return Response.json({ error: "password_change_failed" }, { status: 503 });
  const newToken = await createSession(env.DB, refreshed);
  void token;
  return Response.json(
    { passwordChanged: true },
    { headers: { "set-cookie": sessionCookie(newToken, isSecureRequest(new URL(request.url))) } },
  );
}

/** Contas de aluno vistas e administradas pelo treinador. */
async function coachAccountsApi(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const accounts = await env.DB.prepare(
      `SELECT user_accounts.id, user_accounts.email, user_accounts.name, user_accounts.role,
              user_accounts.athlete_name, user_accounts.status, user_accounts.must_change_password,
              user_accounts.last_login_at, user_accounts.created_at
         FROM user_accounts
        ORDER BY user_accounts.role DESC, user_accounts.name`,
    ).all();
    return Response.json({ accounts: accounts.results });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const input = await request.json() as Record<string, unknown>;
  const action = boundedText(input.action, 30) || "create";
  const email = boundedText(input.email, 254).toLowerCase();

  if (action === "create") {
    const name = boundedText(input.name, 120);
    const athleteName = boundedText(input.athleteName, 120);
    if (!isValidEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
    if (name.length < 3) return Response.json({ error: "name_too_short" }, { status: 400 });
    if (!athleteName) return Response.json({ error: "athlete_required" }, { status: 400 });
    const existing = await accountByEmail(env.DB, email);
    if (existing && existing.athlete_name !== athleteName) {
      return Response.json({ error: "email_already_registered" }, { status: 409 });
    }
    const temporaryPassword = boundedText(input.password, 200) || generateTemporaryPassword();
    const problem = passwordProblem(temporaryPassword);
    if (problem) return Response.json({ error: problem, minLength: MIN_PASSWORD_LENGTH }, { status: 400 });
    await createAccount(env.DB, {
      email, name, role: "student", athleteName, password: temporaryPassword,
      mustChangePassword: true, status: "Ativo",
    });
    await linkAthleteAccess(env, athleteName, email, "Ativo", normalizedAuthenticatedEmail(request) ?? "sistema");
    // A senha temporária aparece uma única vez, no retorno desta chamada.
    return Response.json({ created: true, email, athleteName, temporaryPassword }, { status: 201 });
  }

  if (action === "reset_password") {
    const account = await accountByEmail(env.DB, email);
    if (!account) return Response.json({ error: "account_not_found" }, { status: 404 });
    const temporaryPassword = generateTemporaryPassword();
    await setPassword(env.DB, account.id, temporaryPassword, true);
    await destroySessionsForUser(env.DB, account.id);
    return Response.json({ reset: true, email, temporaryPassword });
  }

  if (action === "block" || action === "unblock") {
    const account = await accountByEmail(env.DB, email);
    if (!account) return Response.json({ error: "account_not_found" }, { status: 404 });
    if (account.role === "coach") return Response.json({ error: "cannot_block_coach" }, { status: 400 });
    const status = action === "block" ? "Bloqueado" : "Ativo";
    await env.DB.prepare("UPDATE user_accounts SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, Date.now(), account.id).run();
    if (action === "block") await destroySessionsForUser(env.DB, account.id);
    if (account.athlete_name) {
      await linkAthleteAccess(env, account.athlete_name, account.email, status === "Bloqueado" ? "Bloqueado" : "Ativo", normalizedAuthenticatedEmail(request) ?? "sistema");
    }
    return Response.json({ status });
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
}

/** Mantém `athlete_access` em sincronia com a conta de login do aluno. */
async function linkAthleteAccess(env: Env, athleteName: string, email: string, status: string, actorEmail: string): Promise<void> {
  await ensureAthleteAccess(env);
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT email, status FROM athlete_access WHERE athlete_name = ? LIMIT 1")
    .bind(athleteName).first() as { email?: string; status?: string } | null;
  await env.DB.prepare(`INSERT INTO athlete_access (id, athlete_name, email, status, invited_at, activated_at, last_access_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(athlete_name) DO UPDATE SET
      email = excluded.email, status = excluded.status,
      invited_at = COALESCE(athlete_access.invited_at, excluded.invited_at),
      activated_at = CASE WHEN excluded.status = 'Ativo' THEN excluded.updated_at ELSE athlete_access.activated_at END,
      updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), athleteName, email, status, now, status === "Ativo" ? now : null, now).run();
  await env.DB.prepare(`INSERT INTO access_audit_log (id, athlete_name, actor_email, action, previous_status, new_status, previous_email, new_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), athleteName, actorEmail, "Conta de acesso atualizada", existing?.status ?? null, status, existing?.email ?? null, email, now).run();
}

async function athleteAccessApi(request: Request, env: Env): Promise<Response> {
  await ensureAthleteAccess(env);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const athleteName = String(url.searchParams.get("athlete") ?? "").trim();
    if (!athleteName) return Response.json({ error: "athlete_required" }, { status: 400 });
    const [access, history] = await Promise.all([
      env.DB.prepare("SELECT * FROM athlete_access WHERE athlete_name = ? LIMIT 1").bind(athleteName).first(),
      env.DB.prepare("SELECT id, action, actor_email, previous_status, new_status, previous_email, new_email, created_at FROM access_audit_log WHERE athlete_name = ? ORDER BY created_at DESC LIMIT 20").bind(athleteName).all(),
    ]);
    return Response.json({ access: access ?? null, history: history.results });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const athleteName = boundedText(input.athleteName, 120);
    const email = boundedText(input.email, 254).toLowerCase();
    const status = boundedText(input.status ?? "Convite preparado", 30);
    if (!athleteName || !email) return Response.json({ error: "athlete_and_email_required" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
    if (!["Convite preparado", "Ativo", "Bloqueado"].includes(status)) return Response.json({ error: "invalid_status" }, { status: 400 });
    const existing = await env.DB.prepare("SELECT email, status FROM athlete_access WHERE athlete_name = ? LIMIT 1").bind(athleteName).first() as { email?: string; status?: string } | null;
    const existingEmail = await env.DB.prepare("SELECT athlete_name FROM athlete_access WHERE email = ? AND athlete_name <> ? LIMIT 1").bind(email, athleteName).first();
    if (existingEmail) return Response.json({ error: "email_already_linked" }, { status: 409 });
    const id = crypto.randomUUID();
    const now = Date.now();
    const activatedAt = status === "Ativo" ? now : null;
    await env.DB.prepare(`INSERT INTO athlete_access (id, athlete_name, email, status, invited_at, activated_at, last_access_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(athlete_name) DO UPDATE SET
        email=excluded.email, status=excluded.status,
        invited_at=COALESCE(athlete_access.invited_at, excluded.invited_at),
        activated_at=CASE WHEN excluded.status='Ativo' THEN excluded.updated_at ELSE athlete_access.activated_at END,
        updated_at=excluded.updated_at`)
      .bind(id, athleteName, email, status, now, activatedAt, now).run();
    const emailChanged = Boolean(existing?.email && existing.email !== email);
    const action = emailChanged ? "E-mail de acesso alterado" : status === "Bloqueado" && existing?.status === "Ativo" ? "Sessões e acesso encerrados" : status === "Bloqueado" ? "Acesso bloqueado" : status === "Ativo" && existing?.status === "Bloqueado" ? "Acesso reativado" : status === "Ativo" ? "Acesso ativado" : "Vínculo preparado";
    const actorEmail = normalizedAuthenticatedEmail(request) || "preview@zonasapp.local";
    await env.DB.prepare(`INSERT INTO access_audit_log (id, athlete_name, actor_email, action, previous_status, new_status, previous_email, new_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), athleteName, actorEmail, action, existing?.status ?? null, status, existing?.email ?? null, email, now).run();
    return Response.json({ athleteName, email, status, action, invitedAt: now, activatedAt, updatedAt: now }, { status: 201 });
  }
  return new Response("Method not allowed", { status: 405 });
}

async function ensureAccessRequests(env: Env) {
  await ensureTables(env, schema.accessRequests);
}

async function accessRequestApi(request: Request, env: Env, sessionEmail: string, sessionName: string): Promise<Response> {
  const email = sessionEmail;
  if (email === coachEmailOf(env)) return Response.json({ error: "student_request_only" }, { status: 403 });
  void sessionName;
  await ensureAccessRequests(env);
  if (request.method === "GET") {
    const requestRow = await env.DB.prepare("SELECT id, email, name, phone, objective, distance, training_days, integration, status, created_at, updated_at FROM access_requests WHERE email = ? LIMIT 1").bind(email).first();
    return Response.json({ request: requestRow ?? null });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const name = boundedText(input.name, 120);
    const phone = boundedText(input.phone, 30);
    const objective = boundedText(input.objective, 240);
    const distance = boundedText(input.distance, 30);
    const integration = boundedText(input.integration, 30) || "Sem integração";
    const allowedDistances = ["Iniciantes", "5 km", "10 km", "Meia", "Maratona"];
    const allowedIntegrations = [...SUPPORTED_PROVIDER_LABELS, "Sem integração"];
    const trainingDays = Array.isArray(input.trainingDays) ? input.trainingDays.map(day => boundedText(day, 12)).filter(day => ["SEG","TER","QUA","QUI","SEX","SÁB","DOM"].includes(day)).slice(0, 7) : [];
    if (!name || name.length < 3 || !allowedDistances.includes(distance) || !trainingDays.length || !allowedIntegrations.includes(integration)) return Response.json({ error: "invalid_registration" }, { status: 400 });
    const existing = await env.DB.prepare("SELECT status FROM access_requests WHERE email = ? LIMIT 1").bind(email).first() as {status?:string}|null;
    if (existing?.status === "Aprovado") return Response.json({ error: "already_approved" }, { status: 409 });
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.prepare(`INSERT INTO access_requests (id,email,name,phone,objective,distance,training_days,integration,status,reviewed_by,reviewed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)
      ON CONFLICT(email) DO UPDATE SET name=excluded.name,phone=excluded.phone,objective=excluded.objective,distance=excluded.distance,training_days=excluded.training_days,integration=excluded.integration,status='Pendente',reviewed_by=NULL,reviewed_at=NULL,updated_at=excluded.updated_at`)
      .bind(id,email,name,phone||null,objective||null,distance,JSON.stringify(trainingDays),integration,"Pendente",now,now).run();
    return Response.json({ id, email, status:"Pendente", createdAt:now }, { status: 201 });
  }
  return new Response("Method not allowed", { status: 405 });
}

async function accessRequestsCoachApi(request: Request, env: Env): Promise<Response> {
  await Promise.all([ensureAccessRequests(env), ensureAthleteAccess(env)]);
  await ensureTables(env, schema.athletes, schema.athleteProfiles, schema.athletePlanning);
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM access_requests ORDER BY CASE status WHEN 'Pendente' THEN 0 ELSE 1 END, created_at DESC LIMIT 100").all();
    return Response.json({ requests: result.results });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const id = boundedText(input.id, 80); const action = boundedText(input.action, 20);
    if (!id || !["approve","reject"].includes(action)) return Response.json({ error:"invalid_decision" }, { status:400 });
    const row = await env.DB.prepare("SELECT * FROM access_requests WHERE id = ? LIMIT 1").bind(id).first() as Record<string,unknown>|null;
    if (!row || row.status !== "Pendente") return Response.json({ error:"request_not_pending" }, { status:409 });
    const now=Date.now(); const actor=normalizedAuthenticatedEmail(request) ?? "sistema";
    if(action==="reject"){
      await env.DB.prepare("UPDATE access_requests SET status='Recusado', reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?").bind(actor,now,now,id).run();
      return Response.json({id,status:"Recusado"});
    }
    const name=String(row.name); const email=String(row.email); const distance=String(row.distance); const days=String(row.training_days||"[]"); const integration=String(row.integration||"Sem integração");
    const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")||"AL";
    const plan=distance==="Iniciantes"?"Iniciantes":distance==="5 km"?"5 km Bronze":distance==="10 km"?"10 km Lion":distance==="Meia"?"Meia Start":"One Marathon";
    const totalWeeks=distance==="Iniciantes"?10:distance==="5 km"?10:distance==="10 km"?16:distance==="Meia"?14:20;
    const phase=distance==="Iniciantes"?"Adaptação":"Base"; const athleteId=crypto.randomUUID();
    const existingName=await env.DB.prepare("SELECT id FROM athletes WHERE name = ? LIMIT 1").bind(name).first() as {id?:string}|null;
    const existingEmail=await env.DB.prepare("SELECT athlete_name FROM athlete_access WHERE email = ? LIMIT 1").bind(email).first() as {athlete_name?:string}|null;
    if(existingEmail?.athlete_name&&existingEmail.athlete_name!==name)return Response.json({error:"email_already_linked"},{status:409});
    const statements=[];
    if(!existingName?.id) statements.push(env.DB.prepare("INSERT INTO athletes (id,name,initials,distance,phase,week,next_workout,status,phone,email,training_days,integration,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(athleteId,name,initials,distance,phase,`1 de ${totalWeeks}`,"Aguardando programação",null,row.phone||null,email,days,integration,now));
    statements.push(
      env.DB.prepare("INSERT INTO athlete_profiles (athlete_name,phone,birth_date,objective,integration,training_days,updated_at) VALUES (?,?,NULL,?,?,?,?) ON CONFLICT(athlete_name) DO UPDATE SET phone=excluded.phone,objective=excluded.objective,integration=excluded.integration,training_days=excluded.training_days,updated_at=excluded.updated_at").bind(name,row.phone||null,row.objective||null,integration,days,now),
      env.DB.prepare("INSERT INTO athlete_planning (athlete_name,plan,phase,week_number,total_weeks,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(athlete_name) DO UPDATE SET plan=excluded.plan,phase=excluded.phase,week_number=excluded.week_number,total_weeks=excluded.total_weeks,updated_at=excluded.updated_at").bind(name,plan,phase,1,totalWeeks,now),
      env.DB.prepare("INSERT INTO athlete_access (id,athlete_name,email,status,invited_at,activated_at,last_access_at,updated_at) VALUES (?,?,?,?,?,?,NULL,?) ON CONFLICT(athlete_name) DO UPDATE SET email=excluded.email,status='Ativo',activated_at=excluded.activated_at,updated_at=excluded.updated_at").bind(crypto.randomUUID(),name,email,"Ativo",Number(row.created_at)||now,now,now),
      env.DB.prepare("INSERT INTO access_audit_log (id,athlete_name,actor_email,action,previous_status,new_status,previous_email,new_email,created_at) VALUES (?,?,?,?,NULL,?,?,?,?)").bind(crypto.randomUUID(),name,actor,"Cadastro solicitado aprovado","Ativo",null,email,now),
      env.DB.prepare("UPDATE access_requests SET status='Aprovado', reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?").bind(actor,now,now,id),
    );
    await env.DB.batch(statements);
    return Response.json({id,status:"Aprovado",athleteName:name});
  }
  return new Response("Method not allowed", { status:405 });
}

async function studentDashboardApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTables(env, schema.trainingWeeks, schema.athleteProfiles, schema.athleteRaces, schema.personalRecords);
  const brazilNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const brazilDay = brazilNow.getUTCDay() || 7;
  brazilNow.setUTCDate(brazilNow.getUTCDate() - brazilDay + 1);
  const currentWeekStart = brazilNow.toISOString().slice(0, 10);
  const [week, profile, races, records] = await Promise.all([
    env.DB.prepare("SELECT * FROM training_weeks WHERE athlete_name = ? AND week_start = ? AND status = 'Liberada' LIMIT 1").bind(athleteName, currentWeekStart).first(),
    env.DB.prepare("SELECT integration FROM athlete_profiles WHERE athlete_name = ? LIMIT 1").bind(athleteName).first(),
    env.DB.prepare("SELECT * FROM athlete_races WHERE athlete_name = ? ORDER BY race_date ASC").bind(athleteName).all(),
    env.DB.prepare("SELECT * FROM personal_records WHERE athlete_name = ? ORDER BY updated_at DESC").bind(athleteName).all(),
  ]);
  return Response.json({ athleteName, currentWeekStart, week: week ?? null, profile: profile ?? null, races: races.results, records: records.results });
}

async function studentProfileApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTables(env, schema.athletes, schema.athleteProfiles, schema.athletePlanning);
  const [athlete, profile, planning] = await Promise.all([
    env.DB.prepare("SELECT name,distance,phase,email FROM athletes WHERE name = ? LIMIT 1").bind(athleteName).first(),
    env.DB.prepare("SELECT phone,birth_date,objective,integration,training_days,updated_at FROM athlete_profiles WHERE athlete_name = ? LIMIT 1").bind(athleteName).first(),
    env.DB.prepare("SELECT plan,phase,week_number,total_weeks FROM athlete_planning WHERE athlete_name = ? LIMIT 1").bind(athleteName).first(),
  ]);
  return Response.json({ athlete: athlete ?? { name: athleteName }, profile: profile ?? null, planning: planning ?? null });
}

async function studentPerformanceTestsApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTables(env, schema.performanceTests);
  const tests = await env.DB.prepare("SELECT id,test_date,distance_km,total_seconds,vam,vo2,fc_max,pace_seconds,zones,tempo_runs,status FROM performance_tests WHERE athlete_name = ? ORDER BY test_date DESC,created_at DESC").bind(athleteName).all();
  return Response.json({ tests: tests.results });
}

async function studentIntegrationPreferenceApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const integration = boundedText(input.integration, 40);
  const allowed = ["Strava","Garmin","Amazfit","Apple Saúde / Apple Watch","Sem integração"];
  if (!allowed.includes(integration)) return Response.json({ error:"invalid_integration" }, { status:400 });
  await ensureTables(env, schema.athleteProfiles);
  const existing = await env.DB.prepare("SELECT training_days FROM athlete_profiles WHERE athlete_name = ? LIMIT 1").bind(athleteName).first() as {training_days?:string}|null;
  await env.DB.prepare(`INSERT INTO athlete_profiles (athlete_name,phone,birth_date,objective,integration,training_days,updated_at)
    VALUES (?,NULL,NULL,NULL,?,?,?) ON CONFLICT(athlete_name) DO UPDATE SET integration=excluded.integration,updated_at=excluded.updated_at`)
    .bind(athleteName,integration,existing?.training_days||"[]",Date.now()).run();
  return Response.json({ integration, status: integration === "Sem integração" ? "Desativada" : "Aguardando conexão oficial" });
}

async function studentPainApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  return painReportsApi(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({ ...input, athleteName }) }), env);
}

async function studentRacesRecordsApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  if (request.method === "GET") return racesRecordsApi(new Request(`${request.url.split("?")[0]}?athlete=${encodeURIComponent(athleteName)}`, { headers: request.headers }), env);
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    return racesRecordsApi(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({ ...input, athleteName }) }), env);
  }
  return new Response("Method not allowed", { status: 405 });
}

async function athletesApi(request: Request, env: Env): Promise<Response> {
  await ensureTables(env, schema.athletes, schema.athletePlanning, schema.athleteAccess);
  await atribuiAlunosSemDono(env);
  const url = new URL(request.url);
  if (request.method === "GET") {
    // Por padrão a lista traz só quem está ativo. Os inativos continuam no
    // banco com todo o histórico e aparecem quando pedidos explicitamente.
    const incluir = boundedText(url.searchParams.get("include"), 20);
    const situacao = incluir === "archived" ? "athletes.archived_at IS NOT NULL"
      : incluir === "all" ? ""
      : "athletes.archived_at IS NULL";
    const carteira = recorteDeAlunos(carteiraDe(request));
    const condicoes = [situacao, carteira.clausula].filter(Boolean);
    const filtro = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
    const result = await env.DB.prepare(`SELECT athletes.*, athlete_access.status AS access_status, athlete_planning.plan AS saved_plan, athlete_planning.phase AS planning_phase, athlete_planning.week_number AS planning_week_number, athlete_planning.total_weeks AS planning_total_weeks FROM athletes LEFT JOIN athlete_access ON athlete_access.athlete_name = athletes.name LEFT JOIN athlete_planning ON athlete_planning.athlete_name = athletes.name ${filtro} ORDER BY athletes.created_at DESC`).bind(...carteira.valores).all();
    const totaisSql = `SELECT SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS ativos, SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS inativos FROM athletes${carteira.clausula ? ` WHERE ${carteira.clausula.replace(/athletes\./g, "")}` : ""}`;
    const totais = await env.DB.prepare(totaisSql).bind(...carteira.valores).first() as { ativos?: number; inativos?: number } | null;
    return Response.json({ athletes: result.results, counts: { active: Number(totais?.ativos ?? 0), archived: Number(totais?.inativos ?? 0) } });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const acao = boundedText(input.action, 20);

    // Inativar em vez de excluir: o aluno some da operação do dia a dia, mas
    // treinos, testes e queixas permanecem como registro do que foi feito.
    if (acao === "archive" || acao === "restore") {
      const alvo = boundedText(input.name, 120);
      if (!alvo) return Response.json({ error: "athlete_required" }, { status: 400 });
      const existe = await env.DB.prepare("SELECT name FROM athletes WHERE name = ? LIMIT 1").bind(alvo).first();
      if (!existe) return Response.json({ error: "athlete_not_found" }, { status: 404 });
      const arquivando = acao === "archive";
      const agora = Date.now();
      await env.DB.prepare("UPDATE athletes SET archived_at = ?, archived_reason = ? WHERE name = ?")
        .bind(arquivando ? agora : null, arquivando ? (boundedText(input.reason, 200) || null) : null, alvo).run();

      // O acesso acompanha a situação do aluno: um aluno inativo não entra, e
      // reativar não devolve o acesso sozinho — isso continua sendo decisão do
      // treinador na aba de contas.
      await ensureAthleteAccess(env);
      if (arquivando) {
        await env.DB.prepare("UPDATE athlete_access SET status = 'Bloqueado', updated_at = ? WHERE athlete_name = ?").bind(agora, alvo).run();
        const conta = await env.DB.prepare("SELECT id FROM user_accounts WHERE athlete_name = ? LIMIT 1").bind(alvo).first() as { id?: string } | null;
        if (conta?.id) {
          await env.DB.prepare("UPDATE user_accounts SET status = 'Bloqueado', updated_at = ? WHERE id = ?").bind(agora, conta.id).run();
          await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(conta.id).run();
        }
      }
      return Response.json({ name: alvo, archived: arquivando, archivedAt: arquivando ? agora : null });
    }

    const name = boundedText(input.name, 120);
    const initials = boundedText(input.initials, 8);
    const distance = boundedText(input.distance, 30);
    const phase = boundedText(input.phase, 40);
    const week = boundedText(input.week, 30);
    const nextWorkout = boundedText(input.nextWorkout, 160);
    const trainingDays = Array.isArray(input.trainingDays) ? input.trainingDays.map(day => boundedText(day, 12)).filter(Boolean).slice(0, 7) : [];
    if (!name) return Response.json({ error: "name_required" }, { status: 400 });
    if (!initials || !distance || !phase || !week) return Response.json({ error: "required_fields" }, { status: 400 });
    const jaExiste = await env.DB.prepare("SELECT name FROM athletes WHERE name = ? LIMIT 1").bind(name).first();
    if (jaExiste) return Response.json({ error: "athlete_name_taken", message: "Já existe um aluno com este nome. Use o nome completo para diferenciar." }, { status: 409 });
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    // O aluno nasce na carteira de quem o cadastrou. Se a manutenção cadastra
    // sem estar visitando ninguém, o aluno fica sem dono e aparece para todos.
    await env.DB.prepare(`INSERT INTO athletes
      (id, name, initials, distance, phase, week, next_workout, status, phone, email, training_days, integration, created_at, coach_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, name, initials, distance, phase, week, nextWorkout, boundedText(input.status, 120) || null, boundedText(input.phone, 30) || null, boundedText(input.email, 254).toLowerCase() || null, JSON.stringify(trainingDays), boundedText(input.integration, 40) || null, createdAt, carteiraDe(request))
      .run();
    return Response.json({ id, createdAt }, { status: 201 });
  }
  return new Response("Method not allowed", { status: 405 });
}

async function athleteProfileApi(request: Request, env: Env): Promise<Response> {
  await ensureTables(env, schema.athleteProfiles);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const athleteName = boundedText(url.searchParams.get("athlete"), 120);
    if (!athleteName) return Response.json({ error: "athlete_required" }, { status: 400 });
    const profile = await env.DB.prepare("SELECT * FROM athlete_profiles WHERE athlete_name = ? LIMIT 1").bind(athleteName).first();
    return Response.json({ profile: profile ?? null });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const athleteName = boundedText(input.athleteName, 120);
    const trainingDays = Array.isArray(input.trainingDays) ? input.trainingDays.map(day => boundedText(day, 12)).filter(Boolean).slice(0, 7) : [];
    const birthDate = boundedText(input.birthDate, 10);
    if (!athleteName) return Response.json({ error: "athlete_required" }, { status: 400 });
    if (birthDate && !isIsoDate(birthDate)) return Response.json({ error: "invalid_birth_date" }, { status: 400 });
    const updatedAt = Date.now();
    await env.DB.prepare(`INSERT INTO athlete_profiles (athlete_name,phone,birth_date,objective,integration,training_days,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(athlete_name) DO UPDATE SET phone=excluded.phone,birth_date=excluded.birth_date,objective=excluded.objective,integration=excluded.integration,training_days=excluded.training_days,updated_at=excluded.updated_at`)
      .bind(athleteName,boundedText(input.phone,30)||null,birthDate||null,boundedText(input.objective,120)||null,boundedText(input.integration,40)||null,JSON.stringify(trainingDays),updatedAt).run();
    return Response.json({ saved: true, updatedAt });
  }
  return new Response("Method not allowed", { status: 405 });
}

async function athletePlanningApi(request:Request,env:Env):Promise<Response>{
  await ensureTables(env, schema.athletePlanning);
  const url=new URL(request.url);
  if(request.method==="GET"){
    const athleteName=boundedText(url.searchParams.get("athlete"),120);
    if(!athleteName)return Response.json({error:"athlete_required"},{status:400});
    const planning=await env.DB.prepare("SELECT * FROM athlete_planning WHERE athlete_name = ? LIMIT 1").bind(athleteName).first();
    return Response.json({planning:planning??null});
  }
  if(request.method==="POST"){
    const input=await request.json() as Record<string,unknown>;
    const athleteName=boundedText(input.athleteName,120);const plan=boundedText(input.plan,80);const phase=boundedText(input.phase,40);const weekNumber=Number(input.weekNumber);const totalWeeks=Number(input.totalWeeks);
    const allowedPhases=["Adaptação","Base","Desenvolvimento","Específica","Pré-prova"];const allowedPlans=["Iniciantes","5 km Bronze","5 km Prata","5 km Ouro","5 km Elite","10 km Lion","Meia Start","Meia Finish","One Marathon","Full Marathon"];
    if(!athleteName||!allowedPlans.includes(plan)||!allowedPhases.includes(phase)||!Number.isInteger(totalWeeks)||totalWeeks<1||totalWeeks>60||!Number.isInteger(weekNumber)||weekNumber<1||weekNumber>totalWeeks)return Response.json({error:"invalid_planning"},{status:400});
    const updatedAt=Date.now();
    await env.DB.prepare("INSERT INTO athlete_planning (athlete_name,plan,phase,week_number,total_weeks,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(athlete_name) DO UPDATE SET plan=excluded.plan,phase=excluded.phase,week_number=excluded.week_number,total_weeks=excluded.total_weeks,updated_at=excluded.updated_at").bind(athleteName,plan,phase,weekNumber,totalWeeks,updatedAt).run();
    return Response.json({saved:true,athleteName,plan,phase,weekNumber,totalWeeks,updatedAt});
  }
  return new Response("Method not allowed",{status:405});
}

async function planTemplateOverridesApi(request:Request,env:Env):Promise<Response>{
  await ensureTables(env, schema.planTemplateOverrides);
  const allowedPlans=["Iniciantes","5 km Bronze","5 km Prata","5 km Ouro","5 km Elite","10 km Lion","Meia Start","Meia Finish","One Marathon","Full Marathon"];
  const url=new URL(request.url);
  if(request.method==="GET"){
    const plan=boundedText(url.searchParams.get("plan"),80);const weekNumber=Number(url.searchParams.get("week"));
    if(!allowedPlans.includes(plan)||!Number.isInteger(weekNumber)||weekNumber<1||weekNumber>60)return Response.json({error:"invalid_plan_week"},{status:400});
    const row=await env.DB.prepare("SELECT sessions_json,updated_by,updated_at FROM plan_template_overrides WHERE plan_name=? AND week_number=? LIMIT 1").bind(plan,weekNumber).first<Record<string,unknown>>();
    if(!row)return Response.json({override:null});
    try{return Response.json({override:{sessions:JSON.parse(String(row.sessions_json)),updatedBy:row.updated_by,updatedAt:row.updated_at}})}catch{return Response.json({error:"invalid_saved_template"},{status:500})}
  }
  if(request.method==="POST"){
    const input=await request.json() as Record<string,unknown>;const plan=boundedText(input.plan,80);const weekNumber=Number(input.weekNumber);const sessions=input.sessions;
    if(!allowedPlans.includes(plan)||!Number.isInteger(weekNumber)||weekNumber<1||weekNumber>60||!Array.isArray(sessions)||sessions.length<1||sessions.length>10||!validStructuredValue(sessions))return Response.json({error:"invalid_template"},{status:400});
    const sessionsJson=JSON.stringify(sessions);if(sessionsJson.length>200_000)return Response.json({error:"template_too_large"},{status:413});
    const updatedAt=Date.now();const updatedBy=normalizedAuthenticatedEmail(request) ?? "sistema";const id=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO plan_template_overrides (id,plan_name,week_number,sessions_json,updated_by,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(plan_name,week_number) DO UPDATE SET sessions_json=excluded.sessions_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(id,plan,weekNumber,sessionsJson,updatedBy,updatedAt).run();
    return Response.json({saved:true,updatedAt});
  }
  return new Response("Method not allowed",{status:405});
}

async function performanceTestsApi(request: Request, env: Env): Promise<Response> {
  await ensureTables(env, schema.performanceTests);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const athleteName = boundedText(url.searchParams.get("athlete"), 120);
    if (!athleteName) {
      const result = await env.DB.prepare("SELECT id, athlete_name, test_date, distance_km, total_seconds, status, created_at FROM performance_tests WHERE status != 'Aprovado' ORDER BY created_at DESC LIMIT 100").all();
      return Response.json({ tests:result.results });
    }
    const result = await env.DB.prepare("SELECT * FROM performance_tests WHERE athlete_name = ? ORDER BY test_date DESC, created_at DESC LIMIT 20").bind(athleteName).all();
    return Response.json({ tests:result.results });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string,unknown>;
    const action = boundedText(input.action,20);
    if (action === "review" || action === "approve") {
      const id = boundedText(input.id,80);
      const zones = Array.isArray(input.zones) ? input.zones : [];
      const tempoRuns = Array.isArray(input.tempoRuns) ? input.tempoRuns : [];
      if (!id || zones.length !== 5 || tempoRuns.length !== 4) return Response.json({error:"invalid_review"},{status:400});
      const normalizedZones = zones.map((zone:any,index)=>({z:`Z${index+1}`,label:boundedText(zone?.label,40),slow:Number(zone?.slow),fast:Number(zone?.fast)}));
      const normalizedTempoRuns = tempoRuns.map((tempo:any)=>({label:boundedText(tempo?.label,30),targetPace:Number(tempo?.targetPace),projectedTotal:Number(tempo?.projectedTotal)}));
      if (normalizedZones.some(zone=>!Number.isFinite(zone.slow)||!Number.isFinite(zone.fast)||zone.slow<120||zone.slow>1200||zone.fast<120||zone.fast>1200||zone.fast>zone.slow) || normalizedTempoRuns.some(tempo=>!tempo.label||!Number.isFinite(tempo.targetPace)||tempo.targetPace<120||tempo.targetPace>1200)) return Response.json({error:"invalid_paces"},{status:400});
      const status = action === "approve" ? "Aprovado" : "Rascunho revisado";
      await env.DB.prepare("UPDATE performance_tests SET zones = ?, tempo_runs = ?, status = ? WHERE id = ?").bind(JSON.stringify(normalizedZones),JSON.stringify(normalizedTempoRuns),status,id).run();
      return Response.json({id,status,zones:normalizedZones,tempoRuns:normalizedTempoRuns});
    }
    const athleteName = boundedText(input.athleteName,120);
    const testDate = boundedText(input.testDate,10);
    const distanceKm = Number(input.distanceKm);
    const minutes = Number(input.minutes);
    const seconds = Number(input.seconds);
    const age = Number(input.age);
    if (!athleteName || !isIsoDate(testDate)) return Response.json({error:"athlete_and_date_required"},{status:400});
    if (![3,5].includes(distanceKm) || !Number.isInteger(minutes) || minutes < 5 || minutes > 90 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59 || !Number.isInteger(age) || age < 10 || age > 90) return Response.json({error:"invalid_test_result"},{status:400});
    const totalSeconds = minutes*60+seconds;
    const vam = distanceKm/(totalSeconds/3600);
    const vo2 = vam*3.5;
    const paceSeconds = totalSeconds/distanceKm;
    const fcMax = 220-age;
    const zones = [["Z1","Recuperação",.60,.70],["Z2","Aeróbio",.70,.80],["Z3","Tempo Run",.80,.90],["Z4","Limiar",.90,1],["Z5","VO₂ máximo",1,1.10]].map(([z,label,low,high])=>({z,label,slow:paceSeconds/Number(low),fast:paceSeconds/Number(high)}));
    const tempoRuns = [["5 km",5],["10 km",10],["Meia maratona",21.0975],["Maratona",42.195]].map(([label,km])=>{const targetKm=Number(km);const projectedTotal=totalSeconds*Math.pow(targetKm/distanceKm,1.06);return{label,projectedTotal,targetPace:projectedTotal/targetKm}});
    const id=crypto.randomUUID(); const createdAt=Date.now();
    await env.DB.prepare("INSERT INTO performance_tests (id,athlete_name,test_date,distance_km,total_seconds,age,vam,vo2,fc_max,pace_seconds,zones,tempo_runs,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,athleteName,testDate,distanceKm,totalSeconds,age,String(vam),String(vo2),fcMax,String(paceSeconds),JSON.stringify(zones),JSON.stringify(tempoRuns),"Aguardando revisão",createdAt).run();
    return Response.json({id,createdAt,status:"Aguardando revisão",vam,vo2,fcMax,paceSeconds,zones,tempoRuns},{status:201});
  }
  return new Response("Method not allowed",{status:405});
}

async function trainingWeeksApi(request: Request, env: Env): Promise<Response> {
  await ensureTables(env, schema.trainingWeeks, schema.trainingWeekAudit);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const athlete = url.searchParams.get("athlete");
    const weekStart = url.searchParams.get("weekStart");
    if (athlete && weekStart) {
      const [row, history] = await Promise.all([
        env.DB.prepare("SELECT * FROM training_weeks WHERE athlete_name = ? AND week_start = ? LIMIT 1").bind(athlete, weekStart).first(),
        env.DB.prepare("SELECT id, actor_email, action, changed_fields, created_at FROM training_week_audit WHERE athlete_name = ? AND week_start = ? ORDER BY created_at DESC LIMIT 20").bind(athlete, weekStart).all(),
      ]);
      return Response.json({ week: row ?? null, history: history.results });
    }
    if (weekStart) {
      if (!isIsoDate(weekStart)) return Response.json({ error: "invalid_week_start" }, { status: 400 });
      const result = await env.DB.prepare("SELECT athlete_name, week_start, status, updated_at FROM training_weeks WHERE week_start = ? ORDER BY updated_at DESC").bind(weekStart).all();
      return Response.json({ weeks: result.results });
    }
    // Só o atleta, sem semana: antes este caso caía no SELECT sem filtro abaixo
    // e devolvia as semanas de todos os alunos. Quem consultasse pelo primeiro
    // resultado acabaria lendo — ou sobrescrevendo — o treino de outra pessoa.
    if (athlete) {
      const result = await env.DB.prepare("SELECT * FROM training_weeks WHERE athlete_name = ? ORDER BY week_start DESC").bind(athlete).all();
      return Response.json({ weeks: result.results });
    }
    const result = await env.DB.prepare("SELECT * FROM training_weeks ORDER BY updated_at DESC").all();
    return Response.json({ weeks: result.results });
  }
  if (request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const athleteName = boundedText(input.athleteName, 120);
    const weekStart = boundedText(input.weekStart, 10);
    if (!athleteName || !weekStart) return Response.json({ error: "athlete_and_week_required" }, { status: 400 });
    if (!isIsoDate(weekStart)) return Response.json({ error: "invalid_week_start" }, { status: 400 });
    const expectedUpdatedAt = Number(input.expectedUpdatedAt ?? 0);
    if (expectedUpdatedAt) {
      const stored = await env.DB.prepare("SELECT updated_at FROM training_weeks WHERE athlete_name = ? AND week_start = ? LIMIT 1").bind(athleteName, weekStart).first() as { updated_at?: number } | null;
      if (stored?.updated_at && Number(stored.updated_at) !== expectedUpdatedAt) return Response.json({ error: "week_changed", message: "A semana foi alterada em outra tela. Atualize antes de salvar novamente." }, { status: 409 });
    }
    const trainingDays = Array.isArray(input.trainingDays) ? input.trainingDays.map(day => boundedText(day, 12)).filter(Boolean).slice(0, 7) : [];
    if (!input.sessions || Array.isArray(input.sessions) || typeof input.sessions !== "object") return Response.json({ error: "invalid_sessions" }, { status: 400 });
    if (boundedText(input.status ?? "Rascunho", 30) === "Liberada") {
      const sessions = input.sessions as Record<string, unknown>;
      const incompleteDays = trainingDays.filter(day => {
        const session = sessions[day];
        if (!session || Array.isArray(session) || typeof session !== "object") return true;
        const workout = session as Record<string, unknown>;
        return workout.removed === true || !Array.isArray(workout.steps) || workout.steps.length === 0;
      });
      if (incompleteDays.length) return Response.json({ error: "incomplete_structured_workouts", days: incompleteDays }, { status: 400 });
    }
    const existingWeek = await env.DB.prepare("SELECT * FROM training_weeks WHERE athlete_name = ? AND week_start = ? LIMIT 1").bind(athleteName, weekStart).first() as Record<string, unknown> | null;
    const id = crypto.randomUUID();
    const updatedAt = Date.now();
    const normalizedWeek = {athlete_name:athleteName,week_start:weekStart,plan:boundedText(input.plan,80),phase:boundedText(input.phase,40),week_label:boundedText(input.weekLabel,40),training_days:JSON.stringify(trainingDays),sessions:JSON.stringify(input.sessions),status:boundedText(input.status ?? "Rascunho",30),updated_at:updatedAt};
    const trackedFields = ["plan","phase","week_label","training_days","sessions","status"];
    const baseComparison = Array.isArray(input.auditDifferences) ? input.auditDifferences.map(item => boundedText(item, 40)).filter(Boolean).slice(0, 7) : [];
    const changedFields = [...(existingWeek ? trackedFields.filter(field => String(existingWeek[field] ?? "") !== String(normalizedWeek[field as keyof typeof normalizedWeek] ?? "")) : trackedFields),...baseComparison.map(item=>`base:${item}`)];
    const changedFromBase=baseComparison.filter(item=>!item.endsWith(":IGUAL À BASE")).length;
    const action = !existingWeek ? "Semana criada" : normalizedWeek.status === "Liberada" && existingWeek.status !== "Liberada" ? `Semana liberada · ${changedFromBase} alteração(ões) da base` : normalizedWeek.status === "Trancada" ? "Semana trancada" : "Semana atualizada";
    const actorEmail = normalizedAuthenticatedEmail(request) || "preview@zonasapp.local";
    await env.DB.batch([env.DB.prepare(`INSERT INTO training_weeks
      (id, athlete_name, week_start, plan, phase, week_label, training_days, sessions, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(athlete_name, week_start) DO UPDATE SET
        plan=excluded.plan, phase=excluded.phase, week_label=excluded.week_label,
        training_days=excluded.training_days, sessions=excluded.sessions,
        status=excluded.status, updated_at=excluded.updated_at`)
      .bind(id, athleteName, weekStart, normalizedWeek.plan, normalizedWeek.phase, normalizedWeek.week_label, normalizedWeek.training_days, normalizedWeek.sessions, normalizedWeek.status, updatedAt),
      env.DB.prepare("INSERT INTO training_week_audit (id, athlete_name, week_start, actor_email, action, changed_fields, previous_snapshot, new_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), athleteName, weekStart, actorEmail, action, JSON.stringify(changedFields), existingWeek ? JSON.stringify(existingWeek) : null, JSON.stringify(normalizedWeek), updatedAt),
    ]);
    return Response.json({ id, updatedAt, status: input.status ?? "Rascunho" }, { status: 201 });
  }
  return new Response("Method not allowed", { status: 405 });
}

/** Histórico de cada movimento de um relato de dor. */

async function ensurePainReports(env: Env) {
  await ensureTables(env, schema.painReports, schema.painReportUpdates);
}

/** Estados pelos quais um relato caminha, do aviso do aluno até a alta. */
const PAIN_STATUSES = ["Novo", "Em análise", "Verificado", "Resolvido"] as const;

async function registraMovimentoDor(env: Env, reportId: string, actor: string, action: string, note: string | null) {
  await env.DB.prepare(
    "INSERT INTO pain_report_updates (id, report_id, actor_email, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), reportId, actor, action, note, Date.now()).run();
}

async function painReportsApi(request: Request, env: Env): Promise<Response> {
  await ensurePainReports(env);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const reportId = boundedText(url.searchParams.get("id"), 60);
    if (reportId) {
      const [relato, historico] = await Promise.all([
        env.DB.prepare("SELECT * FROM pain_reports WHERE id = ? LIMIT 1").bind(reportId).first(),
        env.DB.prepare("SELECT id, actor_email, action, note, created_at FROM pain_report_updates WHERE report_id = ? ORDER BY created_at DESC").bind(reportId).all(),
      ]);
      if (!relato) return Response.json({ error: "report_not_found" }, { status: 404 });
      return Response.json({ report: relato, history: historico.results });
    }
    const athlete = boundedText(url.searchParams.get("athlete"), 120);
    const result = athlete
      ? await env.DB.prepare("SELECT * FROM pain_reports WHERE athlete_name = ? ORDER BY created_at DESC LIMIT 50").bind(athlete).all()
      : await env.DB.prepare("SELECT * FROM pain_reports ORDER BY created_at DESC LIMIT 50").all();
    return Response.json({ reports: result.results, statuses: PAIN_STATUSES });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const acao = boundedText(input.action, 20);
  const actor = normalizedAuthenticatedEmail(request) ?? "sistema";

  // Sem ação, é o registro de um novo relato, como sempre foi.
  if (!acao) {
    const athleteName = boundedText(input.athleteName, 120);
    const bodyArea = boundedText(input.bodyArea, 80);
    const rawIntensity = Number(input.intensity ?? 0);
    const intensity = Math.min(10, Math.max(1, rawIntensity));
    const trainingImpact = boundedText(input.trainingImpact, 120);
    if (!athleteName || !bodyArea || !trainingImpact) return Response.json({ error: "required_fields" }, { status: 400 });
    if (!Number.isInteger(rawIntensity) || rawIntensity < 1 || rawIntensity > 10) return Response.json({ error: "invalid_intensity" }, { status: 400 });
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    await env.DB.prepare(`INSERT INTO pain_reports
      (id, athlete_name, body_area, intensity, training_impact, note, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, athleteName, bodyArea, intensity, trainingImpact, boundedText(input.note, 1000) || null, "Novo", createdAt)
      .run();
    await registraMovimentoDor(env, id, actor, "Relato recebido", `${bodyArea} · intensidade ${intensity}/10 · ${trainingImpact}`);
    return Response.json({ id, createdAt, status: "Novo" }, { status: 201 });
  }

  const reportId = boundedText(input.id, 60);
  if (!reportId) return Response.json({ error: "report_required" }, { status: 400 });
  const existente = await env.DB.prepare("SELECT id, athlete_name, status, reviewed_at FROM pain_reports WHERE id = ? LIMIT 1").bind(reportId).first() as { id?: string; athlete_name?: string; status?: string; reviewed_at?: number | null } | null;
  if (!existente?.id) return Response.json({ error: "report_not_found" }, { status: 404 });
  const note = boundedText(input.note, 1000);
  const agora = Date.now();

  // Mudar a situação e contar o que aconteceu é um gesto só: o treinador
  // escolhe o estado do caso e escreve o relato daquele momento.
  if (acao === "update") {
    const novoStatus = boundedText(input.status, 30);
    if (!PAIN_STATUSES.includes(novoStatus as typeof PAIN_STATUSES[number])) {
      return Response.json({ error: "invalid_status", allowed: PAIN_STATUSES }, { status: 400 });
    }
    if (!note && novoStatus === existente.status) {
      return Response.json({ error: "nothing_to_record" }, { status: 400 });
    }
    const campos: string[] = ["status = ?"];
    const valores: unknown[] = [novoStatus];
    // Cada situação carimba a sua própria data, para o histórico ficar completo.
    if (novoStatus === "Verificado" && !existente.reviewed_at) { campos.push("reviewed_by = ?", "reviewed_at = ?"); valores.push(actor, agora); }
    if (novoStatus === "Resolvido") { campos.push("resolved_at = ?"); valores.push(agora); }
    if (novoStatus !== "Resolvido") { campos.push("resolved_at = NULL"); }
    if (note) {
      // O relato do encerramento é o desfecho; nos demais estados é a avaliação.
      campos.push(novoStatus === "Resolvido" ? "resolution = ?" : "coach_note = ?");
      valores.push(note);
    }
    await env.DB.prepare(`UPDATE pain_reports SET ${campos.join(", ")} WHERE id = ?`).bind(...valores, reportId).run();
    await registraMovimentoDor(env, reportId, actor, `Situação: ${novoStatus}`, note || null);
    return Response.json({ status: novoStatus, updatedAt: agora });
  }

  if (acao === "review") {
    await env.DB.prepare("UPDATE pain_reports SET status = 'Verificado', reviewed_by = ?, reviewed_at = ?, coach_note = COALESCE(?, coach_note) WHERE id = ?")
      .bind(actor, agora, note || null, reportId).run();
    await registraMovimentoDor(env, reportId, actor, "Verificado pelo treinador", note || null);
    return Response.json({ status: "Verificado", reviewedAt: agora });
  }

  if (acao === "contact") {
    await env.DB.prepare("UPDATE pain_reports SET status = CASE WHEN status = 'Novo' THEN 'Em análise' ELSE status END, contacted_at = ? WHERE id = ?")
      .bind(agora, reportId).run();
    await registraMovimentoDor(env, reportId, actor, "Contato com o atleta", note || null);
    const atualizado = await env.DB.prepare("SELECT status FROM pain_reports WHERE id = ? LIMIT 1").bind(reportId).first() as { status?: string } | null;
    return Response.json({ status: atualizado?.status ?? existente.status, contactedAt: agora });
  }

  // Liga o relato à semana de treino que foi ajustada por causa dele: é o que
  // permite, meses depois, saber o que mudou no plano e por quê.
  if (acao === "link_week") {
    const weekStart = boundedText(input.weekStart, 10);
    if (!isIsoDate(weekStart)) return Response.json({ error: "invalid_week_start" }, { status: 400 });
    const semana = await env.DB.prepare("SELECT week_start FROM training_weeks WHERE athlete_name = ? AND week_start = ? LIMIT 1")
      .bind(existente.athlete_name, weekStart).first();
    if (!semana) return Response.json({ error: "week_not_found_for_athlete" }, { status: 404 });
    await env.DB.prepare("UPDATE pain_reports SET linked_week_start = ? WHERE id = ?").bind(weekStart, reportId).run();
    await registraMovimentoDor(env, reportId, actor, "Ajuste na planilha", `Semana de ${weekStart}${note ? ` · ${note}` : ""}`);
    return Response.json({ linkedWeekStart: weekStart });
  }

  if (acao === "resolve") {
    if (!note) return Response.json({ error: "resolution_required" }, { status: 400 });
    await env.DB.prepare("UPDATE pain_reports SET status = 'Resolvido', resolution = ?, resolved_at = ? WHERE id = ?")
      .bind(note, agora, reportId).run();
    await registraMovimentoDor(env, reportId, actor, "Resolvido", note);
    return Response.json({ status: "Resolvido", resolvedAt: agora });
  }

  if (acao === "reopen") {
    await env.DB.prepare("UPDATE pain_reports SET status = 'Em análise', resolved_at = NULL WHERE id = ?").bind(reportId).run();
    await registraMovimentoDor(env, reportId, actor, "Reaberto", note || null);
    return Response.json({ status: "Em análise" });
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
}

async function ensureTrainingFeedbacks(env: Env) {
  await ensureTables(env, schema.trainingFeedbacks);
}

async function studentFeedbacksApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  await ensureTrainingFeedbacks(env);
  // O aluno escrevia e nunca mais via: sem leitura, ele não tem como saber o
  // que já contou ao treinador nem se aquilo foi lido.
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, week_start, workout_day, feeling, note, status, created_at, reviewed_at FROM training_feedbacks WHERE athlete_name = ? ORDER BY created_at DESC LIMIT 30",
    ).bind(athleteName).all();
    return Response.json({ feedbacks: result.results });
  }
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  const input=await request.json() as Record<string,unknown>;
  const feeling=boundedText(input.feeling,30);const note=boundedText(input.note,500);const weekStart=boundedText(input.weekStart,10);const workoutDay=boundedText(input.workoutDay,12);
  if(!["Muito bem","Cansado","Sentiu dor"].includes(feeling))return Response.json({error:"invalid_feeling"},{status:400});
  if(weekStart&&!isIsoDate(weekStart))return Response.json({error:"invalid_week_start"},{status:400});
  const id=crypto.randomUUID();const now=Date.now();
  await env.DB.prepare("INSERT INTO training_feedbacks (id,athlete_name,week_start,workout_day,feeling,note,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?,?, ?,NULL)").bind(id,athleteName,weekStart||null,workoutDay||null,feeling,note||null,"Novo",now).run();
  return Response.json({id,status:"Novo",createdAt:now},{status:201});
}

async function feedbacksApi(request: Request, env: Env): Promise<Response> {
  await ensureTrainingFeedbacks(env);
  if(request.method==="GET"){
    const result=await env.DB.prepare("SELECT * FROM training_feedbacks ORDER BY CASE status WHEN 'Novo' THEN 0 ELSE 1 END, created_at DESC LIMIT 100").all();
    return Response.json({feedbacks:result.results});
  }
  if(request.method==="POST"){
    const input=await request.json() as Record<string,unknown>;const id=boundedText(input.id,80);const status=boundedText(input.status,20);
    if(!id||status!=="Revisado")return Response.json({error:"invalid_review"},{status:400});
    const result=await env.DB.prepare("UPDATE training_feedbacks SET status='Revisado', reviewed_at=? WHERE id=? AND status='Novo'").bind(Date.now(),id).run();
    return Response.json({id,status:"Revisado",updated:result.success!==false});
  }
  return new Response("Method not allowed",{status:405});
}

/**
 * Acrescenta colunas que faltam a uma tabela já existente.
 *
 * O esquema é garantido em runtime por `CREATE TABLE IF NOT EXISTS`, que não
 * altera uma tabela que já existe. Sem isto, um banco em uso continuaria com o
 * formato antigo depois de uma atualização. Só adiciona, nunca remove nem
 * reescreve — os registros gravados permanecem intactos.
 */
async function ensureColumns(env: Env, table: string, columns: Record<string, string>): Promise<void> {
  const consulta = env.DB.prepare(`PRAGMA table_info(${table})`);
  // Bancos que não expõem PRAGMA (os dublês dos testes) não têm o que reparar.
  if (typeof consulta.all !== "function") return;
  const info = await consulta.all();
  const existentes = new Set((info.results as Array<{ name?: string }>).map(row => String(row.name)));
  const faltando = Object.entries(columns).filter(([nome]) => !existentes.has(nome));
  if (!faltando.length) return;
  await env.DB.batch(faltando.map(([nome, tipo]) =>
    env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${nome} ${tipo}`)));
}

async function ensureWorkoutExecutions(env: Env) {
  await ensureTables(env, schema.workoutExecutions);
}

function workoutAccuracy(plannedMinutes: number | null, plannedKm: number | null, actualMinutes: number | null, actualKm: number | null) {
  const scores: number[] = [];
  if (plannedMinutes && actualMinutes !== null) scores.push(Math.max(0, 100 - Math.abs(actualMinutes - plannedMinutes) / plannedMinutes * 100));
  if (plannedKm && actualKm !== null) scores.push(Math.max(0, 100 - Math.abs(actualKm - plannedKm) / plannedKm * 100));
  const correct = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  return { correct, wrong: 100 - correct, classification: correct >= 80 ? "Dentro do planejado" : correct >= 60 ? "Parcialmente correto" : "Fora do planejado" };
}

async function studentWorkoutExecutionsApi(request: Request, env: Env, athleteName: string): Promise<Response> {
  await ensureWorkoutExecutions(env);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const dias = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
    const desde = Date.now() - dias * 86_400_000;
    const result = await env.DB.prepare(
      "SELECT * FROM workout_executions WHERE athlete_name = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 30",
    ).bind(athleteName, desde).all();
    return Response.json({ executions: result.results, days: dias });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const weekStart = boundedText(input.weekStart, 10); const workoutDay = boundedText(input.workoutDay, 12);
  const acao = boundedText(input.action, 20) || "complete";
  const note = boundedText(input.note, 400);
  if (!isIsoDate(weekStart) || !workoutDay) return Response.json({ error: "workout_reference_required" }, { status: 400 });

  const week = await env.DB.prepare("SELECT sessions FROM training_weeks WHERE athlete_name = ? AND week_start = ? AND status = 'Liberada' LIMIT 1").bind(athleteName, weekStart).first() as {sessions?:string}|null;
  if (!week?.sessions) return Response.json({ error: "released_workout_not_found" }, { status: 404 });
  let session: Record<string, unknown> | undefined;
  try { session = (JSON.parse(week.sessions) as Record<string, Record<string, unknown>>)[workoutDay]; } catch { return Response.json({ error: "invalid_workout_plan" }, { status: 409 }); }
  if (!session || session.removed) return Response.json({ error: "planned_session_not_found" }, { status: 404 });

  const plannedMinutesValue = Number(session.durationMinutes); const plannedKmValue = Number(session.estimatedKm);
  const plannedMinutes = Number.isFinite(plannedMinutesValue) && plannedMinutesValue > 0 ? plannedMinutesValue : null;
  const plannedKm = Number.isFinite(plannedKmValue) && plannedKmValue > 0 ? plannedKmValue : null;
  const now = Date.now();

  // Um treino não realizado é informação tão útil quanto um concluído: o
  // treinador precisa saber o que não aconteceu para ajustar a semana.
  if (acao === "skip") {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO workout_executions
      (id,athlete_name,week_start,workout_day,planned_minutes,planned_km,actual_minutes,actual_km,correct_percentage,wrong_percentage,classification,source,created_at,status,note,average_heart_rate,average_pace_seconds,external_activity_id)
      VALUES (?,?,?,?,?,?,NULL,NULL,0,100,'Não realizado','Manual',?,'Não realizado',?,NULL,NULL,NULL)`)
      .bind(id, athleteName, weekStart, workoutDay, plannedMinutes, plannedKm === null ? null : String(plannedKm), now, note || null).run();
    return Response.json({ id, status: "Não realizado", classification: "Não realizado", correct: 0, wrong: 100, plannedMinutes, plannedKm, note: note || null, source: "Manual", createdAt: now }, { status: 201 });
  }

  let actualMinutes = Number(input.actualMinutes);
  let actualKm = Number(input.actualKm);
  let heartRate: number | null = null;
  let paceSeconds: number | null = null;
  let externalId: string | null = null;
  let source = "Manual";

  // Quando o atleta tem integração conectada, a atividade importada daquele dia
  // preenche o que ele não digitou — e traz ritmo e frequência cardíaca, que o
  // formulário manual não tem como capturar.
  await ensureIntegrationTables(env);
  const importada = await env.DB.prepare(
    `SELECT external_activity_id, provider, distance_meters, moving_seconds, average_heart_rate, average_pace_seconds
       FROM external_activities
      WHERE athlete_name = ? AND matched_week_start = ? AND matched_workout_day = ?
      ORDER BY started_at DESC LIMIT 1`,
  ).bind(athleteName, weekStart, workoutDay).first() as {
    external_activity_id?: string; provider?: string; distance_meters?: number;
    moving_seconds?: number; average_heart_rate?: number; average_pace_seconds?: number;
  } | null;

  if (importada) {
    externalId = importada.external_activity_id ?? null;
    heartRate = importada.average_heart_rate ?? null;
    paceSeconds = importada.average_pace_seconds ?? null;
    source = importada.provider ?? "Integração";
    if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) {
      actualMinutes = Number(importada.moving_seconds ?? 0) / 60;
    }
    if (!Number.isFinite(actualKm) || actualKm <= 0) {
      actualKm = Number(importada.distance_meters ?? 0) / 1000;
    }
  }

  const safeActualMinutes = Number.isFinite(actualMinutes) && actualMinutes > 0 && actualMinutes <= 1440 ? Math.round(actualMinutes) : null;
  const safeActualKm = Number.isFinite(actualKm) && actualKm > 0 && actualKm <= 500 ? Math.round(actualKm * 100) / 100 : null;

  // Concluir sem número continua valendo: registra a conclusão e deixa claro
  // que não houve como medir, em vez de recusar o registro por completo.
  const temMedida = (plannedMinutes && safeActualMinutes !== null) || (plannedKm && safeActualKm !== null);
  const analysis = temMedida
    ? workoutAccuracy(plannedMinutes, plannedKm, safeActualMinutes, safeActualKm)
    : { correct: 0, wrong: 0, classification: "Concluído sem medição" };

  if (safeActualMinutes !== null && safeActualKm !== null && paceSeconds === null) {
    paceSeconds = Math.round((safeActualMinutes * 60) / safeActualKm);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO workout_executions
    (id,athlete_name,week_start,workout_day,planned_minutes,planned_km,actual_minutes,actual_km,correct_percentage,wrong_percentage,classification,source,created_at,status,note,average_heart_rate,average_pace_seconds,external_activity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Concluído',?,?,?,?)`)
    .bind(id, athleteName, weekStart, workoutDay, plannedMinutes, plannedKm === null ? null : String(plannedKm),
          safeActualMinutes, safeActualKm === null ? null : String(safeActualKm),
          analysis.correct, analysis.wrong, analysis.classification, source, now,
          note || null, heartRate, paceSeconds, externalId).run();

  return Response.json({
    id, status: "Concluído", ...analysis, measured: Boolean(temMedida),
    plannedMinutes, plannedKm, actualMinutes: safeActualMinutes, actualKm: safeActualKm,
    averageHeartRate: heartRate, averagePaceSeconds: paceSeconds,
    source, fromIntegration: Boolean(importada), note: note || null, createdAt: now,
  }, { status: 201 });
}

async function workoutExecutionsApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureWorkoutExecutions(env);
  const result = await env.DB.prepare("SELECT * FROM workout_executions ORDER BY created_at DESC LIMIT 100").all();
  return Response.json({ executions: result.results });
}

async function integrationOverviewApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTables(env, schema.athletes, schema.athleteProfiles, schema.athleteAccess, schema.workoutExecutions);
  const result = await env.DB.prepare(`SELECT athletes.name AS athlete_name,
    COALESCE(athlete_profiles.integration, athletes.integration, 'Sem integração') AS integration,
    COALESCE(athlete_access.status, 'Não liberado') AS access_status,
    (SELECT source FROM workout_executions WHERE workout_executions.athlete_name = athletes.name ORDER BY created_at DESC LIMIT 1) AS last_source,
    (SELECT created_at FROM workout_executions WHERE workout_executions.athlete_name = athletes.name ORDER BY created_at DESC LIMIT 1) AS last_import_at
    FROM athletes
    LEFT JOIN athlete_profiles ON athlete_profiles.athlete_name = athletes.name
    LEFT JOIN athlete_access ON athlete_access.athlete_name = athletes.name
    ORDER BY athletes.name ASC`).all();
  const integrations = result.results.map((row:any) => ({...row, connection_status: row.integration === "Sem integração" ? "Sem integração" : row.last_source && row.last_source !== "Manual" ? "Sincronizado" : "Aguardando conexão oficial"}));
  return Response.json({ integrations });
}

async function integrationReadinessApi(request:Request,env:Env):Promise<Response>{
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const garminCredentials=Boolean(env.GARMIN_CONSUMER_KEY&&env.GARMIN_CONSUMER_SECRET);
  const zeppCredentials=Boolean(env.ZEPP_APP_ID&&env.ZEPP_APP_SECRET&&env.ZEPP_WEBHOOK_SECRET);
  return Response.json({providers:[
    {id:"garmin",name:"Garmin",credentialsConfigured:garminCredentials,receiveActivities:garminCredentials&&env.GARMIN_ACTIVITY_API_ENABLED==="true",sendStructuredWorkouts:garminCredentials&&env.GARMIN_TRAINING_API_ENABLED==="true",status:!garminCredentials?"Cadastro oficial necessário":env.GARMIN_ACTIVITY_API_ENABLED==="true"&&env.GARMIN_TRAINING_API_ENABLED==="true"?"Pronta para testes":"Aguardando liberação das APIs"},
    {id:"amazfit",name:"Amazfit / Zepp",credentialsConfigured:zeppCredentials,receiveActivities:false,sendStructuredWorkouts:false,status:!zeppCredentials?"Cadastro oficial necessário":"Aplicativo Zepp em preparação"}
  ]});
}

const currentReferenceMonth = () => new Date().toISOString().slice(0, 7);

async function ensureFinancial(env: Env) {
  await ensureTables(env, schema.financialSettings, schema.studentPayments);
}

async function financialApi(request:Request,env:Env):Promise<Response>{
  await ensureFinancial(env);const url=new URL(request.url);const month=boundedText(url.searchParams.get("month"),7)||currentReferenceMonth();
  if(request.method==="GET"){
    const [settings,payments]=await Promise.all([env.DB.prepare("SELECT * FROM financial_settings WHERE id='default' LIMIT 1").first(),env.DB.prepare(`SELECT athletes.name AS athlete_name,athlete_access.status AS access_status,student_payments.id,student_payments.reference_month,student_payments.amount_cents,student_payments.due_date,student_payments.status,student_payments.paid_at FROM athletes LEFT JOIN athlete_access ON athlete_access.athlete_name=athletes.name LEFT JOIN student_payments ON student_payments.athlete_name=athletes.name AND student_payments.reference_month=? WHERE COALESCE(athlete_access.status,'Ativo')<>'Bloqueado' ORDER BY athletes.name`).bind(month).all()]);
    return Response.json({month,settings:settings??null,payments:payments.results});
  }
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});const input=await request.json() as Record<string,unknown>;const action=boundedText(input.action,30);const now=Date.now();
  if(action==="save_settings"){
    const amount=Number(input.defaultAmount);const dueDay=Number(input.dueDay);const pixKey=boundedText(input.pixKey,180);const pixName=boundedText(input.pixName,120);
    if(!Number.isFinite(amount)||amount<=0||amount>10000||!Number.isInteger(dueDay)||dueDay<1||dueDay>28)return Response.json({error:"invalid_financial_settings"},{status:400});
    await env.DB.prepare("INSERT INTO financial_settings (id,pix_key,pix_name,default_amount_cents,due_day,updated_at) VALUES ('default',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET pix_key=excluded.pix_key,pix_name=excluded.pix_name,default_amount_cents=excluded.default_amount_cents,due_day=excluded.due_day,updated_at=excluded.updated_at").bind(pixKey||null,pixName||null,Math.round(amount*100),dueDay,now).run();return Response.json({saved:true});
  }
  if(action==="generate_month"){
    const settings=await env.DB.prepare("SELECT default_amount_cents,due_day FROM financial_settings WHERE id='default'").first() as {default_amount_cents?:number;due_day?:number}|null;if(!settings)return Response.json({error:"settings_required"},{status:409});const referenceMonth=boundedText(input.referenceMonth,7)||month;if(!/^\d{4}-\d{2}$/.test(referenceMonth))return Response.json({error:"invalid_month"},{status:400});const dueDate=`${referenceMonth}-${String(settings.due_day).padStart(2,"0")}`;const athletes=await env.DB.prepare("SELECT athletes.name FROM athletes LEFT JOIN athlete_access ON athlete_access.athlete_name=athletes.name WHERE COALESCE(athlete_access.status,'Ativo')<>'Bloqueado'").all();await env.DB.batch((athletes.results as any[]).map(row=>env.DB.prepare("INSERT OR IGNORE INTO student_payments (id,athlete_name,reference_month,amount_cents,due_date,status,paid_at,updated_at) VALUES (?,?,?,?,?,'Pendente',NULL,?)").bind(crypto.randomUUID(),row.name,referenceMonth,settings.default_amount_cents,dueDate,now)));return Response.json({generated:athletes.results.length});
  }
  if(action==="update_payment"){
    const athleteName=boundedText(input.athleteName,120);const referenceMonth=boundedText(input.referenceMonth,7);const status=boundedText(input.status,20);const amount=Number(input.amount);const dueDate=boundedText(input.dueDate,10);if(!athleteName||!/^\d{4}-\d{2}$/.test(referenceMonth)||!["Pendente","Pago"].includes(status)||!Number.isFinite(amount)||amount<=0||!isIsoDate(dueDate))return Response.json({error:"invalid_payment"},{status:400});await env.DB.prepare("INSERT INTO student_payments (id,athlete_name,reference_month,amount_cents,due_date,status,paid_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(athlete_name,reference_month) DO UPDATE SET amount_cents=excluded.amount_cents,due_date=excluded.due_date,status=excluded.status,paid_at=excluded.paid_at,updated_at=excluded.updated_at").bind(crypto.randomUUID(),athleteName,referenceMonth,Math.round(amount*100),dueDate,status,status==="Pago"?now:null,now).run();return Response.json({saved:true});
  }
  if(action==="delete_payment"){
    const athleteName=boundedText(input.athleteName,120);const referenceMonth=boundedText(input.referenceMonth,7);
    if(!athleteName||!/^\d{4}-\d{2}$/.test(referenceMonth))return Response.json({error:"invalid_payment"},{status:400});
    await env.DB.prepare("DELETE FROM student_payments WHERE athlete_name=? AND reference_month=?").bind(athleteName,referenceMonth).run();
    return Response.json({deleted:true});
  }
  return Response.json({error:"invalid_action"},{status:400});
}

async function studentFinancialApi(request:Request,env:Env,athleteName:string):Promise<Response>{if(request.method!=="GET")return new Response("Method not allowed",{status:405});await ensureFinancial(env);const [settings,payment]=await Promise.all([env.DB.prepare("SELECT pix_key,pix_name FROM financial_settings WHERE id='default' LIMIT 1").first(),env.DB.prepare("SELECT reference_month,amount_cents,due_date,status,paid_at FROM student_payments WHERE athlete_name=? ORDER BY reference_month DESC LIMIT 1").bind(athleteName).first()]);return Response.json({settings:settings??null,payment:payment??null})}

const bytesToBase64 = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value:string) => Uint8Array.from(atob(value), char=>char.charCodeAt(0));
async function sha256Text(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}
async function encryptIntegrationToken(value:string,secret:string){const keyBytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`}

/**
 * Desfaz `encryptIntegrationToken`. O token só é decifrado no momento de
 * chamar o provedor; em repouso ele permanece cifrado no banco.
 */
async function decryptIntegrationToken(value: string, secret: string): Promise<string> {
  const [encodedIv, encodedPayload] = value.split(".");
  if (!encodedIv || !encodedPayload) return "";
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
      key,
      base64ToBytes(encodedPayload),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return "";
  }
}




/* -------------------------------------------------------------------------- */
/* Integrações: Strava, Garmin, Zepp e Apple Saúde                             */
/* -------------------------------------------------------------------------- */

/**
 * Fluxos OAuth em andamento. Substitui `oauth_states` porque o Garmin usa PKCE
 * e precisa guardar o `code_verifier` até o retorno da autorização.
 */

async function ensureIntegrationTables(env: Env) {
  await ensureTables(env, schema.externalIntegrations, schema.oauthFlows, schema.externalActivities, schema.deviceIngestTokens);
}

function providerCredentials(env: Env, provider: ProviderDefinition): { clientId?: string; clientSecret?: string } {
  if (provider.id === "strava") return { clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET };
  if (provider.id === "garmin") return { clientId: env.GARMIN_CONSUMER_KEY, clientSecret: env.GARMIN_CONSUMER_SECRET };
  if (provider.id === "zepp") return { clientId: env.ZEPP_APP_ID, clientSecret: env.ZEPP_APP_SECRET };
  return {};
}

/** Um provedor só é oferecido ao atleta quando tudo que ele exige existe. */
function providerIsReady(env: Env, provider: ProviderDefinition): boolean {
  const values: Record<string, string | undefined> = {
    STRAVA_CLIENT_ID: env.STRAVA_CLIENT_ID,
    STRAVA_CLIENT_SECRET: env.STRAVA_CLIENT_SECRET,
    STRAVA_TOKEN_ENCRYPTION_KEY: env.STRAVA_TOKEN_ENCRYPTION_KEY,
    GARMIN_CONSUMER_KEY: env.GARMIN_CONSUMER_KEY,
    GARMIN_CONSUMER_SECRET: env.GARMIN_CONSUMER_SECRET,
    ZEPP_APP_ID: env.ZEPP_APP_ID,
    ZEPP_APP_SECRET: env.ZEPP_APP_SECRET,
  };
  return provider.requiredEnv.every(name => Boolean(values[name]));
}

function providerStatusLabel(env: Env, provider: ProviderDefinition): string {
  if (!providerIsReady(env, provider)) return "Credenciais não configuradas";
  if (provider.id === "garmin") {
    const activity = env.GARMIN_ACTIVITY_API_ENABLED === "true";
    const training = env.GARMIN_TRAINING_API_ENABLED === "true";
    if (!activity && !training) return "Aguardando liberação das APIs";
    return activity && training ? "Pronta para testes" : "Liberação parcial das APIs";
  }
  if (provider.id === "apple") return "Pronta — envio pelo iPhone";
  return "Pronta para conectar";
}

/* --- PKCE (Garmin) -------------------------------------------------------- */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createCodeVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(48)));
}

async function codeChallengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/* --- Início da autorização ------------------------------------------------ */

function integrationRedirectUri(url: URL, provider: ProviderDefinition): string {
  return `${url.origin}/api/integrations/callback/${provider.id}`;
}

async function beginOauthFlow(
  request: Request, env: Env, provider: ProviderDefinition, athleteName: string, email: string,
): Promise<Response> {
  const url = new URL(request.url);
  const { clientId } = providerCredentials(env, provider);
  if (!clientId || !provider.authorizeUrl) {
    return Response.json({ error: "provider_setup_required", provider: provider.id }, { status: 503 });
  }

  const rawState = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const stateHash = await sha256Text(rawState);
  const redirectUri = integrationRedirectUri(url, provider);
  const verifier = provider.authType === "oauth2-pkce" ? createCodeVerifier() : null;
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_flows WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "INSERT INTO oauth_flows (state_hash, athlete_name, actor_email, provider, code_verifier, redirect_uri, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(stateHash, athleteName, email, provider.id, verifier, redirectUri, now + 10 * 60_000, now),
  ]);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: rawState,
  });
  if (provider.scope) params.set("scope", provider.scope);
  if (provider.id === "strava") params.set("approval_prompt", "auto");
  if (verifier) {
    params.set("code_challenge", await codeChallengeOf(verifier));
    params.set("code_challenge_method", "S256");
  }

  return Response.json({ authorizationUrl: `${provider.authorizeUrl}?${params.toString()}` });
}

/* --- Retorno da autorização ----------------------------------------------- */

async function integrationCallbackApi(request: Request, url: URL, env: Env, providerId: string): Promise<Response> {
  const provider = providerById(providerId);
  if (!provider || !provider.tokenUrl) return Response.json({ error: "unknown_provider" }, { status: 404 });
  if (!env.STRAVA_TOKEN_ENCRYPTION_KEY) return Response.json({ error: "provider_setup_required" }, { status: 503 });
  await ensureIntegrationTables(env);

  const failure = (reason: string) => Response.redirect(`${url.origin}/?integracao=${provider.id}&status=${reason}`, 302);
  const rawState = boundedText(url.searchParams.get("state"), 200);
  const code = boundedText(url.searchParams.get("code"), 500);
  if (!rawState || !code || url.searchParams.get("error")) return failure("negada");

  const stateHash = await sha256Text(rawState);
  const flow = await env.DB.prepare(
    "SELECT athlete_name, code_verifier, redirect_uri, expires_at FROM oauth_flows WHERE state_hash = ? AND provider = ? LIMIT 1",
  ).bind(stateHash, provider.id).first() as { athlete_name?: string; code_verifier?: string | null; redirect_uri?: string; expires_at?: number } | null;
  if (!flow?.athlete_name || Number(flow.expires_at ?? 0) <= Date.now()) return failure("expirada");

  const { clientId, clientSecret } = providerCredentials(env, provider);
  if (!clientId || !clientSecret) return failure("indisponivel");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: String(flow.redirect_uri ?? integrationRedirectUri(url, provider)),
  });
  if (flow.code_verifier) body.set("code_verifier", flow.code_verifier);

  const tokenResponse = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResponse.ok) return failure("erro");
  const token = await tokenResponse.json() as Record<string, unknown>;

  const granted = boundedText(token.scope ?? url.searchParams.get("scope") ?? provider.scope ?? "", 300);
  if (provider.id === "strava" && !granted.includes("activity:read")) return failure("permissao");

  const accessToken = String(token.access_token ?? "");
  const refreshToken = String(token.refresh_token ?? "");
  if (!accessToken) return failure("erro");

  // O Strava devolve o instante absoluto de expiração; os demais, a duração.
  const expiresAt = Number(token.expires_at)
    ? Number(token.expires_at) * 1000
    : Date.now() + Number(token.expires_in ?? 21_600) * 1000;

  const externalId = String(
    (token.athlete as Record<string, unknown> | undefined)?.id ?? token.user_id ?? token.userId ?? "",
  );
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO external_integrations
      (id, athlete_name, provider, external_athlete_id, scopes, access_token_encrypted, refresh_token_encrypted, expires_at, status, last_sync_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Conectado', NULL, ?)
      ON CONFLICT(athlete_name, provider) DO UPDATE SET
        external_athlete_id = excluded.external_athlete_id, scopes = excluded.scopes,
        access_token_encrypted = excluded.access_token_encrypted,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        expires_at = excluded.expires_at, status = 'Conectado', updated_at = excluded.updated_at`)
      .bind(
        crypto.randomUUID(), flow.athlete_name, provider.label, externalId, granted,
        await encryptIntegrationToken(accessToken, env.STRAVA_TOKEN_ENCRYPTION_KEY),
        await encryptIntegrationToken(refreshToken, env.STRAVA_TOKEN_ENCRYPTION_KEY),
        expiresAt, now,
      ),
    env.DB.prepare("DELETE FROM oauth_flows WHERE state_hash = ?").bind(stateHash),
  ]);
  return Response.redirect(`${url.origin}/?integracao=${provider.id}&status=conectada`, 302);
}

/* --- Ingestão de atividades ----------------------------------------------- */

/** Grava uma atividade normalizada, ignorando o que já foi importado antes. */
async function storeActivity(env: Env, athleteName: string, provider: ProviderId, raw: Record<string, unknown>): Promise<boolean> {
  const activity = normalizeActivity(provider, raw);
  if (!activity) return false;
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO external_activities
    (id, athlete_name, provider, external_activity_id, started_at, sport, distance_meters, moving_seconds, elapsed_seconds, average_heart_rate, average_pace_seconds, raw_payload, matched_week_start, matched_workout_day, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), athleteName, PROVIDERS[provider].label, activity.externalId,
      activity.startedAt, activity.sport, activity.distanceMeters, activity.movingSeconds,
      activity.elapsedSeconds, activity.averageHeartRate, averagePaceSeconds(activity),
      JSON.stringify(raw).slice(0, 12_000),
      weekStartOf(activity.startedAt), workoutDayOf(activity.startedAt), Date.now(),
    ).run() as { meta?: { changes?: number } };
  return Number(result?.meta?.changes ?? 1) > 0;
}

/**
 * Importa as atividades recentes do Strava. É o único provedor com importação
 * ativa hoje; Garmin e Zepp entram por webhook assim que forem liberados.
 */
async function syncStravaActivities(env: Env, athleteName: string): Promise<{ imported: number; error?: string }> {
  if (!env.STRAVA_TOKEN_ENCRYPTION_KEY || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return { imported: 0, error: "provider_setup_required" };
  }
  const row = await env.DB.prepare(
    "SELECT access_token_encrypted, refresh_token_encrypted, expires_at FROM external_integrations WHERE athlete_name = ? AND provider = 'Strava' LIMIT 1",
  ).bind(athleteName).first() as { access_token_encrypted?: string; refresh_token_encrypted?: string; expires_at?: number } | null;
  if (!row?.access_token_encrypted) return { imported: 0, error: "not_connected" };

  let accessToken = await decryptIntegrationToken(row.access_token_encrypted, env.STRAVA_TOKEN_ENCRYPTION_KEY);
  // Token que não decifra é problema desta instalação, não do Strava: acontece
  // quando a chave de cifra muda. Dizer "falha no Strava" mandaria quem for
  // investigar para o lado errado; o caminho certo é o atleta reconectar.
  if (!accessToken) return { imported: 0, error: "token_unreadable" };

  // Renova no servidor quando falta menos de um minuto para expirar.
  if (Number(row.expires_at ?? 0) - Date.now() < 60_000 && row.refresh_token_encrypted) {
    const refreshToken = await decryptIntegrationToken(row.refresh_token_encrypted, env.STRAVA_TOKEN_ENCRYPTION_KEY);
    const refreshed = await fetch(PROVIDERS.strava.tokenUrl as string, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!refreshed.ok) return { imported: 0, error: "refresh_failed" };
    const token = await refreshed.json() as Record<string, unknown>;
    accessToken = String(token.access_token ?? "");
    await env.DB.prepare(
      "UPDATE external_integrations SET access_token_encrypted = ?, refresh_token_encrypted = ?, expires_at = ?, updated_at = ? WHERE athlete_name = ? AND provider = 'Strava'",
    ).bind(
      await encryptIntegrationToken(accessToken, env.STRAVA_TOKEN_ENCRYPTION_KEY),
      await encryptIntegrationToken(String(token.refresh_token ?? refreshToken), env.STRAVA_TOKEN_ENCRYPTION_KEY),
      Number(token.expires_at ?? 0) * 1000, Date.now(), athleteName,
    ).run();
  }

  const since = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
  const activities = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${since}&per_page=50`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!activities.ok) return { imported: 0, error: "strava_request_failed" };
  const list = await activities.json() as Record<string, unknown>[];

  let imported = 0;
  for (const raw of Array.isArray(list) ? list.slice(0, 50) : []) {
    if (await storeActivity(env, athleteName, "strava", raw)) imported += 1;
  }
  await env.DB.prepare("UPDATE external_integrations SET last_sync_at = ?, updated_at = ? WHERE athlete_name = ? AND provider = 'Strava'")
    .bind(Date.now(), Date.now(), athleteName).run();
  return { imported };
}

/* --- Apple Saúde: token de ingestão para o Atalho do iOS ------------------- */

async function issueDeviceIngestToken(env: Env, athleteName: string): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE device_ingest_tokens SET revoked_at = ? WHERE athlete_name = ? AND provider = 'apple' AND revoked_at IS NULL").bind(now, athleteName),
    env.DB.prepare("INSERT INTO device_ingest_tokens (token_hash, athlete_name, provider, created_at, last_used_at, revoked_at) VALUES (?, ?, 'apple', ?, NULL, NULL)")
      .bind(await sha256Text(token), athleteName, now),
  ]);
  await env.DB.prepare(`INSERT INTO external_integrations
    (id, athlete_name, provider, external_athlete_id, scopes, access_token_encrypted, refresh_token_encrypted, expires_at, status, last_sync_at, updated_at)
    VALUES (?, ?, ?, NULL, 'workouts', '', '', 0, 'Conectado', NULL, ?)
    ON CONFLICT(athlete_name, provider) DO UPDATE SET status = 'Conectado', updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), athleteName, PROVIDERS.apple.label, now).run();
  return token;
}

/**
 * Recebe treinos enviados pelo iPhone. Autentica pelo token de ingestão, não
 * pela sessão do navegador, porque quem chama aqui é um Atalho do iOS.
 */
async function deviceIngestApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  await ensureIntegrationTables(env);
  const presented = boundedText(request.headers.get("x-zonas-ingest-token"), 100);
  if (!/^[a-f0-9]{48}$/.test(presented)) return Response.json({ error: "ingest_token_required" }, { status: 401 });

  const record = await env.DB.prepare(
    "SELECT athlete_name FROM device_ingest_tokens WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1",
  ).bind(await sha256Text(presented)).first() as { athlete_name?: string } | null;
  if (!record?.athlete_name) return Response.json({ error: "invalid_ingest_token" }, { status: 401 });

  const input = await request.json() as Record<string, unknown>;
  const workouts = Array.isArray(input.workouts) ? input.workouts.slice(0, 50) : [];
  if (!workouts.length) return Response.json({ error: "no_workouts" }, { status: 400 });

  let imported = 0;
  for (const raw of workouts) {
    if (raw && typeof raw === "object" && await storeActivity(env, record.athlete_name, "apple", raw as Record<string, unknown>)) {
      imported += 1;
    }
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE device_ingest_tokens SET last_used_at = ? WHERE token_hash = ?").bind(now, await sha256Text(presented)),
    env.DB.prepare("UPDATE external_integrations SET last_sync_at = ?, updated_at = ? WHERE athlete_name = ? AND provider = ?")
      .bind(now, now, record.athlete_name, PROVIDERS.apple.label),
  ]);
  return Response.json({ imported, received: workouts.length });
}

/* --- API do atleta -------------------------------------------------------- */

async function studentIntegrationsApi(request: Request, env: Env, athleteName: string, email: string): Promise<Response> {
  await ensureIntegrationTables(env);

  if (request.method === "GET") {
    const connections = await env.DB.prepare(
      "SELECT provider, status, scopes, external_athlete_id, last_sync_at, updated_at FROM external_integrations WHERE athlete_name = ?",
    ).bind(athleteName).all();
    const byLabel = new Map((connections.results as Record<string, unknown>[]).map(row => [String(row.provider), row]));
    return Response.json({
      providers: Object.values(PROVIDERS).map(provider => {
        const pronto = providerIsReady(env, provider);
        const conexao = byLabel.get(provider.label) ?? null;
        // Uma autorização antiga não vale nada se as credenciais do serviço
        // saíram do ambiente: nada seria importado. Continuar exibindo
        // "Conectado" faria o atleta acreditar que os treinos estão chegando.
        const conexaoUtil = conexao && !pronto
          ? { ...conexao, status: "Suspensa", reason: "provider_not_configured" }
          : conexao;
        return {
          id: provider.id,
          label: provider.label,
          authType: provider.authType,
          available: pronto,
          status: providerStatusLabel(env, provider),
          canImportActivities: provider.canImportActivities,
          canSendWorkouts: provider.canSendWorkouts,
          notes: provider.notes,
          connection: conexaoUtil,
        };
      }),
    });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const provider = providerById(boundedText(input.provider, 20));
  const action = boundedText(input.action, 20) || "connect";
  if (!provider) return Response.json({ error: "unknown_provider" }, { status: 400 });
  if (!providerIsReady(env, provider)) {
    return Response.json({ error: "provider_setup_required", provider: provider.id, missing: provider.requiredEnv }, { status: 503 });
  }

  if (action === "disconnect") {
    await env.DB.batch([
      env.DB.prepare("UPDATE external_integrations SET status = 'Desconectado', access_token_encrypted = '', refresh_token_encrypted = '', updated_at = ? WHERE athlete_name = ? AND provider = ?")
        .bind(Date.now(), athleteName, provider.label),
      env.DB.prepare("UPDATE device_ingest_tokens SET revoked_at = ? WHERE athlete_name = ? AND provider = ? AND revoked_at IS NULL")
        .bind(Date.now(), athleteName, provider.id),
    ]);
    return Response.json({ disconnected: true, provider: provider.id });
  }

  if (action === "sync") {
    if (provider.id !== "strava") {
      return Response.json({ error: "sync_not_available", provider: provider.id, reason: provider.notes }, { status: 409 });
    }
    const result = await syncStravaActivities(env, athleteName);
    if (result.error) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  }

  if (action === "connect") {
    // A Apple não tem autorização em servidor: o vínculo é um token que o
    // atleta cola no Atalho do iOS.
    if (provider.authType === "device") {
      const ingestToken = await issueDeviceIngestToken(env, athleteName);
      return Response.json({
        provider: provider.id,
        authType: "device",
        ingestToken,
        ingestUrl: `${new URL(request.url).origin}/api/ingest/device`,
        instructions: "No iPhone, crie um Atalho que leia os treinos do app Saúde e envie um POST para o endereço acima com o cabeçalho x-zonas-ingest-token. O token aparece uma única vez.",
      });
    }
    return await beginOauthFlow(request, env, provider, athleteName, email);
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
}

/** Visão do treinador: quem conectou o quê, e o que ainda depende de cadastro. */
async function integrationsCoachApi(request: Request, env: Env): Promise<Response> {
  await ensureIntegrationTables(env);
  if (request.method === "GET") {
    const connections = await env.DB.prepare(
      `SELECT athlete_name, provider, status, external_athlete_id, last_sync_at, updated_at
         FROM external_integrations ORDER BY athlete_name, provider`,
    ).all();
    const activities = await env.DB.prepare(
      `SELECT athlete_name, provider, COUNT(*) AS total, MAX(started_at) AS last_activity_at
         FROM external_activities GROUP BY athlete_name, provider`,
    ).all();
    return Response.json({
      providers: Object.values(PROVIDERS).map(provider => ({
        id: provider.id,
        label: provider.label,
        authType: provider.authType,
        available: providerIsReady(env, provider),
        status: providerStatusLabel(env, provider),
        missing: provider.requiredEnv.filter(name => !providerIsReady(env, provider)),
        canImportActivities: provider.canImportActivities,
        canSendWorkouts: provider.canSendWorkouts,
        notes: provider.notes,
      })),
      connections: connections.results,
      activityTotals: activities.results,
    });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const action = boundedText(input.action, 20);
  const provider = providerById(boundedText(input.provider, 20));
  const athleteName = boundedText(input.athleteName, 120);
  if (action !== "disconnect" || !provider || !athleteName) {
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }
  await env.DB.prepare(
    "UPDATE external_integrations SET status = 'Desconectado', access_token_encrypted = '', refresh_token_encrypted = '', updated_at = ? WHERE athlete_name = ? AND provider = ?",
  ).bind(Date.now(), athleteName, provider.label).run();
  return Response.json({ disconnected: true, athleteName, provider: provider.id });
}


/* -------------------------------------------------------------------------- */
/* Diagnóstico (conta de manutenção)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Retrato do sistema para quem mantém a plataforma.
 *
 * Reúne em uma resposta o que estava espalhado por várias telas: contas e
 * sessões, erros e eventos de segurança, volume de cada tabela e estado das
 * integrações. Nunca inclui hash de senha nem token — nem a conta de
 * manutenção precisa deles para diagnosticar, e expô-los transformaria esta
 * rota num alvo.
 */
async function devOverviewApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  await ensureTables(env, schema.userAccounts, schema.userSessions);
  await ensureTables(env, schema.applicationErrors, schema.securityEvents, schema.requestRateLimits, schema.requestDeduplication);
  await ensureIntegrationTables(env);

  const agora = Date.now();
  const tabelas = [
    "athletes", "user_accounts", "user_sessions", "training_weeks", "performance_tests",
    "workout_executions", "pain_reports", "pain_report_updates", "training_feedbacks",
    "athlete_races", "personal_records", "student_payments", "external_activities",
    "external_integrations", "access_requests", "data_backups", "security_events",
    "application_errors",
  ];

  const [contas, sessoes, erros, eventos, limites, atividades] = await Promise.all([
    env.DB.prepare(`SELECT id, email, name, role, athlete_name, status, must_change_password,
                           failed_attempts, locked_until, last_login_at, created_at
                      FROM user_accounts ORDER BY role, name`).all(),
    env.DB.prepare(`SELECT user_sessions.email, user_sessions.created_at, user_sessions.last_seen_at,
                           user_sessions.expires_at, user_accounts.role
                      FROM user_sessions LEFT JOIN user_accounts ON user_accounts.id = user_sessions.user_id
                     WHERE user_sessions.expires_at > ? ORDER BY user_sessions.last_seen_at DESC LIMIT 40`).bind(agora).all(),
    env.DB.prepare("SELECT id, area, error_code, method, status_code, created_at FROM application_errors ORDER BY created_at DESC LIMIT 80").all(),
    env.DB.prepare("SELECT id, actor_email, event_type, route, details, created_at FROM security_events ORDER BY created_at DESC LIMIT 60").all(),
    env.DB.prepare("SELECT actor_email, route, method, request_count, window_start FROM request_rate_limits WHERE window_start > ? ORDER BY request_count DESC LIMIT 25").bind(agora - 3_600_000).all(),
    env.DB.prepare("SELECT provider, COUNT(*) AS total, MAX(started_at) AS ultima FROM external_activities GROUP BY provider").all(),
  ]);

  // Volume de cada tabela, uma consulta por tabela porque o SQLite não expõe
  // contagem de linhas em metadado confiável.
  const volumes: Record<string, number> = {};
  for (const tabela of tabelas) {
    try {
      const linha = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).first() as { total?: number } | null;
      volumes[tabela] = Number(linha?.total ?? 0);
    } catch {
      volumes[tabela] = -1; // tabela ainda não criada nesta instalação
    }
  }

  const errosRecentes = (erros.results as Array<{ created_at: number }>).filter(e => Number(e.created_at) > agora - 86_400_000);

  return Response.json({
    generatedAt: agora,
    saude: {
      errosUltimas24h: errosRecentes.length,
      contasBloqueadas: (contas.results as Array<{ status?: string }>).filter(c => c.status === "Bloqueado").length,
      sessoesAtivas: sessoes.results.length,
      integracoesConectadas: (atividades.results as unknown[]).length,
    },
    ambiente: {
      // Só a presença das variáveis, nunca o valor.
      coachEmailConfigurado: Boolean(env.COACH_EMAIL),
      devLoginConfigurado: Boolean(env.DEV_LOGIN),
      chaveDeCifraConfigurada: Boolean(env.STRAVA_TOKEN_ENCRYPTION_KEY),
      provedores: Object.values(PROVIDERS).map(p => ({ id: p.id, label: p.label, disponivel: providerIsReady(env, p), estado: providerStatusLabel(env, p) })),
    },
    contas: contas.results,
    sessoes: sessoes.results,
    erros: erros.results,
    eventos: eventos.results,
    limites: limites.results,
    atividadesPorProvedor: atividades.results,
    volumes,
  });
}


/**
 * Treinadores existentes e visita a um deles.
 *
 * A visita é registrada na sessão da manutenção, não no navegador: assim é o
 * servidor que decide o recorte dos dados, e não a interface. Quem age continua
 * sendo a conta de manutenção, e é o e-mail dela que vai para a auditoria.
 */
async function devCoachesApi(request: Request, env: Env): Promise<Response> {
  await ensureTables(env, schema.userAccounts, schema.userSessions, schema.athletes);
  await atribuiAlunosSemDono(env);

  if (request.method === "GET") {
    const treinadores = await env.DB.prepare(
      `SELECT user_accounts.id, user_accounts.email, user_accounts.name, user_accounts.status, user_accounts.last_login_at,
              (SELECT COUNT(*) FROM athletes WHERE athletes.coach_email = user_accounts.email AND athletes.archived_at IS NULL) AS alunos_ativos
         FROM user_accounts WHERE role = 'coach' ORDER BY name`,
    ).all();
    const semDono = await env.DB.prepare("SELECT COUNT(*) AS total FROM athletes WHERE coach_email IS NULL").first() as { total?: number } | null;
    const sessao = await identityFromRequest(env.DB, request);
    return Response.json({
      coaches: treinadores.results,
      visitando: sessao?.role === "dev" ? sessao.visitando ?? null : null,
      alunosSemDono: Number(semDono?.total ?? 0),
    });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const input = await request.json() as Record<string, unknown>;
  const acao = boundedText(input.action, 20) || "visit";
  const token = readSessionToken(request);
  if (!token) return Response.json({ error: "authentication_required" }, { status: 401 });

  if (acao === "stop") {
    await setImpersonation(env.DB, token, null);
    return Response.json({ visitando: null });
  }

  if (acao === "create") {
    const email = boundedText(input.email, 254).toLowerCase();
    const name = boundedText(input.name, 120);
    const senha = boundedText(input.password, 200);
    if (!isValidEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
    if (name.length < 3) return Response.json({ error: "name_too_short" }, { status: 400 });
    const problema = passwordProblem(senha || generateTemporaryPassword() + "a1");
    const senhaFinal = senha || `${generateTemporaryPassword()}a1`;
    if (senha && problema) return Response.json({ error: problema, minLength: MIN_PASSWORD_LENGTH }, { status: 400 });
    if (await accountByEmail(env.DB, email)) return Response.json({ error: "email_already_registered" }, { status: 409 });
    await createAccount(env.DB, { email, name, role: "coach", password: senhaFinal, mustChangePassword: true, status: "Ativo" });
    return Response.json({ created: true, email, name, temporaryPassword: senhaFinal }, { status: 201 });
  }

  if (acao === "visit") {
    const email = boundedText(input.email, 254).toLowerCase();
    const alvo = await env.DB.prepare("SELECT id, email, name FROM user_accounts WHERE email = ? AND role = 'coach' LIMIT 1").bind(email).first() as { id?: string; email?: string; name?: string } | null;
    if (!alvo?.id) return Response.json({ error: "coach_not_found" }, { status: 404 });
    await setImpersonation(env.DB, token, alvo.id);
    // Visitar a área de outra pessoa é um ato que precisa deixar rastro.
    await ensureTables(env, schema.securityEvents);
    await env.DB.prepare("INSERT INTO security_events (id, actor_email, event_type, route, details, created_at) VALUES (?, ?, 'Manutenção visitou um treinador', '/api/dev/coaches', ?, ?)")
      .bind(crypto.randomUUID(), normalizedAuthenticatedEmail(request) ?? "manutenção", `Área de ${alvo.email}`, Date.now()).run();
    return Response.json({ visitando: { email: alvo.email, name: alvo.name, userId: alvo.id } });
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
}

async function racesRecordsApi(request: Request, env: Env): Promise<Response> {
  await ensureTables(env, schema.athleteRaces, schema.personalRecords);
  const url=new URL(request.url);
  if(request.method==="GET"){
    const athlete=String(url.searchParams.get("athlete")||"");
    if(!athlete){const races=await env.DB.prepare("SELECT * FROM athlete_races ORDER BY race_date ASC,created_at DESC").all();return Response.json({races:races.results,records:[]})}
    const [races,records]=await Promise.all([
      env.DB.prepare("SELECT * FROM athlete_races WHERE athlete_name = ? ORDER BY race_date ASC").bind(athlete).all(),
      env.DB.prepare("SELECT * FROM personal_records WHERE athlete_name = ? ORDER BY updated_at DESC").bind(athlete).all(),
    ]);
    return Response.json({races:races.results,records:records.results});
  }
  if(request.method==="POST"){
    const input=await request.json() as Record<string,unknown>; const kind=boundedText(input.kind,20); const athlete=boundedText(input.athleteName,120);
    const action=boundedText(input.action,30);
    if(action==="review_race"){
      const id=boundedText(input.id,80);const status=boundedText(input.status,30);const priority=boundedText(input.priority,30);
      if(!id||!["Aprovada","Aguardando análise","Descartada"].includes(status)||!["Prova A","Prova B","Treino"].includes(priority))return Response.json({error:"invalid_race_review"},{status:400});
      await env.DB.prepare("UPDATE athlete_races SET status = ?, priority = ? WHERE id = ?").bind(status,priority,id).run();
      return Response.json({id,status,priority});
    }
    if(!athlete)return Response.json({error:"athlete_required"},{status:400});
    const id=crypto.randomUUID(); const now=Date.now();
    if(kind==="race"){
      const name=boundedText(input.name,120); const raceDate=boundedText(input.raceDate,10); const distance=boundedText(input.distance,30);
      if(!name||!raceDate||!distance)return Response.json({error:"required_fields"},{status:400});
      if(!isIsoDate(raceDate))return Response.json({error:"invalid_race_date"},{status:400});
      const priority=boundedText(input.priority,30)||"Prova A";
      const existing=await env.DB.prepare("SELECT id FROM athlete_races WHERE athlete_name = ? AND name = ? AND race_date = ? LIMIT 1").bind(athlete,name,raceDate).first() as {id?:string}|null;
      if(existing?.id){
        await env.DB.prepare("UPDATE athlete_races SET distance = ?, city = ?, goal = ?, priority = ? WHERE id = ?").bind(distance,boundedText(input.city,100)||null,boundedText(input.goal,160)||null,priority,existing.id).run();
      }else{
        await env.DB.prepare("INSERT INTO athlete_races (id,athlete_name,name,race_date,distance,city,goal,priority,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,athlete,name,raceDate,distance,boundedText(input.city,100)||null,boundedText(input.goal,160)||null,priority,"Aguardando análise",now).run();
      }
    }else if(kind==="record"){
      const distance=boundedText(input.distance,30); const resultTime=boundedText(input.resultTime,20); const raceDate=boundedText(input.raceDate,10);
      if(!distance||!resultTime)return Response.json({error:"required_fields"},{status:400});
      if(raceDate&&!isIsoDate(raceDate))return Response.json({error:"invalid_race_date"},{status:400});
      if(!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(resultTime))return Response.json({error:"invalid_result_time"},{status:400});
      await env.DB.prepare("INSERT INTO personal_records (id,athlete_name,distance,result_time,race_date,event_name,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id,athlete,distance,resultTime,raceDate||null,boundedText(input.eventName,120)||null,now).run();
    }else return Response.json({error:"kind_required"},{status:400});
    return Response.json({id,createdAt:now},{status:201});
  }
  return new Response("Method not allowed",{status:405});
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://chat.openai.com",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  headers.set("X-Content-Type-Options", "nosniff");
  // Sites opens the app inside ChatGPT. CSP above allows only that trusted
  // host and the app itself; the legacy X-Frame-Options header is omitted
  // because it cannot express this narrow allowlist.
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (new URL(request.url).pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store, private");
    headers.set("Pragma", "no-cache");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function routeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Rotas de autenticação: são as únicas alcançáveis sem sessão, e por isso
    // ficam antes de qualquer resolução de identidade.
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        await ensureTables(env, schema.userAccounts, schema.userSessions);
        const coachAccount = await ensureCoachAccount(env.DB, coachEmailOf(env), env.COACH_INITIAL_PASSWORD);
        await ensureDevAccount(env.DB, env.DEV_LOGIN, env.DEV_INITIAL_PASSWORD);
        if (coachAccount === "not_configured") {
          return Response.json({
            error: "coach_account_not_configured",
            message: "Defina COACH_EMAIL e COACH_INITIAL_PASSWORD no ambiente para criar a conta do treinador.",
          }, { status: 503 });
        }
        const invalid = await validateApiEnvelope(request, url); if (invalid) return invalid;
        if (url.pathname === "/api/auth/login") {
          const limited = await enforceAuthThrottle(request, url, env); if (limited) return limited;
          return await authLoginApi(request, url, env);
        }
        if (url.pathname === "/api/auth/logout") return await authLogoutApi(request, url, env);
        if (url.pathname === "/api/auth/register") {
          const limited = await enforceAuthThrottle(request, url, env); if (limited) return limited;
          return await authRegisterApi(request, url, env);
        }
        if (url.pathname === "/api/auth/password") return await authPasswordApi(request, env);
        return Response.json({ error: "not_found" }, { status: 404 });
      } catch { return await applicationFailure(env, request, "autenticação", "auth_unavailable"); }
    }

    // A partir daqui toda rota precisa saber quem está falando.
    if (url.pathname.startsWith("/api/")) {
      try {
        await ensureTables(env, schema.userAccounts, schema.userSessions);
        await ensureCoachAccount(env.DB, coachEmailOf(env), env.COACH_INITIAL_PASSWORD);
        await ensureDevAccount(env.DB, env.DEV_LOGIN, env.DEV_INITIAL_PASSWORD);
        resolvedIdentities.set(request, await resolveApiIdentity(request, env));
      } catch { return await applicationFailure(env, request, "sessão", "database_unavailable"); }
    }

    if (url.pathname === "/api/session") {
      try {
        const email = normalizedAuthenticatedEmail(request);
        if (email) { const limited = await enforceTrafficProtection(request, url, env, email); if (limited) return limited; }
        return await sessionApi(request, env);
      }
      catch { return await applicationFailure(env, request, "sessão", "database_unavailable"); }
    }

    if (url.pathname.startsWith("/api/integrations/callback/")) {
      try { return await integrationCallbackApi(request, url, env, url.pathname.split("/").pop() || ""); }
      catch { return await applicationFailure(env, request, "conexão com o aplicativo", "integration_connection_failed"); }
    }

    // Chamado pelo Atalho do iOS, autenticado por token de ingestão.
    if (url.pathname === "/api/ingest/device") {
      try { return await deviceIngestApi(request, env); }
      catch { return await applicationFailure(env, request, "envio do Apple Saúde", "device_ingest_failed"); }
    }

    if (url.pathname.startsWith("/api/student/")) {
      try {
        const identity = resolvedIdentities.get(request) ?? null;
        if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
        if (identity.role !== "student") return Response.json({ error: "student_access_required" }, { status: 403 });
        const limited = await enforceTrafficProtection(request, url, env, identity.email); if (limited) return limited;
        const invalid = await validateApiEnvelope(request, url); if (invalid) return invalid;
        const duplicate = await preventDuplicateSubmission(request, url, env, identity.email); if (duplicate) return duplicate;
        if (url.pathname === "/api/student/dashboard") return await studentDashboardApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/profile") return await studentProfileApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/performance-tests") return await studentPerformanceTestsApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/pain-reports") return await studentPainApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/feedbacks") return await studentFeedbacksApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/workout-executions") return await studentWorkoutExecutionsApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/integration-preference") return await studentIntegrationPreferenceApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/integrations") return await studentIntegrationsApi(request, env, identity.athleteName, identity.email);
        if (url.pathname === "/api/student/financial") return await studentFinancialApi(request, env, identity.athleteName);
        if (url.pathname === "/api/student/races-records") return await studentRacesRecordsApi(request, env, identity.athleteName);
        return Response.json({ error: "not_found" }, { status: 404 });
      } catch { return await applicationFailure(env, request, "área do aluno", "database_unavailable"); }
    }

    // Quem acabou de se cadastrar tem sessão mas ainda não é um aluno ativo,
    // então esta rota lê a sessão bruta em vez da identidade de aluno.
    if (url.pathname === "/api/access-request") {
      try {
        const session = await identityFromRequest(env.DB, request);
        if (!session) return Response.json({ error:"authentication_required" }, { status:401 });
        const limited = await enforceTrafficProtection(request,url,env,session.email); if(limited)return limited;
        const invalid = await validateApiEnvelope(request,url); if(invalid)return invalid;
        const duplicate = await preventDuplicateSubmission(request,url,env,session.email); if(duplicate)return duplicate;
        return await accessRequestApi(request,env,session.email,session.name);
      } catch { return await applicationFailure(env,request,"solicitação de cadastro","database_unavailable"); }
    }

    if (url.pathname.startsWith("/api/")) {
      const accessDenied = requireCoachApiAccess(request);
      if (accessDenied) return accessDenied;
      const actorEmail = normalizedAuthenticatedEmail(request) as string;
      const limited = await enforceTrafficProtection(request, url, env, actorEmail);
      if (limited) return limited;
      const invalid = await validateApiEnvelope(request, url); if (invalid) return invalid;
      const duplicate = await preventDuplicateSubmission(request, url, env, actorEmail); if (duplicate) return duplicate;
    }

    if (url.pathname === "/api/dev/coaches") {
      const negado = requireDevApiAccess(request);
      if (negado) return negado;
      try {
        const invalido = await validateApiEnvelope(request, url); if (invalido) return invalido;
        return await devCoachesApi(request, env);
      } catch { return await applicationFailure(env, request, "treinadores", "dev_coaches_unavailable"); }
    }

    if (url.pathname === "/api/dev/overview") {
      const negado = requireDevApiAccess(request);
      if (negado) return negado;
      try { return await devOverviewApi(request, env); }
      catch { return await applicationFailure(env, request, "diagnóstico", "dev_overview_unavailable"); }
    }

    if (url.pathname === "/api/integrations") {
      try { return await integrationsCoachApi(request, env); }
      catch { return await applicationFailure(env, request, "integrações", "database_unavailable"); }
    }

    if (url.pathname === "/api/accounts") {
      try { return await coachAccountsApi(request, env); }
      catch { return await applicationFailure(env, request, "contas de acesso", "database_unavailable"); }
    }

    if (url.pathname === "/api/athletes") {
      try { return await athletesApi(request, env); }
      catch { return await applicationFailure(env, request, "alunos", "database_unavailable"); }
    }
    if (url.pathname === "/api/athlete-profile") {
      try { return await athleteProfileApi(request, env); }
      catch { return await applicationFailure(env, request, "cadastro do aluno", "database_unavailable"); }
    }
    if (url.pathname === "/api/athlete-planning") {
      try { return await athletePlanningApi(request, env); }
      catch { return await applicationFailure(env, request, "planejamento do aluno", "database_unavailable"); }
    }
    if (url.pathname === "/api/plan-template-overrides") {
      try { return await planTemplateOverridesApi(request, env); }
      catch { return await applicationFailure(env, request, "biblioteca de treinos", "database_unavailable"); }
    }
    if (url.pathname === "/api/performance-tests") {
      try { return await performanceTestsApi(request, env); }
      catch { return await applicationFailure(env, request, "testes de desempenho", "database_unavailable"); }
    }
    if (url.pathname === "/api/training-weeks") {
      try { return await trainingWeeksApi(request, env); }
      catch { return await applicationFailure(env, request, "semanas de treino", "database_unavailable"); }
    }
    if (url.pathname === "/api/pain-reports") {
      try { return await painReportsApi(request, env); }
      catch { return await applicationFailure(env, request, "relatos de dor", "database_unavailable"); }
    }
    if (url.pathname === "/api/feedbacks") {
      try { return await feedbacksApi(request, env); }
      catch { return await applicationFailure(env, request, "feedbacks", "database_unavailable"); }
    }
    if (url.pathname === "/api/workout-executions") {
      try { return await workoutExecutionsApi(request, env); }
      catch { return await applicationFailure(env, request, "análise dos treinos", "database_unavailable"); }
    }
    if (url.pathname === "/api/integration-overview") {
      try { return await integrationOverviewApi(request, env); }
      catch { return await applicationFailure(env, request, "integrações dos alunos", "database_unavailable"); }
    }
    if (url.pathname === "/api/integration-readiness") {
      try { return await integrationReadinessApi(request, env); }
      catch { return Response.json({ error:"integration_readiness_unavailable" }, { status:503 }); }
    }
    if (url.pathname === "/api/financial") {
      try { return await financialApi(request, env); }
      catch { return await applicationFailure(env, request, "financeiro", "database_unavailable"); }
    }
    if (url.pathname === "/api/races-records") {
      try { return await racesRecordsApi(request, env); }
      catch { return await applicationFailure(env, request, "provas e recordes", "database_unavailable"); }
    }
    if (url.pathname === "/api/athlete-access") {
      try { return await athleteAccessApi(request, env); }
      catch { return await applicationFailure(env, request, "acesso dos alunos", "database_unavailable"); }
    }
    if (url.pathname === "/api/access-requests") {
      try { return await accessRequestsCoachApi(request, env); }
      catch { return await applicationFailure(env, request, "solicitações de cadastro", "database_unavailable"); }
    }
    if (url.pathname === "/api/backups") {
      try { return await backupsApi(request, env); }
      catch { return await applicationFailure(env, request, "backup", "backup_unavailable"); }
    }
    if (url.pathname === "/api/security-events") {
      try { return await securityEventsApi(request, env); }
      catch { return Response.json({ error: "security_events_unavailable" }, { status: 503 }); }
    }
    if (url.pathname === "/api/application-errors") {
      try { return await applicationErrorsApi(request, env); }
      catch { return Response.json({ error: "monitoring_unavailable" }, { status: 503 }); }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await routeRequest(request, env, ctx);
    return withSecurityHeaders(request, response);
  },
};

export default worker;
