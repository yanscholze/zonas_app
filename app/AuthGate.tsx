"use client";

import { useCallback, useEffect, useState } from "react";
import InstallApp from "./InstallApp";

export type Session =
  /** Conta de manutenção: acesso irrestrito, com diagnóstico do sistema. */
  | { authenticated: true; role: "dev"; email: string; name: string; mustChangePassword: boolean }
  /** Proprietário: treinador que também cria e confere os treinadores da equipe. */
  | { authenticated: true; role: "owner"; email: string; name: string; mustChangePassword: boolean }
  | { authenticated: true; role: "coach"; email: string; name: string; mustChangePassword: boolean }
  | { authenticated: true; role: "student"; email: string; name: string; athleteName: string; mustChangePassword: boolean };

type Mode = "login" | "register";

const messages: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  account_blocked: "Este acesso está bloqueado. Fale com o professor.",
  account_temporarily_locked: "Muitas tentativas seguidas. Tente de novo em alguns minutos.",
  too_many_requests: "Muitas tentativas seguidas. Tente de novo em alguns minutos.",
  email_already_registered: "Já existe uma conta com este e-mail. Entre em vez de cadastrar.",
  invalid_email: "Confira o endereço de e-mail.",
  name_too_short: "Escreva seu nome completo.",
  password_too_short: "A senha precisa de pelo menos 8 caracteres.",
  password_too_long: "A senha está longa demais.",
  password_needs_letter_and_number: "A senha precisa misturar letras e números.",
};

const describe = (code: string) => messages[code] ?? "Não foi possível concluir. Tente novamente.";

const MIN_PASSWORD = 8;

/**
 * Porta de entrada da aplicação. Enquanto não houver sessão válida, nada do
 * app é montado — nem a área do treinador, nem a do aluno.
 */
export default function AuthGate({ children }: { children: (session: Session, reload: () => void) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      setSession(response.ok ? await response.json() as Session : null);
    } catch {
      setSession(null);
    }
  }, []);

  // O estado é definido dentro do callback da promessa, e não no corpo do
  // efeito, e a flag evita atualizar depois que o componente sai da tela.
  useEffect(() => {
    let active = true;
    fetch("/api/session", { cache: "no-store" })
      .then(async response => { if (active) setSession(response.ok ? await response.json() as Session : null); })
      .catch(() => { if (active) setSession(null); });
    return () => { active = false; };
  }, []);

  if (session === undefined) {
    return (
      <main className="auth-screen">
        <section className="auth-card auth-loading">
          <span className="auth-mark">Z</span>
          <p>Verificando seu acesso…</p>
        </section>
      </main>
    );
  }

  if (!session) return <SignIn onSignedIn={load} />;
  if (session.mustChangePassword) return <ChangePassword session={session} onChanged={load} />;

  return <>{children(session, load)}</>;
}

/* -------------------------------------------------------------------------- */

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");

  /**
   * A validação acontece aqui, e não desabilitando o botão: um botão que não
   * responde e não explica o motivo é indistinguível de um botão quebrado.
   */
  const validationProblem = () => {
    if (mode === "register" && name.trim().length < 3) return "Escreva seu nome completo.";
    if (!email.includes("@") || !email.includes(".")) return "Confira o endereço de e-mail.";
    if (password.length < MIN_PASSWORD) return `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`;
    return "";
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validationProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setState("sending");
    setError("");
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setError(describe(payload.error ?? ""));
        setState("idle");
        return;
      }
      onSignedIn();
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
      setState("idle");
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <header>
          <span className="auth-mark">Z</span>
          <div>
            <small>{mode === "login" ? "ACESSO À PLATAFORMA" : "PRIMEIRO ACESSO"}</small>
            <h1>{mode === "login" ? "Entrar na Zonas-App" : "Criar seu acesso"}</h1>
            <p>
              {mode === "login"
                ? "Use o e-mail e a senha cadastrados com o professor."
                : "Crie sua conta. O professor libera sua área depois de conferir os dados."}
            </p>
          </div>
        </header>

        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              Nome completo
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                autoComplete="name"
                placeholder="Seu nome completo"
              />
            </label>
          )}
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="voce@email.com"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Mínimo de 8 caracteres"
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={state === "sending"}>
            {state === "sending"
              ? "Enviando…"
              : mode === "login" ? "Entrar" : "Criar acesso →"}
          </button>
        </form>

        <footer>
          {mode === "login" ? (
            <button type="button" onClick={() => { setMode("register"); setError(""); }}>
              Ainda não tenho acesso — quero me cadastrar
            </button>
          ) : (
            <button type="button" onClick={() => { setMode("login"); setError(""); }}>
              Já tenho conta — entrar
            </button>
          )}
          <small>Esqueceu a senha? O professor redefine para você pelo painel.</small>
          {/* A LGPD pede que a política esteja acessível antes do cadastro, não
              só depois de entrar: é aqui que o consentimento começa. */}
          <small className="auth-legal"><a href="/privacy">Política de Privacidade</a> · <a href="/terms">Termos de Uso</a></small>
        </footer>

        <InstallApp inline />
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/** Mostrada logo após o primeiro login com senha temporária. */
function ChangePassword({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword) {
      setError("Digite a senha temporária que você recebeu.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD) {
      setError(`A nova senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (newPassword !== repeated) {
      setError("As duas senhas precisam ser iguais.");
      return;
    }
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setError(describe(payload.error ?? ""));
        setState("idle");
        return;
      }
      onChanged();
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
      setState("idle");
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <header>
          <span className="auth-mark">Z</span>
          <div>
            <small>SEGURANÇA</small>
            <h1>Escolha sua senha</h1>
            <p>Você entrou com uma senha temporária. Defina uma senha só sua para continuar.</p>
          </div>
        </header>

        <form onSubmit={submit}>
          <label>
            Senha temporária
            <input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <label>
            Nova senha
            <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="Mínimo de 8 caracteres, com letras e números" />
          </label>
          <label>
            Repita a nova senha
            <input type="password" value={repeated} onChange={event => setRepeated(event.target.value)} autoComplete="new-password" />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={state === "sending"}>
            {state === "sending" ? "Salvando…" : "Salvar e continuar →"}
          </button>
        </form>

        <footer>
          <small>Entrando como {session.email}</small>
          <button type="button" onClick={() => { void fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(() => window.location.reload()); }}>
            Sair
          </button>
        </footer>
      </section>
    </main>
  );
}

/** Encerra a sessão no servidor e recarrega a aplicação. */
export async function signOut() {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
  window.location.href = "/";
}
