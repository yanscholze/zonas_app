/**
 * Gera o arquivo de importação a partir das planilhas de fábrica.
 *
 * O formato é o mesmo que a rota de importação aceita, e é deliberadamente
 * simples: uma lista de planilhas, cada uma com as semanas dentro. Não carrega
 * id, dono nem data — esses são de quem importa, não de quem exportou, e aceitar
 * id de fora deixaria um arquivo sobrescrever a planilha de outra pessoa.
 *
 *   node scripts/exporta-planilhas.mjs                    escreve planilhas-zonasapp.json
 *   node scripts/exporta-planilhas.mjs meu-arquivo.json   escolhe o nome
 */
import { writeFile } from "node:fs/promises";
import { trainingPlans, planWeekTemplates } from "../db/planilhas-de-fabrica.ts";

const destino = process.argv[2] || "planilhas-zonasapp.json";

const plans = trainingPlans.map(plano => ({
  name: plano.name,
  distance: plano.distance,
  weeks: plano.weeks,
  frequency: plano.frequency,
  level: plano.level,
  goal: plano.goal,
  phases: plano.phases,
  /* As semanas com os treinos montados. A chave é o número da semana; o valor,
     a lista de treinos daquela semana no mesmo formato que a tela edita. */
  weeksContent: planWeekTemplates[plano.name] ?? {},
}));

const arquivo = {
  formato: "zonasapp-planilhas",
  versao: 1,
  geradoEm: new Date().toISOString(),
  plans,
};

await writeFile(destino, `${JSON.stringify(arquivo, null, 2)}\n`);

const semanas = plans.reduce((total, p) => total + Object.keys(p.weeksContent).length, 0);
const treinos = plans.reduce((total, p) => total + Object.values(p.weeksContent).reduce((n, s) => n + s.length, 0), 0);
const tamanho = (await import("node:fs")).statSync(destino).size;

console.log(`\n  ${destino}`);
console.log(`  ${plans.length} planilhas · ${semanas} semanas · ${treinos} treinos · ${(tamanho / 1024).toFixed(0)} KB\n`);
for (const p of plans) {
  console.log(`    ${p.name.padEnd(16)} ${String(p.weeks).padStart(2)} semanas   ${Object.keys(p.weeksContent).length} montadas`);
}
console.log();
