import AppRoot from "./AppRoot";

export const dynamic = "force-dynamic";

/**
 * A identidade agora vem da sessão em cookie da própria Zonas-App, resolvida
 * no cliente pelo `AuthGate`. A página em si não precisa mais consultar
 * cabeçalhos de autenticação injetados por uma plataforma externa.
 */
export default function Page() {
  return <AppRoot />;
}
