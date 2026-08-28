"use client";

import AuthGate from "./AuthGate";
import ZonasAppClient from "./ZonasAppClient";
import StudentEntry from "./StudentEntry";

/**
 * Decide qual aplicação montar depois que a sessão está resolvida: o painel do
 * treinador ou a área do aluno. Alunos aprovados caem direto na sua área;
 * quem se cadastrou mas ainda não foi liberado vê a tela de espera.
 */
export default function AppRoot() {
  return (
    <AuthGate>
      {(session) =>
        session.role === "coach"
          ? <ZonasAppClient session={session} />
          : <StudentEntry session={session} />
      }
    </AuthGate>
  );
}
