#!/usr/bin/env node
/**
 * Confere se a conta da Cloudflare tem os segredos que o worker precisa.
 *
 * O worker lê variáveis de ambiente para funções inteiras: sem `DEV_LOGIN` não
 * existe conta de manutenção, sem `COACH_EMAIL` não existe treinador principal,
 * sem as chaves do Strava a integração recusa. Em desenvolvimento elas vêm do
 * `.dev.vars`; em produção precisam ser gravadas na conta uma a uma, e esquecer
 * uma só aparece quando alguém tenta usar a função que depende dela.
 *
 * Este script lê os nomes que o worker realmente usa, compara com o que a conta
 * tem, e diz o que falta. Ele nunca imprime valor de segredo — só nomes.
 *
 *   node scripts/verifica-segredos.mjs            confere a conta
 *   node scripts/verifica-segredos.mjs --local    confere o .dev.vars
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executa = promisify(execFile);
const raiz = new URL("..", import.meta.url);

/* Sem estes o sistema não sobe de pé: manutenção e treinador principal são as
   duas contas que o worker cria sozinho no primeiro acesso. */
const OBRIGATORIOS = ["DEV_LOGIN", "DEV_INITIAL_PASSWORD", "COACH_EMAIL", "COACH_INITIAL_PASSWORD"];

/* Estes desligam funções quando faltam, mas não impedem o resto de funcionar —
   a tela de integrações já diz "cadastro oficial pendente" sem eles. */
const OPCIONAIS_POR_FUNCAO = {
  "Strava": ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_WEBHOOK_VERIFY_TOKEN", "STRAVA_TOKEN_ENCRYPTION_KEY"],
  "Garmin": ["GARMIN_CONSUMER_KEY", "GARMIN_CONSUMER_SECRET"],
  "Amazfit / Zepp": ["ZEPP_APP_ID", "ZEPP_APP_SECRET", "ZEPP_WEBHOOK_SECRET"],
};

/** Os nomes que o worker de fato lê, extraídos do código e não de uma lista à parte. */
async function nomesUsadosPeloWorker() {
  const fontes = await Promise.all([
    readFile(new URL("worker/index.ts", raiz), "utf8"),
    readFile(new URL("worker/auth.ts", raiz), "utf8"),
  ]);
  const nomes = new Set();
  for (const fonte of fontes) {
    for (const achado of fonte.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) nomes.add(achado[1]);
  }
  // Bindings de plataforma não são segredos: vêm do wrangler.jsonc.
  for (const binding of ["DB", "ASSETS", "IMAGES"]) nomes.delete(binding);
  return nomes;
}

async function segredosDaConta() {
  const { stdout } = await executa("npx", ["wrangler", "secret", "list"], { cwd: new URL(".", raiz).pathname });
  try {
    return new Set(JSON.parse(stdout).map(item => item.name));
  } catch {
    // Formatos antigos imprimem uma lista em texto.
    return new Set([...stdout.matchAll(/"?name"?\s*:?\s*"?([A-Z][A-Z0-9_]+)/g)].map(m => m[1]));
  }
}

async function segredosLocais() {
  try {
    const conteudo = await readFile(new URL(".dev.vars", raiz), "utf8");
    return new Set([...conteudo.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]));
  } catch {
    return new Set();
  }
}

const local = process.argv.includes("--local");
const usados = await nomesUsadosPeloWorker();

let presentes;
try {
  presentes = local ? await segredosLocais() : await segredosDaConta();
} catch (falha) {
  console.error(local
    ? "Não foi possível ler o .dev.vars."
    : "Não foi possível consultar a conta. Rode `npx wrangler login` antes, ou use --local.");
  console.error(String(falha.message ?? falha).split("\n")[0]);
  process.exit(69);
}

const onde = local ? ".dev.vars" : "conta da Cloudflare";
console.log(`Conferindo os segredos em: ${onde}\n`);

const faltamObrigatorios = OBRIGATORIOS.filter(nome => !presentes.has(nome));
for (const nome of OBRIGATORIOS) {
  console.log(`  ${presentes.has(nome) ? "✓" : "✗"} ${nome}`);
}

console.log("");
for (const [funcao, nomes] of Object.entries(OPCIONAIS_POR_FUNCAO)) {
  const faltando = nomes.filter(nome => !presentes.has(nome));
  const estado = faltando.length === 0 ? "✓ completo"
    : faltando.length === nomes.length ? "— não configurado (a função fica desligada)"
    : `⚠ incompleto · falta ${faltando.join(", ")}`;
  console.log(`  ${funcao}: ${estado}`);
}

/* Configuração, não segredo: são chaves e endereços que ligam ou desligam
   comportamento e não têm valor sigiloso. Vão em `vars` no wrangler.jsonc, onde
   ficam à vista e versionadas — misturá-las com segredo faria alguém gravar um
   segredo no lugar errado por analogia. */
const CONFIGURACAO_PUBLICA = ["GARMIN_ACTIVITY_API_ENABLED", "GARMIN_TRAINING_API_ENABLED", "GARMIN_TRAINING_API_URL"];

/* O worker pode ter passado a ler algo que nenhuma das listas acima conhece.
   Avisar é melhor que a lista envelhecer em silêncio. */
const conhecidos = new Set([...OBRIGATORIOS, ...Object.values(OPCIONAIS_POR_FUNCAO).flat(), ...CONFIGURACAO_PUBLICA]);
const desconhecidos = [...usados].filter(nome => !conhecidos.has(nome));
if (desconhecidos.length) {
  console.log(`\n  ⚠ o worker lê nomes que este script não conhece: ${desconhecidos.join(", ")}`);
  console.log("    Acrescente-os às listas em scripts/verifica-segredos.mjs.");
}

if (faltamObrigatorios.length) {
  console.log(`\nFaltam segredos obrigatórios. Grave cada um com:\n`);
  for (const nome of faltamObrigatorios) console.log(`  npx wrangler secret put ${nome}`);
  process.exit(1);
}

console.log("\nOs obrigatórios estão todos lá.");
