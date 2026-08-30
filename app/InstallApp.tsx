"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * O convite flutuante fica fixo no canto inferior direito e só saía da tela
 * quando o aplicativo era mesmo instalado. Quem usa o ZonasApp pelo navegador
 * ficava com aquele canto coberto para sempre — no painel do treinador ele
 * cobria a conferência automática, e no celular o cabeçalho da Central de
 * avisos. Agora o convite pode ser dispensado, e a escolha vale pelo tempo da
 * sessão do navegador: some agora e volta a ser oferecido quando a pessoa
 * abrir o ZonasApp de novo.
 */
const DISMISSED_KEY = "zonasapp:install-dismissed";

export default function InstallApp({inline=false}:{inline?:boolean}) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  /* Sessão e instalação só são conhecidas no navegador. Sem esperar o primeiro
     efeito, o cartão já dispensado voltaria a piscar na tela a cada abertura. */
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let registration: ServiceWorkerRegistration | null = null;
    const checkForUpdates = () => registration?.update().catch(() => undefined);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(value => {
      registration = value;
      checkForUpdates();
    }).catch(() => undefined);
    window.addEventListener("focus", checkForUpdates);
    const updateTimer = window.setInterval(checkForUpdates, 60 * 60 * 1000);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    try { setDismissed(sessionStorage.getItem(DISMISSED_KEY) === "1"); } catch {}
    setMounted(true);
    const ready = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent); };
    const done = () => { setInstalled(true); setPromptEvent(null); setShowHelp(false); };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("focus", checkForUpdates);
      window.clearInterval(updateTimer);
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (!mounted || installed) return null;
  /* O convite dentro da página não cobre nada e é o lugar próprio de oferecer a
     instalação, então a dispensa vale apenas para o cartão flutuante. */
  if (dismissed && !inline) return null;
  const install = async () => {
    if (!promptEvent) { setShowHelp(value => !value); return; }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPromptEvent(null);
  };
  const dismiss = () => {
    setDismissed(true);
    setShowHelp(false);
    try { sessionStorage.setItem(DISMISSED_KEY, "1"); } catch {}
  };

  return <aside className={`install-app-card ${inline?"install-app-inline":""}`} aria-label="Instalar ZonasApp">
    <button onClick={install}>{inline?"Instalar ZonasApp no meu aparelho ↓":"↓ Instalar ZonasApp"}</button>
    {!inline && <button className="install-app-dismiss" onClick={dismiss} title="Dispensar o convite" aria-label="Dispensar o convite para instalar">×</button>}
    {showHelp && <div><b>Instale como aplicativo</b><p><strong>Android ou computador:</strong> abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</p><p><strong>iPhone:</strong> no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p><button onClick={() => setShowHelp(false)}>Fechar</button></div>}
  </aside>;
}
