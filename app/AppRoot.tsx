"use client";

import { useState } from "react";
import AuthGate from "./AuthGate";
import ZonasAppClient from "./ZonasAppClient";
import StudentEntry from "./StudentEntry";
import DevDashboard from "./DevDashboard";

/**
 * Decide qual aplicação montar depois que a sessão está resolvida.
 *
 * A conta de manutenção abre no diagnóstico, mas alcança o painel do treinador
 * pelo mesmo lugar — precisa ver o sistema como o cliente vê para conferir se
 * um problema é real.
 */
export default function AppRoot() {
  const [modoTreinador, setModoTreinador] = useState(false);
  const [visitando, setVisitando] = useState<{ name: string; email: string } | null>(null);

  return (
    <AuthGate>
      {(session) => {
        if (session.role === "dev") {
          return modoTreinador
            ? <ZonasAppClient session={session} onLeaveDev={() => setModoTreinador(false)} visitando={visitando} />
            : <DevDashboard session={session} onExit={(alvo) => { setVisitando(alvo); setModoTreinador(true); }} />;
        }
        /* O proprietário abre no painel do treinador, porque é o que ele é. A
           diferença dele — criar e conferir a equipe — aparece como mais uma
           seção lá dentro, não como um painel à parte: manter dois painéis
           quase iguais foi o erro que já corrigimos uma vez. */
        return session.role === "coach" || session.role === "owner"
          ? <ZonasAppClient session={session} />
          : <StudentEntry session={session} />;
      }}
    </AuthGate>
  );
}
