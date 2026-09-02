/**
 * Autenticação própria da Zonas-App.
 *
 * Substitui o cabeçalho `oai-authenticated-user-email` que a plataforma da
 * OpenAI injetava. Aqui a identidade vem de uma sessão em cookie assinada por
 * um token aleatório, e as senhas são guardadas como PBKDF2-SHA256.
 *
 * O nível de proteção é proporcional ao estágio do produto: é seguro o
 * suficiente para uso real com poucos alunos, mas ainda não tem verificação de
 * e-mail, segundo fator nem recuperação de senha automática — o treinador
 * redefine a senha de um aluno pelo painel.
 */

export const SESSION_COOKIE = "zonas_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_ITERATIONS = 210_000;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

/**
 * Papéis do sistema.
 *
 * `dev` é a conta de manutenção do dono da plataforma: enxerga tudo o que o
 * treinador enxerga e mais o diagnóstico — erros, sessões, contas e estado do
 * banco. Por ter acesso irrestrito, existe apenas se as variáveis DEV_LOGIN e
 * DEV_INITIAL_PASSWORD estiverem definidas no ambiente, e todo acesso dela fica
 * registrado no log de segurança.
 */
export type UserRole = "coach" | "student" | "dev" | "owner";

/**
 * Ordem de autoridade: dev > proprietário > treinador > aluno.
 *
 * O proprietário é um treinador com duas atribuições a mais: criar as contas
 * dos outros treinadores e conferir a área deles. Ele não é manutenção — não
 * alcança o diagnóstico, os erros nem o banco. Quem responde por isso é o dev.
 */
export const HIERARQUIA: Record<UserRole, number> = { dev: 3, owner: 2, coach: 1, student: 0 };

/** Um papel alcança o que o outro alcança? */
export function alcanca(papel: UserRole | undefined, minimo: UserRole): boolean {
  return papel !== undefined && HIERARQUIA[papel] >= HIERARQUIA[minimo];
}

export type UserAccount = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  athlete_name: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  status: string;
  must_change_password: number;
  failed_attempts: number;
  locked_until: number | null;
};

export type SessionIdentity =
  /**
   * Conta de manutenção. `visitando` diz qual treinador ela está vendo no
   * momento; quem age continua sendo a própria conta de manutenção.
   */
  | { role: "dev"; email: string; userId: string; name: string; mustChangePassword: boolean; visitando?: { email: string; name: string; userId: string } }
  /**
   * Proprietário. `visitando` diz qual treinador da equipe ele está conferindo;
   * como na manutenção, quem age continua sendo a conta do proprietário.
   */
  | { role: "owner"; email: string; userId: string; name: string; mustChangePassword: boolean; visitando?: { email: string; name: string; userId: string } }
  | { role: "coach"; email: string; userId: string; name: string; mustChangePassword: boolean }
  | { role: "student"; email: string; userId: string; name: string; athleteName: string; mustChangePassword: boolean };

interface AuthDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): { first(): Promise<unknown>; run(): Promise<unknown>; all(): Promise<{ results: unknown[] }> };
    first(): Promise<unknown>;
    run(): Promise<unknown>;
    all(): Promise<{ results: unknown[] }>;
  };
  batch(statements: unknown[]): Promise<unknown>;
}





/**
 * As tabelas de autenticação são criadas pelo Worker a partir de
 * `db/schema.ts`, como todas as outras. Este módulo cuida apenas das regras de
 * senha e sessão — declarar SQL aqui recriaria a duplicação que já custou uma
 * coluna faltante em produção.
 */

/* -------------------------------------------------------------------------- */
/* Senhas                                                                      */
/* -------------------------------------------------------------------------- */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return { hash, salt: toBase64(salt), iterations: PASSWORD_ITERATIONS };
}

/**
 * Compara sem sair mais cedo, para não vazar quanto do segredo bateu.
 *
 * Exportada porque a senha não é o único segredo comparado no sistema: o token
 * do webhook do Strava era conferido com `!==`, que devolve na primeira letra
 * diferente. Quem chama o endpoint mede o tempo da resposta e descobre o token
 * caractere a caractere — e com ele inscreve o próprio endereço para receber as
 * atividades dos alunos. Toda comparação de segredo passa por aqui.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyPassword(password: string, account: UserAccount): Promise<boolean> {
  const derived = await derivePassword(password, fromBase64(account.password_salt), account.password_iterations);
  return constantTimeEquals(derived, account.password_hash);
}

export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) return "password_too_short";
  if (password.length > 200) return "password_too_long";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "password_needs_letter_and_number";
  return null;
}

/** Senha inicial legível para o treinador ditar ao aluno; ele troca no 1º acesso. */
export function generateTemporaryPassword(): string {
  const words = ["corrida", "ritmo", "zona", "treino", "prova", "largada", "pace", "trote"];
  const word = words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const digits = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, "0");
  return `${word}-${digits}`;
}

/* -------------------------------------------------------------------------- */
/* Sessões                                                                     */
/* -------------------------------------------------------------------------- */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=").trim();
      return /^[a-f0-9]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function expiredSessionCookie(secure: boolean): string {
  const attributes = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export async function createSession(db: AuthDatabase, account: UserAccount): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now),
    db.prepare(
      "INSERT INTO user_sessions (token_hash, user_id, email, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(tokenHash, account.id, account.email, now + SESSION_TTL_MS, now, now),
  ]);
  return token;
}

export async function destroySession(db: AuthDatabase, token: string): Promise<void> {
  await db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

/** Registra, na sessão da manutenção, qual treinador ela está visitando. */
export async function setImpersonation(db: AuthDatabase, token: string, targetUserId: string | null): Promise<void> {
  await db.prepare("UPDATE user_sessions SET impersonating_user_id = ? WHERE token_hash = ?")
    .bind(targetUserId, await sha256Hex(token)).run();
}

export async function destroySessionsForUser(db: AuthDatabase, userId: string): Promise<void> {
  await db.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId).run();
}

export async function accountByEmail(db: AuthDatabase, email: string): Promise<UserAccount | null> {
  const row = await db.prepare("SELECT * FROM user_accounts WHERE email = ? LIMIT 1").bind(email).first();
  return (row as UserAccount | null) ?? null;
}

/** Resolve a identidade da requisição a partir do cookie de sessão. */
export async function identityFromRequest(db: AuthDatabase, request: Request): Promise<SessionIdentity | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const session = await db.prepare(
    "SELECT user_id, expires_at, impersonating_user_id FROM user_sessions WHERE token_hash = ? LIMIT 1",
  ).bind(tokenHash).first() as { user_id?: string; expires_at?: number; impersonating_user_id?: string | null } | null;
  if (!session?.user_id || Number(session.expires_at ?? 0) <= now) return null;

  const account = await db.prepare("SELECT * FROM user_accounts WHERE id = ? LIMIT 1").bind(session.user_id).first() as UserAccount | null;
  if (!account || account.status === "Bloqueado") return null;

  await db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();

  const mustChangePassword = Number(account.must_change_password) === 1;

  /* A visita é resolvida aqui para que o resto do sistema receba a identidade
     já pronta, sem precisar saber que existe manutenção ou proprietário. A
     manutenção pode visitar qualquer treinador, inclusive o proprietário; o
     proprietário só visita treinador comum — visitar a si mesmo ou a quem está
     acima dele não teria sentido, e abriria caminho para escalar papel. */
  const resolveVisita = async (papeisVisitaveis: string[]) => {
    if (!session.impersonating_user_id) return undefined;
    const marcadores = papeisVisitaveis.map(() => "?").join(",");
    const alvo = await db.prepare(`SELECT id, email, name FROM user_accounts WHERE id = ? AND role IN (${marcadores}) LIMIT 1`)
      .bind(session.impersonating_user_id, ...papeisVisitaveis).first() as { id?: string; email?: string; name?: string } | null;
    if (!alvo?.id || !alvo.email) return undefined;
    return { userId: alvo.id, email: alvo.email, name: alvo.name ?? alvo.email };
  };

  if (account.role === "dev") {
    return { role: "dev", email: account.email, userId: account.id, name: account.name, mustChangePassword, visitando: await resolveVisita(["coach", "owner"]) };
  }
  if (account.role === "owner") {
    return { role: "owner", email: account.email, userId: account.id, name: account.name, mustChangePassword, visitando: await resolveVisita(["coach"]) };
  }
  if (account.role === "coach") {
    return { role: "coach", email: account.email, userId: account.id, name: account.name, mustChangePassword };
  }
  if (!account.athlete_name) return null;
  return {
    role: "student",
    email: account.email,
    userId: account.id,
    name: account.name,
    athleteName: account.athlete_name,
    mustChangePassword,
  };
}

/* -------------------------------------------------------------------------- */
/* Tentativas de login                                                         */
/* -------------------------------------------------------------------------- */

export function isLockedOut(account: UserAccount, now = Date.now()): boolean {
  return Boolean(account.locked_until && Number(account.locked_until) > now);
}

export async function registerFailedAttempt(db: AuthDatabase, account: UserAccount): Promise<void> {
  const attempts = Number(account.failed_attempts ?? 0) + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCK_WINDOW_MS : null;
  await db.prepare(
    "UPDATE user_accounts SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
  ).bind(attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts, lockedUntil, Date.now(), account.id).run();
}

export async function registerSuccessfulLogin(db: AuthDatabase, account: UserAccount): Promise<void> {
  const now = Date.now();
  await db.prepare(
    "UPDATE user_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?",
  ).bind(now, now, account.id).run();
}

/* -------------------------------------------------------------------------- */
/* Criação de contas                                                           */
/* -------------------------------------------------------------------------- */

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Identificador de login aceito para a conta de manutenção.
 *
 * Aceita um nome curto — a conta não recebe mensagem nenhuma — ou um e-mail,
 * porque quem instala costuma preferir o próprio endereço. O e-mail precisa
 * ser diferente do usado pela conta de treinador: `user_accounts.email` tem
 * índice único, e repetir o endereço converteria a conta existente em conta de
 * manutenção. Um sufixo `+dev` resolve, e chega na mesma caixa de entrada.
 */
export function isValidDevLogin(login: string): boolean {
  const valor = login.trim();
  if (valor.length < 1 || valor.length > 254) return false;
  return /^[a-zA-Z0-9._-]{1,60}$/.test(valor) || isValidEmail(valor);
}

/**
 * Cria ou atualiza a conta de manutenção a partir do ambiente.
 *
 * Sem DEV_LOGIN e DEV_INITIAL_PASSWORD nada é criado: uma conta com acesso
 * irrestrito não pode existir por padrão, nem ter credencial escrita no código.
 */
export async function ensureDevAccount(
  db: AuthDatabase,
  devLogin: string | undefined,
  devPassword: string | undefined,
): Promise<"ready" | "created" | "not_configured"> {
  if (!devLogin || !isValidDevLogin(devLogin)) return "not_configured";
  if (!devPassword || devPassword.length < MIN_PASSWORD_LENGTH) return "not_configured";
  const login = devLogin.trim().toLowerCase();

  const existente = await db.prepare("SELECT id FROM user_accounts WHERE email = ? AND role = 'dev' LIMIT 1").bind(login).first() as { id?: string } | null;
  let idConfigurado = existente?.id ?? "";
  let resultado: "ready" | "created" = "ready";

  if (idConfigurado) {
    /* A manutenção é o topo da cadeia — dev acima do treinador, treinador acima
       do aluno — e por isso a conta apontada pelo ambiente se conserta sozinha.
       Sem isso não sobra caminho de volta dentro do aplicativo: quem
       destrancaria é justamente quem ficou trancado.

       Só o bloqueio administrativo é desfeito. A trava por tentativas erradas
       (`locked_until`) fica de pé e expira sozinha: limpá-la a cada requisição
       deixaria a conta mais poderosa do sistema sem defesa contra tentativa e
       erro de senha. */
    await db.prepare(
      "UPDATE user_accounts SET status = 'Ativo', updated_at = ? WHERE id = ? AND status <> 'Ativo'",
    ).bind(Date.now(), idConfigurado).run();
  } else {
    const criada = await createAccount(db, {
      email: login,
      name: "Desenvolvimento",
      role: "dev",
      password: devPassword,
      mustChangePassword: false,
      status: "Ativo",
    });
    idConfigurado = criada.id;
    resultado = "created";
  }

  /* Trocar DEV_LOGIN deixava a conta anterior ativa, com a senha antiga ainda
     valendo: cada mudança de login somava mais uma porta de acesso irrestrito.
     A anterior é fechada — mas só depois que a conta configurada existe e está
     ativa, e nunca antes. A ordem importa: fechar primeiro e criar depois foi o
     que bloqueou as duas contas de manutenção de uma vez e deixou o sistema
     sem nenhum acesso. */
  const anteriores = await db.prepare(
    "SELECT id, email FROM user_accounts WHERE role = 'dev' AND id <> ? AND status <> 'Bloqueado'",
  ).bind(idConfigurado).all();
  for (const conta of (anteriores.results ?? []) as Array<{ id: string; email: string }>) {
    await db.prepare("UPDATE user_accounts SET status = 'Bloqueado', updated_at = ? WHERE id = ?").bind(Date.now(), conta.id).run();
    await destroySessionsForUser(db, conta.id);
    /* Bloqueio automático sem registro é invisível: quando isto aconteceu, não
       havia no histórico de segurança nada que explicasse a porta fechada. */
    await registraFechamentoDeManutencao(db, conta.email, login);
  }

  return resultado;
}

/**
 * Deixa rastro do fechamento automático de uma conta de manutenção.
 *
 * Falhar aqui não pode impedir a autenticação de seguir: o registro é
 * importante, mas menos do que conseguir entrar.
 */
async function registraFechamentoDeManutencao(db: AuthDatabase, fechada: string, atual: string): Promise<void> {
  try {
    await db.prepare(
      "INSERT INTO security_events (id, actor_email, event_type, route, details, created_at) VALUES (?, 'sistema', 'Conta de manutenção anterior fechada', 'ensureDevAccount', ?, ?)",
    ).bind(crypto.randomUUID(), `Conta ${fechada} · DEV_LOGIN passou a ser ${atual}`, Date.now()).run();
  } catch {
    // Tabela ainda não criada nesta instalação: seguir sem registro.
  }
}

export async function createAccount(
  db: AuthDatabase,
  input: { email: string; name: string; role: UserRole; athleteName?: string | null; password: string; mustChangePassword?: boolean; status?: string },
): Promise<{ id: string }> {
  const { hash, salt, iterations } = await hashPassword(input.password);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`INSERT INTO user_accounts
    (id, email, name, role, athlete_name, password_hash, password_salt, password_iterations, status, must_change_password, failed_attempts, locked_until, last_login_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      athlete_name = excluded.athlete_name,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_iterations = excluded.password_iterations,
      status = excluded.status,
      must_change_password = excluded.must_change_password,
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = excluded.updated_at`)
    .bind(
      id, input.email, input.name, input.role, input.athleteName ?? null,
      hash, salt, iterations, input.status ?? "Ativo",
      input.mustChangePassword ? 1 : 0, now, now,
    ).run();
  return { id };
}

export async function setPassword(
  db: AuthDatabase,
  userId: string,
  password: string,
  mustChangePassword = false,
): Promise<void> {
  const { hash, salt, iterations } = await hashPassword(password);
  await db.prepare(
    "UPDATE user_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
  ).bind(hash, salt, iterations, mustChangePassword ? 1 : 0, Date.now(), userId).run();
}

export type CoachAccountState = "ready" | "created" | "not_configured";

/**
 * Garante que exista a conta do treinador. Roda uma única vez, no primeiro
 * acesso, e depois disso não faz mais nada.
 *
 * O e-mail e a senha inicial vêm obrigatoriamente do ambiente. Não existe
 * padrão embutido de propósito: um endereço e uma senha conhecidos no código
 * seriam uma porta de entrada pública para qualquer instalação em que alguém
 * esquecesse de configurar as variáveis. Sem elas, nenhuma conta é criada e a
 * aplicação diz o que falta.
 */
export async function ensureCoachAccount(
  db: AuthDatabase,
  coachEmail: string | null,
  initialPassword: string | undefined,
  coachName = "Treinador",
): Promise<CoachAccountState> {
  /* O proprietário conta como treinador aqui, e a razão é concreta: promover o
     único treinador a proprietário deixava zero contas com role 'coach', esta
     verificação achava que não havia treinador e recriava a conta configurada —
     e como `createAccount` sobrescreve o papel no upsert, a promoção era
     desfeita no boot seguinte, sem nada no log dizendo por quê. */
  const existing = await db.prepare("SELECT id FROM user_accounts WHERE role IN ('coach', 'owner') LIMIT 1").first();
  if (existing) return "ready";
  if (!coachEmail || !isValidEmail(coachEmail)) return "not_configured";
  if (!initialPassword || passwordProblem(initialPassword)) return "not_configured";
  await createAccount(db, {
    email: coachEmail,
    name: coachName,
    role: "coach",
    password: initialPassword,
    mustChangePassword: true,
    status: "Ativo",
  });
  return "created";
}
