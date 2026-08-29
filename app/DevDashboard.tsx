"use client";

import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "./api-client";
import { signOut, type Session } from "./AuthGate";

/**
 * Painel de manutenção.
 *
 * Existe para responder rápido a "o que está acontecendo com o sistema" sem
 * abrir o banco: erros recentes, quem está logado, o volume de cada tabela e o
 * que o ambiente tem configurado. Não substitui a área do treinador — a conta
 * de manutenção também alcança o painel normal, e alterna entre os dois.
 */

type Conta = {
  id: string; email: string; name: string; role: string; athlete_name: string | null;
  status: string; must_change_password: number; failed_attempts: number;
  locked_until: number | null; last_login_at: number | null; created_at: number;
};
type Sessao = { email: string; role?: string; created_at: number; last_seen_at: number; expires_at: number };
type Erro = { id: string; area: string; error_code: string; method: string; status_code: number; created_at: number };
type Evento = { id: string; actor_email: string; event_type: string; route: string; details: string; created_at: number };
type Limite = { actor_email: string; route: string; method: string; request_count: number; window_start: number };
type Provedor = { id: string; label: string; disponivel: boolean; estado: string };

type Diagnostico = {
  generatedAt: number;
  saude: { errosUltimas24h: number; contasBloqueadas: number; sessoesAtivas: number; integracoesConectadas: number };
  ambiente: { coachEmailConfigurado: boolean; devLoginConfigurado: boolean; chaveDeCifraConfigurada: boolean; provedores: Provedor[] };
  contas: Conta[];
  sessoes: Sessao[];
  erros: Erro[];
  eventos: Evento[];
  limites: Limite[];
  atividadesPorProvedor: Array<{ provider: string; total: number; ultima: number }>;
  volumes: Record<string, number>;
};

const quando = (ms?: number | null) =>
  ms ? new Date(Number(ms)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const relativo = (ms: number) => {
  const minutos = Math.round((Date.now() - Number(ms)) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min atrás`;
  const horas = Math.round(minutos / 60);
  return horas < 24 ? `${horas} h atrás` : `${Math.round(horas / 24)} d atrás`;
};

export default function DevDashboard({ session, onExit }: { session: Session; onExit: () => void }) {
  const [dados, setDados] = useState<Diagnostico | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"resumo" | "contas" | "erros" | "seguranca" | "banco">("resumo");
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try { setDados(await api.get<Diagnostico>("/api/dev/overview")); setErro(""); }
    catch (e) { setErro(describeError(e, "Não foi possível carregar o diagnóstico.")); }
    finally { setAtualizando(false); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const saude = dados?.saude;
  const semErros = (saude?.errosUltimas24h ?? 0) === 0;

  return (
    <main className="dev-shell">
      <header className="dev-top">
        <div className="dev-brand">
          <span>DEV</span>
          <div>
            <strong>Manutenção</strong>
            <small>{session.email} · acesso irrestrito</small>
          </div>
        </div>
        <div className="dev-top-actions">
          <button onClick={() => void carregar()} disabled={atualizando}>
            {atualizando ? "Atualizando…" : "↻ Atualizar"}
          </button>
          <button onClick={onExit}>Ir para o painel do treinador →</button>
          <button className="dev-signout" onClick={() => void signOut()}>Sair</button>
        </div>
      </header>

      {erro && <p className="dev-error">{erro}</p>}

      <nav className="dev-tabs">
        {([
          ["resumo", "Resumo"],
          ["erros", `Erros${dados?.erros.length ? ` (${dados.erros.length})` : ""}`],
          ["contas", `Contas${dados?.contas.length ? ` (${dados.contas.length})` : ""}`],
          ["seguranca", "Segurança"],
          ["banco", "Banco"],
        ] as const).map(([chave, rotulo]) => (
          <button key={chave} className={aba === chave ? "active" : ""} onClick={() => setAba(chave)}>{rotulo}</button>
        ))}
      </nav>

      {!dados ? <p className="dev-loading">Carregando diagnóstico…</p> : <>
        {aba === "resumo" && <>
          <section className="dev-cards">
            <article className={semErros ? "ok" : "alerta"}>
              <small>ERROS · 24 H</small>
              <b>{saude?.errosUltimas24h}</b>
              <span>{semErros ? "nenhuma falha registrada" : "requer atenção"}</span>
            </article>
            <article>
              <small>SESSÕES ATIVAS</small>
              <b>{saude?.sessoesAtivas}</b>
              <span>logins válidos agora</span>
            </article>
            <article>
              <small>CONTAS</small>
              <b>{dados.contas.length}</b>
              <span>{saude?.contasBloqueadas} bloqueada(s)</span>
            </article>
            <article>
              <small>INTEGRAÇÕES</small>
              <b>{saude?.integracoesConectadas}</b>
              <span>com atividade importada</span>
            </article>
          </section>

          <section className="dev-panel">
            <h2>Ambiente</h2>
            <p className="dev-hint">Só a presença de cada variável — o valor nunca sai do servidor.</p>
            <div className="dev-env">
              {[
                ["COACH_EMAIL", dados.ambiente.coachEmailConfigurado],
                ["DEV_LOGIN", dados.ambiente.devLoginConfigurado],
                ["Chave de cifra dos tokens", dados.ambiente.chaveDeCifraConfigurada],
              ].map(([rotulo, ok]) => (
                <span key={String(rotulo)} className={ok ? "sim" : "nao"}>
                  {ok ? "✓" : "✕"} {rotulo}
                </span>
              ))}
            </div>
            <div className="dev-providers">
              {dados.ambiente.provedores.map(p => (
                <article key={p.id} className={p.disponivel ? "pronto" : ""}>
                  <b>{p.label}</b>
                  <small>{p.estado}</small>
                </article>
              ))}
            </div>
          </section>

          {dados.atividadesPorProvedor.length > 0 && <section className="dev-panel">
            <h2>Atividades importadas</h2>
            <table className="dev-table">
              <thead><tr><th>Provedor</th><th>Total</th><th>Mais recente</th></tr></thead>
              <tbody>{dados.atividadesPorProvedor.map(a => (
                <tr key={a.provider}><td>{a.provider}</td><td>{a.total}</td><td>{quando(a.ultima)}</td></tr>
              ))}</tbody>
            </table>
          </section>}
        </>}

        {aba === "erros" && <section className="dev-panel">
          <h2>Erros da aplicação</h2>
          <p className="dev-hint">Registrados pelo Worker. Guardam área, código e status — nunca dado de aluno.</p>
          {dados.erros.length === 0 ? <p className="dev-empty">Nenhum erro registrado.</p> : (
            <table className="dev-table">
              <thead><tr><th>Quando</th><th>Área</th><th>Código</th><th>Método</th><th>Status</th></tr></thead>
              <tbody>{dados.erros.map(e => (
                <tr key={e.id}>
                  <td title={quando(e.created_at)}>{relativo(e.created_at)}</td>
                  <td>{e.area}</td>
                  <td><code>{e.error_code}</code></td>
                  <td>{e.method}</td>
                  <td><span className={`dev-status s${String(e.status_code)[0]}`}>{e.status_code}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>}

        {aba === "contas" && <>
          <section className="dev-panel">
            <h2>Todas as contas</h2>
            <table className="dev-table">
              <thead><tr><th>Papel</th><th>Login</th><th>Nome</th><th>Aluno</th><th>Situação</th><th>Último acesso</th><th>Falhas</th></tr></thead>
              <tbody>{dados.contas.map(c => (
                <tr key={c.id}>
                  <td><span className={`dev-role ${c.role}`}>{c.role}</span></td>
                  <td>{c.email}</td>
                  <td>{c.name}</td>
                  <td>{c.athlete_name || "—"}</td>
                  <td>{c.status}{Number(c.must_change_password) === 1 ? " · senha temporária" : ""}</td>
                  <td>{quando(c.last_login_at)}</td>
                  <td>{c.failed_attempts || 0}{c.locked_until ? " · travada" : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>

          <section className="dev-panel">
            <h2>Sessões ativas</h2>
            <table className="dev-table">
              <thead><tr><th>Login</th><th>Papel</th><th>Última atividade</th><th>Expira</th></tr></thead>
              <tbody>{dados.sessoes.map((s, i) => (
                <tr key={`${s.email}-${i}`}>
                  <td>{s.email}</td>
                  <td>{s.role || "—"}</td>
                  <td title={quando(s.last_seen_at)}>{relativo(s.last_seen_at)}</td>
                  <td>{quando(s.expires_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        </>}

        {aba === "seguranca" && <>
          <section className="dev-panel">
            <h2>Eventos de segurança</h2>
            {dados.eventos.length === 0 ? <p className="dev-empty">Nenhum evento registrado.</p> : (
              <table className="dev-table">
                <thead><tr><th>Quando</th><th>Ator</th><th>Evento</th><th>Rota</th><th>Detalhe</th></tr></thead>
                <tbody>{dados.eventos.map(e => (
                  <tr key={e.id}>
                    <td title={quando(e.created_at)}>{relativo(e.created_at)}</td>
                    <td>{e.actor_email}</td>
                    <td>{e.event_type}</td>
                    <td><code>{e.route}</code></td>
                    <td>{e.details}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="dev-panel">
            <h2>Limite de uso na última hora</h2>
            {dados.limites.length === 0 ? <p className="dev-empty">Nenhuma rota perto do limite.</p> : (
              <table className="dev-table">
                <thead><tr><th>Ator</th><th>Rota</th><th>Método</th><th>Chamadas</th></tr></thead>
                <tbody>{dados.limites.map((l, i) => (
                  <tr key={i}><td>{l.actor_email}</td><td><code>{l.route}</code></td><td>{l.method}</td><td>{l.request_count}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
        </>}

        {aba === "banco" && <section className="dev-panel">
          <h2>Volume por tabela</h2>
          <p className="dev-hint">Um valor de −1 significa que a tabela ainda não existe nesta instalação.</p>
          <div className="dev-volumes">
            {Object.entries(dados.volumes).sort((a, b) => b[1] - a[1]).map(([tabela, total]) => (
              <span key={tabela} className={total < 0 ? "ausente" : total === 0 ? "vazia" : ""}>
                <b>{total < 0 ? "—" : total}</b>
                <small>{tabela}</small>
              </span>
            ))}
          </div>
        </section>}

        <footer className="dev-footer">Diagnóstico gerado em {quando(dados.generatedAt)}</footer>
      </>}
    </main>
  );
}
