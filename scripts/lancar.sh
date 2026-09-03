#!/usr/bin/env bash
#
# Lançamento do ZonasApp na Cloudflare.
#
# Existe porque a sequência tem ordem obrigatória e cada passo falha de um jeito
# diferente: sem banco criado não há id para preencher, sem id o deploy sobe um
# worker que responde 503 na primeira consulta, e sem segredos ninguém entra —
# nem você. Descobrir isso em produção, um erro por vez, é caro.
#
# Só faz o que é seguro repetir. Não cria banco, não grava segredo e não escolhe
# senha por você: quando falta algo, ele para e diz qual comando resolve.
#
#   bash scripts/lancar.sh            produção
#   bash scripts/lancar.sh ensaio     ambiente de ensaio
set -euo pipefail

ambiente="${1:-}"
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${raiz}"

if [[ -n "${ambiente}" ]]; then
  rotulo="ambiente ${ambiente}"
  flag=(--env "${ambiente}")
  chave_id="PREENCHER_COM_O_ID_DO_D1_DE_ENSAIO"
  banco="zonasapp-ensaio"
else
  rotulo="produção"
  flag=()
  chave_id="PREENCHER_COM_O_ID_DO_D1"
  banco="zonasapp"
fi

falhar() { printf '\n  ✗ %s\n\n     %s\n\n' "$1" "$2" >&2; exit 1; }
passo()  { printf '\n▸ %s\n' "$1"; }

printf '\nLançando o ZonasApp — %s\n' "${rotulo}"

# ---------------------------------------------------------------------------
passo "1. Conta da Cloudflare"
# `wrangler whoami` sai com código 0 mesmo sem autenticação — quem responde é o
# texto, não o código de saída. Confiar no código faz o roteiro seguir adiante e
# só falhar lá na frente, com uma mensagem que não é sobre login.
quem="$(npx wrangler whoami 2>&1 || true)"
if grep -qi "not authenticated\|Please run .wrangler login" <<<"${quem}"; then
  falhar "Não autenticado na Cloudflare." "npx wrangler login"
fi
grep -iE "account name|email" <<<"${quem}" | head -2 || true

# ---------------------------------------------------------------------------
passo "2. Banco de dados"
# Lê o id do bloco certo em vez de procurar o texto do marcador no arquivo
# inteiro. A primeira versão usava `grep`, e o marcador do ensaio
# (PREENCHER_COM_O_ID_DO_D1_DE_ENSAIO) contém o de produção como prefixo: a
# produção era acusada de estar sem id por causa da linha do ensaio.
id_do_banco="$(node -e '
const fs = require("fs");
const bruto = fs.readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
const conf = JSON.parse(bruto);
const alvo = process.argv[1] ? conf.env?.[process.argv[1]] : conf;
process.stdout.write(alvo?.d1_databases?.[0]?.database_id ?? "");
' "${ambiente}")"

if [[ -z "${id_do_banco}" || "${id_do_banco}" == PREENCHER* ]]; then
  falhar "O database_id de ${rotulo} ainda é um marcador em wrangler.jsonc." \
    "npx wrangler d1 create ${banco}    # e cole o id devolvido no wrangler.jsonc"
fi
if [[ ! "${id_do_banco}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  falhar "O database_id de ${rotulo} não tem forma de UUID: ${id_do_banco}" \
    "npx wrangler d1 list    # e copie o id inteiro"
fi
echo "  id: ${id_do_banco}"

# As tabelas nascem sozinhas na primeira requisição que toca cada uma
# (ensureTables/ensureColumns). Não há migração para rodar antes.

# ---------------------------------------------------------------------------
passo "3. Segredos"
if ! node scripts/verifica-segredos.mjs ${ambiente:+--env "${ambiente}"}; then
  falhar "Faltam segredos na conta." \
    "Grave os que o passo acima listou e rode de novo."
fi

# ---------------------------------------------------------------------------
passo "4. Verificação antes de subir"
echo "  tipos…"
npx tsc --noEmit -p tsconfig.json 2>&1 \
  | grep -vE "cloudflare:workers|Cannot find name 'Fetcher'|Cannot find name 'D1|implicitly has an 'any'|possibly 'undefined'" \
  | grep . && falhar "Há erros de tipo." "Corrija antes de subir." || echo "  tipos ok"

echo "  testes…"
npm test >/dev/null 2>&1 || falhar "A suíte de testes falhou." "npm test    # para ver o que caiu"
echo "  testes ok"

# ---------------------------------------------------------------------------
passo "5. Subindo"
npm run "deploy${ambiente:+:${ambiente}}"

printf '\n  ✓ No ar.\n\n'
printf '     Primeiro acesso: entre com COACH_EMAIL e a senha inicial, e troque-a.\n'
printf '     A conta de manutenção só existe se DEV_LOGIN e DEV_INITIAL_PASSWORD\n'
printf '     estiverem gravados — confira com: npm run secrets:check%s\n\n' "${ambiente:+:${ambiente}}"
