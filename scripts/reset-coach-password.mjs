/**
 * Redefine a senha do treinador direto no banco.
 *
 * O treinador é a única conta sem caminho de recuperação dentro do aplicativo:
 * ele redefine a senha dos alunos pelo painel, mas ninguém redefine a dele. Sem
 * esta ferramenta, esquecer a senha significa perder o acesso para sempre.
 *
 * Uso:
 *   node scripts/reset-coach-password.mjs "nova-senha-2026"
 *   node scripts/reset-coach-password.mjs "nova-senha-2026" --email voce@email.com
 *   node scripts/reset-coach-password.mjs "nova-senha-2026" --name "Seu Nome"
 *
 * Sem senha, gera uma aleatória e a imprime. Com `--email`, troca também o
 * endereço de login do treinador — útil porque a conta é semeada uma única vez,
 * com o valor de `COACH_EMAIL`, e quem instala depois precisa usar o seu
 * próprio endereço. A senha nova não é marcada como temporária: quem roda isto
 * já tem acesso à máquina e ao banco.
 *
 * Só age no banco D1 local (Miniflare). Em produção, use
 * `wrangler d1 execute` com o comando SQL que este script imprime ao final.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { webcrypto as crypto } from "node:crypto";

const PASSWORD_ITERATIONS = 210_000;
const MIN_PASSWORD_LENGTH = 8;
const D1_DIRECTORY = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** Mesma derivação de `worker/auth.ts`, para o hash ser aceito no login. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return {
    hash: Buffer.from(new Uint8Array(bits)).toString("base64"),
    salt: Buffer.from(salt).toString("base64"),
    iterations: PASSWORD_ITERATIONS,
  };
}

function randomPassword() {
  const words = ["corrida", "ritmo", "zona", "treino", "prova", "largada", "pace", "trote"];
  const pick = words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const digits = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, "0");
  return `${pick}-${digits}`;
}

async function findLocalDatabase() {
  let entries;
  try {
    entries = await readdir(D1_DIRECTORY);
  } catch {
    fail(`Banco local não encontrado em ${D1_DIRECTORY}.\n  Rode \`npm run dev\` e abra o aplicativo uma vez para o banco ser criado.`);
  }
  const files = entries.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  if (files.length !== 1) {
    fail(`Esperava exatamente um banco em ${D1_DIRECTORY}, encontrei ${files.length}.`);
  }
  return join(D1_DIRECTORY, files[0]);
}

const args = process.argv.slice(2);
const emailIndex = args.indexOf("--email");
const newEmail = emailIndex >= 0 ? args[emailIndex + 1]?.trim().toLowerCase() : undefined;
if (emailIndex >= 0 && !newEmail) fail("Use `--email voce@email.com`.");
if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) fail(`E-mail inválido: ${newEmail}`);

const nameIndex = args.indexOf("--name");
const newName = nameIndex >= 0 ? args[nameIndex + 1]?.trim() : undefined;
if (nameIndex >= 0 && (!newName || newName.length < 2)) fail("Use `--name \"Seu Nome\"`.");

// Só reserva os índices de uma opção que realmente foi passada: com a opção
// ausente o índice é -1, e -1+1 apontaria para o primeiro posicional.
const reservado = new Set([
  ...(emailIndex >= 0 ? [emailIndex, emailIndex + 1] : []),
  ...(nameIndex >= 0 ? [nameIndex, nameIndex + 1] : []),
]);
const positional = args.filter((value, index) => !reservado.has(index));
const password = positional[0] ?? randomPassword();
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
}
if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  fail("A senha precisa misturar letras e números.");
}

const databasePath = await findLocalDatabase();
const { hash, salt, iterations } = await hashPassword(password);
const database = new DatabaseSync(databasePath);

let coach;
try {
  coach = database.prepare("SELECT id, email, name FROM user_accounts WHERE role = 'coach' LIMIT 1").get();
} catch {
  fail("A tabela `user_accounts` ainda não existe.\n  Rode `npm run dev` e abra o aplicativo uma vez antes de redefinir a senha.");
}
if (!coach) {
  fail("Nenhuma conta de treinador existe ainda.\n  Abra o aplicativo uma vez: a conta é criada no primeiro acesso com a senha de COACH_INITIAL_PASSWORD.");
}

if (newEmail && newEmail !== coach.email) {
  const taken = database.prepare("SELECT id FROM user_accounts WHERE email = ? AND id <> ? LIMIT 1").get(newEmail, coach.id);
  if (taken) fail(`Já existe outra conta com o e-mail ${newEmail}.`);
}

database.prepare(
  `UPDATE user_accounts
      SET email = ?, name = ?, password_hash = ?, password_salt = ?, password_iterations = ?,
          must_change_password = 0, failed_attempts = 0, locked_until = NULL,
          status = 'Ativo', updated_at = ?
    WHERE id = ?`,
).run(newEmail ?? coach.email, newName ?? coach.name, hash, salt, iterations, Date.now(), coach.id);

// Trocar a senha encerra as sessões abertas, como no fluxo do aplicativo.
database.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(coach.id);
database.close();

console.log(`
  Senha do treinador redefinida.

    nome:   ${newName ?? coach.name}
    e-mail: ${newEmail ?? coach.email}
    senha:  ${password}

  As sessões abertas foram encerradas. Entre novamente em http://localhost:5173

  Se este for o e-mail definitivo, defina também COACH_EMAIL no ambiente, para
  que uma instalação nova semeie a conta já com ele.

  Em produção, o equivalente é:
    wrangler d1 execute <banco> --remote --command "UPDATE user_accounts SET email='${newEmail ?? coach.email}', password_hash='${hash}', password_salt='${salt}', password_iterations=${iterations}, must_change_password=0, failed_attempts=0, locked_until=NULL WHERE role='coach'"
`);
