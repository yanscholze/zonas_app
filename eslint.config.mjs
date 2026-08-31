import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cópias do projeto criadas pelas sessões de fundo. São o mesmo código de
    // novo: sem isto, o lint do projeto reporta cada problema uma vez por
    // cópia e o total deixa de dizer alguma coisa.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
