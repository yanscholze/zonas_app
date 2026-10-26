import type { Metadata } from "next";
import "./globals.css";
import InstallApp from "./InstallApp";

export const metadata: Metadata = {
  title: "ZonasApp",
  description: "Plataforma de treinamento de corrida para professores e atletas.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/app-icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
