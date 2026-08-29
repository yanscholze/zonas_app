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
export type UserRole = "coach" | "student" | "dev";

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
  | { role: "dev"; email: string; userId: string; name: string; mustChangePassword: boolean }
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

export const createUserAccountsSql = `CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  athlete_name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export const createUserAccountsEmailIndexSql =
  `CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_email_idx ON user_accounts (email)`;

export const createUserSessionsSql = `CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
)`;

export const createUserSessionsExpiryIndexSql =
  `CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires_at)`;

export async function ensureAuthTables(db: AuthDatabase): Promise<void> {
  await db.batch([
    db.prepare(createUserAccountsSql),
    db.prepare(createUserAccountsEmailIndexSql),
    db.prepare(createUserSessionsSql),
    db.prepare(createUserSessionsExpiryIndexSql),
  ]);
}

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

/** Compara sem sair mais cedo, para não vazar quanto do hash bateu. */
function constantTimeEquals(left: string, right: string): boolean {
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
    "SELECT user_id, expires_at FROM user_sessions WHERE token_hash = ? LIMIT 1",
  ).bind(tokenHash).first() as { user_id?: string; expires_at?: number } | null;
  if (!session?.user_id || Number(session.expires_at ?? 0) <= now) return null;

  const account = await db.prepare("SELECT * FROM user_accounts WHERE id = ? LIMIT 1").bind(session.user_id).first() as UserAccount | null;
  if (!account || account.status === "Bloqueado") return null;

  await db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();

  const mustChangePassword = Number(account.must_change_password) === 1;
  if (account.role === "coach" || account.role === "dev") {
    return { role: account.role, email: account.email, userId: account.id, name: account.name, mustChangePassword };
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
 * Identificador de login aceito para a conta de manutenção. Diferente das
 * contas de treinador e aluno, não precisa ser um e-mail — é um nome curto que
 * o dono digita, e nunca recebe mensagem nenhuma.
 */
export function isValidDevLogin(login: string): boolean {
  return /^[a-zA-Z0-9._-]{1,60}$/.test(login);
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
  const existente = await db.prepare("SELECT id FROM user_accounts WHERE email = ? AND role = 'dev' LIMIT 1").bind(login).first();
  if (existente) return "ready";
  await createAccount(db, {
    email: login,
    name: "Desenvolvimento",
    role: "dev",
    password: devPassword,
    mustChangePassword: false,
    status: "Ativo",
  });
  return "created";
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
  const existing = await db.prepare("SELECT id FROM user_accounts WHERE role = 'coach' LIMIT 1").first();
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
