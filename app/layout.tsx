import type { Metadata } from "next";
import "./globals.css";
import InstallApp from "./InstallApp";

export const metadata: Metadata = {
  title: "ZonasApp",
  description: "Plataforma de treinamento de corrida para professores e atletas.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/app-icon.svg",
    shortcut: "/favicon.svg",
    apple: "/app-icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ZonasApp",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}<InstallApp /></body>
    </html>
  );
}
