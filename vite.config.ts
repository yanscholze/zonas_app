/* O plugin da Cloudflare entra por `import` estático, e isso é deliberado.
   Antes era `await import()` dentro da configuração, para garantir que
   WRANGLER_LOG_PATH valesse antes de o Wrangler fotografar o caminho — mas
   quem define essas três variáveis é `scripts/sites-env.sh`, por onde passam
   build, deploy e lint, então elas já valem quando o node começa.
   O import dinâmico tinha um custo escondido: o `vinext-cloudflare deploy`
   decide se o plugin existe lendo este arquivo como TEXTO, e só enxerga
   `import` estático ou `require`. Ele acusava "Missing @cloudflare/vite-plugin"
   num projeto que tem o plugin e funciona. `require` não serve aqui: o pacote é
   só ESM e não tem entrada CommonJS. */
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};


export default defineConfig(async ({ command }) => {
  /* A configuração embutida abaixo carrega o `database_id` de marcador, que
     serve ao banco local do Miniflare. Ela vale só no `vite` de
     desenvolvimento: no build, quem manda é o `wrangler.jsonc`, que tem o id do
     banco de verdade. Sem esta separação o deploy subiria apontando para o
     marcador — e não falharia no deploy, falharia na primeira consulta, com o
     aplicativo já no ar. */
  const desenvolvimento = command === "serve";

  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        ...(desenvolvimento ? { config: localBindingConfig } : {}),
      }),
    ],
  };
});
