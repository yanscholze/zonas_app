"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallApp({inline=false}:{inline?:boolean}) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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

  if (installed) return null;
  const install = async () => {
    if (!promptEvent) { setShowHelp(value => !value); return; }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPromptEvent(null);
  };

  return <aside className={`install-app-card ${inline?"install-app-inline":""}`} aria-label="Instalar ZonasApp">
    <button onClick={install}>{inline?"Instalar ZonasApp no meu aparelho ↓":"↓ Instalar ZonasApp"}</button>
    {showHelp && <div><b>Instale como aplicativo</b><p><strong>Android ou computador:</strong> abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</p><p><strong>iPhone:</strong> no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p><button onClick={() => setShowHelp(false)}>Fechar</button></div>}
  </aside>;
}
