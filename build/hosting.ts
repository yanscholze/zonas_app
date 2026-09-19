/**
 * Os nomes dos bindings do ambiente de desenvolvimento e do artefato.
 *
 * Isto morava em `.openai/hosting.json`, um arquivo de duas chaves deixado pelo
 * andaime da OpenAI. O diretório foi apagado do repositório — com razão, o
 * projeto publica na Cloudflare —, mas duas coisas continuavam dependendo dele:
 * o `vite.config.ts`, que o importava, e o validador do artefato, que exige o
 * manifesto dentro de `dist/`. O build quebrava em qualquer clone novo.
 *
 * Agora é um módulo: o `vite.config.ts` lê os valores daqui e o plugin `sites`
 * escreve o manifesto no artefato a partir da mesma constante. Duas cópias do
 * mesmo fato divergiriam na primeira alteração de binding — foi assim que a
 * configuração embutida do Vite e o `wrangler.jsonc` já se separaram uma vez.
 *
 * O que vale em PRODUÇÃO não está aqui: está no `wrangler.jsonc`, que é o que o
 * deploy lê. Este arquivo descreve o desenvolvimento e o empacotamento.
 */
export const hostingConfig = {
  /** Binding do D1 que o worker enxerga como `env.DB`. */
  d1: "DB",
  /** Não há bucket R2 neste projeto. */
  r2: null,
} as const;
