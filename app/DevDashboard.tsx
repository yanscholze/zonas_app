"use client";

import { useCallback, useEffect, useState } from "react";
import { api, copyText, describeError } from "./api-client";
import { signOut, type Session } from "./AuthGate";
import { avise, pergunte, CentralDeAvisos } from "./avisos";

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
type Erro = { id: string; area: string; error_code: string; method: string; status_code: number; created_at: number; route?: string | null; message?: string | null; stack?: string | null; actor_role?: string | null };
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

type Treinador = { id: string; email: string; name: string; status: string; last_login_at: number | null; alunos_ativos: number };
type Visita = { email: string; name: string; userId: string } | null;


/**
 * Um erro, inteiro, numa tela só.
 *
 * A tabela mostrava área, código e status — dava para saber que algo falhou e
 * não o quê. A pilha é o que aponta o arquivo e a linha, e tem dezenas de
 * linhas: não cabe numa célula sem tornar a lista ilegível. Por isso abre numa
 * tela própria, com o texto preservado como veio.
 */
function ErroAberto({ erro, fechar }: { erro: Erro; fechar: () => void }) {
  /* Esc fecha. Quem está investigando um erro chega aqui de teclado, lê e sai —
     obrigar a mirar o botão no canto atrapalha justamente esse uso. */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === "Escape") fechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fechar]);

  const texto = [
    `${new Date(Number(erro.created_at)).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "medium" })}`,
    `${erro.method} ${erro.route ?? "(rota não registrada)"} → ${erro.status_code} ${erro.error_code}`,
    `área: ${erro.area} · quem chamou: ${erro.actor_role ?? "—"}`,
    "",
    erro.message ?? "(sem mensagem registrada)",
    erro.stack ?? "",
  ].join("\n").trim();

  const copiar = async () => {
    if (await copyText(texto)) avise("ok", "Erro copiado", "Cole onde precisar investigar.");
    else avise("erro", "Não foi possível copiar", "Selecione o texto na tela e copie à mão.");
  };

  return <div className="overlay" onMouseDown={evento => evento.target === evento.currentTarget && fechar()}>
    <aside className="drawer erro-aberto" role="dialog" aria-modal="true" aria-label={`Erro ${erro.error_code}`}>
      <header>
        <div>
          <small>ERRO REGISTRADO</small>
          <h2>{erro.error_code.replaceAll("_", " ")}</h2>
          <p>{erro.area}</p>
        </div>
        <button onClick={fechar} aria-label="Fechar">×</button>
      </header>

      <dl className="erro-fatos">
        <div><dt>Quando</dt><dd>{new Date(Number(erro.created_at)).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "medium" })}</dd></div>
        <div><dt>Rota</dt><dd><code>{erro.method} {erro.route ?? "(não registrada — erro anterior a este log)"}</code></dd></div>
        <div><dt>Retorno</dt><dd>{erro.status_code} · <code>{erro.error_code}</code></dd></div>
        <div><dt>Quem chamou</dt><dd>{erro.actor_role ?? "—"}</dd></div>
      </dl>

      <section>
        <b>Mensagem</b>
        <pre>{erro.message ?? "Sem mensagem registrada. Este erro é anterior ao log detalhado."}</pre>
      </section>

      {erro.stack && <section>
        <b>Onde aconteceu</b>
        <pre className="erro-pilha">{erro.stack}</pre>
      </section>}

      <footer>
        <button className="dev-copiar" onClick={() => void copiar()}>Copiar tudo</button>
        <button onClick={fechar}>Fechar</button>
      </footer>
    </aside>
  </div>;
}

export default function DevDashboard({ session, onExit }: { session: Session; onExit: (visitando: Visita) => void }) {
  const [treinadores, setTreinadores] = useState<Treinador[]>([]);
  const [visitando, setVisitando] = useState<Visita>(null);
  const [semDono, setSemDono] = useState(0);
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState({ name: "", email: "" });
  const [senhaNova, setSenhaNova] = useState<{ email: string; senha: string } | null>(null);
  /* O erro abre numa tela própria em vez de esticar a linha da tabela: a pilha
     tem dezenas de linhas e não cabe numa célula sem tornar a lista ilegível. */
  const [erroAberto, setErroAberto] = useState<Erro | null>(null);
  const [dados, setDados] = useState<Diagnostico | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"resumo" | "contas" | "erros" | "seguranca" | "banco">("resumo");
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      const [diagnostico, carteiras] = await Promise.all([
        api.get<Diagnostico>("/api/dev/overview"),
        api.get<{ coaches: Treinador[]; visitando: Visita; alunosSemDono: number }>("/api/dev/coaches"),
      ]);
      setDados(diagnostico);
      setTreinadores(carteiras.coaches || []);
      setVisitando(carteiras.visitando ?? null);
      setSemDono(carteiras.alunosSemDono ?? 0);
      setErro("");
    }
    catch (e) { setErro(describeError(e, "Não foi possível carregar o diagnóstico.")); }
    finally { setAtualizando(false); }
  }, []);

  /** Entrar na área de um treinador: o recorte dos dados é decidido no servidor. */
  const visitar = async (email: string) => {
    try {
      const r = await api.post<{ visitando: Visita }>("/api/dev/coaches", { action: "visit", email });
      setVisitando(r.visitando ?? null);
      onExit(r.visitando ?? null);
    } catch (e) { setErro(describeError(e, "Não foi possível abrir a área deste treinador.")); }
  };

  /**
   * Ações da manutenção sobre uma conta.
   *
   * Excluir é a única sem volta, e o servidor recusa quando a conta ainda é
   * dona de alguma coisa. A recusa vem com motivo e saída, e é isso que a tela
   * mostra — "não foi possível" sozinho obrigaria a adivinhar.
   */
  const acaoNaConta = async (conta: Conta, acao: "reset_password" | "block" | "unblock" | "delete" | "promote" | "demote") => {
    const rotulos = {
      promote: { titulo: `Tornar ${conta.email} proprietário?`, descricao: "Ele passa a criar treinadores e conferir a área deles, sem alcançar este diagnóstico. As sessões abertas caem para o novo papel valer agora.", confirmar: "Promover", perigo: false },
      demote: { titulo: `${conta.email} volta a ser treinador comum?`, descricao: "Ele perde a aba Equipe e deixa de criar treinadores. Os alunos e as planilhas dele continuam onde estão.", confirmar: "Rebaixar", perigo: true },
      reset_password: { titulo: `Gerar nova senha temporária para ${conta.email}?`, descricao: "A senha atual deixa de valer na hora e as sessões abertas caem. A nova aparece uma única vez.", confirmar: "Gerar senha", perigo: false },
      block: { titulo: `Bloquear ${conta.email}?`, descricao: "A conta perde o acesso imediatamente e as sessões abertas caem. Pode ser liberada depois.", confirmar: "Bloquear conta", perigo: true },
      unblock: { titulo: `Liberar ${conta.email}?`, descricao: "A conta volta a entrar com a senha que já tinha.", confirmar: "Liberar conta", perigo: false },
      delete: { titulo: `Excluir ${conta.email}?`, descricao: "A conta é apagada e não há como desfazer. O servidor recusa se ela ainda for dona de alunos.", confirmar: "Excluir definitivamente", perigo: true },
    }[acao];
    if (!await pergunte(rotulos)) return;
    try {
      const promocao = acao === "promote" || acao === "demote";
      const r = await api.post<{ temporaryPassword?: string; status?: string; deleted?: boolean }>("/api/dev/accounts",
        promocao ? { action: "set_role", email: conta.email, role: acao === "promote" ? "owner" : "coach" } : { action: acao, email: conta.email });
      if (r.temporaryPassword) setSenhaNova({ email: conta.email, senha: r.temporaryPassword });
      else avise("ok", acao === "delete" ? "Conta excluída" : "Conta atualizada", `${conta.email}${r.status ? ` · ${r.status}` : ""}`);
      await carregar();
    } catch (e) {
      const detalhe = (e as { details?: { motivo?: string; saida?: string } }).details;
      avise("erro", detalhe?.motivo ? "Não é possível excluir esta conta" : "Não foi possível concluir",
        detalhe?.motivo ? `${detalhe.motivo} ${detalhe.saida ?? ""}`.trim() : describeError(e, "Tente novamente em alguns instantes."));
    }
  };

  const criarTreinador = async () => {
    if (novo.name.trim().length < 3 || !novo.email.includes("@")) {
      setErro("Informe nome e e-mail do treinador."); return;
    }
    try {
      const r = await api.post<{ email: string; temporaryPassword: string }>("/api/dev/coaches", { action: "create", ...novo });
      setSenhaNova({ email: r.email, senha: r.temporaryPassword });
      setNovo({ name: "", email: "" }); setCriando(false); setErro("");
      await carregar();
    } catch (e) { setErro(describeError(e, "Não foi possível criar o treinador.")); }
  };

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
          <button onClick={() => onExit(visitando)}>Ir para o painel do treinador →</button>
          <button className="dev-signout" onClick={() => void signOut()}>Sair</button>
        </div>
      </header>

      {erro && <p className="dev-error">{erro}</p>}

      <nav className="dev-tabs">
        {([
          ["resumo", "Resumo"],
          ["erros", `Erros${dados?.saude.errosUltimas24h ? ` (${dados.saude.errosUltimas24h})` : ""}`],
          ["contas", `Contas${dados?.contas.length ? ` (${dados.contas.length})` : ""}`],
          ["seguranca", "Segurança"],
          ["banco", "Banco"],
        ] as const).map(([chave, rotulo]) => (
          <button key={chave} className={aba === chave ? "active" : ""} onClick={() => setAba(chave)}>{rotulo}</button>
        ))}
      </nav>

      {!dados ? <p className="dev-loading">Carregando diagnóstico…</p> : <>
        {aba === "resumo" && <>
          <section className="dev-panel dev-coaches">
            <h2>Áreas de treinador</h2>
            <p className="dev-hint">
              Abra a área de um treinador para vê-la exatamente como ele vê. Cada um enxerga apenas os
              próprios alunos; quem age continua sendo esta conta, e a visita fica registrada.
            </p>

            {visitando && <div className="dev-visiting">
              Visitando <b>{visitando.name}</b>
              <button onClick={() => onExit(visitando)}>Abrir a área →</button>
            </div>}

            <div className="dev-coach-grid">
              {treinadores.map(t => (
                <article key={t.id} className={visitando?.email === t.email ? "atual" : ""}>
                  <b>{t.name}</b>
                  <small>{t.email}</small>
                  <span>{t.alunos_ativos} aluno(s) ativo(s){t.status !== "Ativo" ? ` · ${t.status}` : ""}</span>
                  <button onClick={() => void visitar(t.email)}>
                    {visitando?.email === t.email ? "Abrir novamente" : "Entrar nesta área"}
                  </button>
                </article>
              ))}
              <article className="dev-coach-novo">
                {criando ? <>
                  <input value={novo.name} onChange={e => setNovo({ ...novo, name: e.target.value })} placeholder="Nome do treinador" />
                  <input type="email" value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} placeholder="email@exemplo.com" />
                  <div>
                    <button onClick={() => void criarTreinador()}>Criar</button>
                    <button onClick={() => { setCriando(false); setNovo({ name: "", email: "" }); }}>Cancelar</button>
                  </div>
                </> : <button onClick={() => setCriando(true)}>+ Novo treinador</button>}
              </article>
            </div>

            {senhaNova && <p className="dev-senha">
              Senha temporária de <b>{senhaNova.email}</b>: <code>{senhaNova.senha}</code> — aparece uma única vez.
              <button onClick={() => setSenhaNova(null)}>Já anotei</button>
            </p>}

            {semDono > 0 && <p className="dev-hint">{semDono} aluno(s) ainda sem treinador dono.</p>}
          </section>

          {/* Cada número leva à tela onde ele é detalhado: um indicador que não
              abre nada obriga a procurar no menu o que já estava à vista. */}
          <section className="dev-cards">
            <button className={semErros ? "ok" : "alerta"} onClick={() => setAba("erros")}>
              <small>ERROS · 24 H</small>
              <b>{saude?.errosUltimas24h}</b>
              <span>{semErros ? "nenhuma falha registrada" : "requer atenção"} →</span>
            </button>
            <button onClick={() => setAba("contas")}>
              <small>SESSÕES ATIVAS</small>
              <b>{saude?.sessoesAtivas}</b>
              <span>logins válidos agora{(saude?.sessoesAtivas ?? 0) > dados.sessoes.length ? ` · tabela mostra ${dados.sessoes.length}` : ""} →</span>
            </button>
            <button onClick={() => setAba("contas")}>
              <small>CONTAS</small>
              <b>{dados.contas.length}</b>
              <span>{saude?.contasBloqueadas} bloqueada(s) →</span>
            </button>
            <button onClick={() => document.getElementById("dev-ambiente")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <small>INTEGRAÇÕES</small>
              <b>{saude?.integracoesConectadas}</b>
              <span>relógios e aplicativos conectados →</span>
            </button>
          </section>

          <section className="dev-panel" id="dev-ambiente">
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
          <p className="dev-hint">Registrados pelo Worker. Abra um erro para ver a mensagem e a pilha, com arquivo e linha. Nunca entra dado de aluno; de quem chamou fica só o papel. A tabela mostra as 80 ocorrências mais recentes; o cartão do resumo conta todas as últimas 24 horas.</p>
          {dados.erros.length === 0 ? <p className="dev-empty">Nenhum erro registrado.</p> : (
            <table className="dev-table">
              <thead><tr><th>Quando</th><th>Área</th><th>Código</th><th>Rota</th><th>Status</th><th></th></tr></thead>
              <tbody>{dados.erros.map(e => (
                <tr key={e.id}>
                  <td title={quando(e.created_at)}>{relativo(e.created_at)}</td>
                  <td>{e.area}</td>
                  <td><code>{e.error_code}</code></td>
                  <td><code>{e.method} {e.route ?? "—"}</code></td>
                  <td><span className={`dev-status s${String(e.status_code)[0]}`}>{e.status_code}</span></td>
                  <td className="dev-acoes"><button onClick={() => setErroAberto(e)}>Abrir</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>}

        {aba === "contas" && <>
          <section className="dev-panel">
            <h2>Todas as contas</h2>
            <table className="dev-table">
              <thead><tr><th>Papel</th><th>Login</th><th>Nome</th><th>Aluno</th><th>Situação</th><th>Último acesso</th><th>Falhas</th><th>Ações</th></tr></thead>
              <tbody>{dados.contas.map(c => (
                <tr key={c.id}>
                  <td><span className="dev-role" data-papel={c.role}>{c.role}</span></td>
                  <td>{c.email}</td>
                  <td>{c.name}</td>
                  <td>{c.athlete_name || "—"}</td>
                  <td>{c.status}{Number(c.must_change_password) === 1 ? " · senha temporária" : ""}</td>
                  <td>{quando(c.last_login_at)}</td>
                  <td>{c.failed_attempts || 0}{c.locked_until ? " · travada" : ""}</td>
                  <td className="dev-acoes">
                    <button onClick={() => void acaoNaConta(c, "reset_password")}>Nova senha</button>
                    {c.role === "coach" && <button onClick={() => void acaoNaConta(c, "promote")}>Tornar proprietário</button>}
                    {c.role === "owner" && <button onClick={() => void acaoNaConta(c, "demote")}>Rebaixar a treinador</button>}
                    {c.status === "Bloqueado"
                      ? <button onClick={() => void acaoNaConta(c, "unblock")}>Liberar</button>
                      : <button onClick={() => void acaoNaConta(c, "block")}>Bloquear</button>}
                    <button className="dev-excluir" onClick={() => void acaoNaConta(c, "delete")}>Excluir</button>
                  </td>
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
      {erroAberto && <ErroAberto erro={erroAberto} fechar={() => setErroAberto(null)} />}
      <CentralDeAvisos />
    </main>
  );
}
