"use client";

/**
 * Conjunto de ícones da Zonas-App.
 *
 * A navegação usava glifos de texto — ⌂ ◉ □ ▤ ⚑ $ ⌚ ☰ ◇ ↗ — escolhidos por
 * parecerem com o assunto. Isso trazia três problemas concretos:
 *
 * 1. Cada sistema operacional desenha esses caracteres à sua maneira, com peso
 *    e tamanho próprios, então a barra ficava desalinhada fora do Linux.
 * 2. Alguns não têm relação com o que representam: ☰ (menu) marcava "Contas" e
 *    ◇ (losango) marcava "Segurança".
 * 3. Leitores de tela anunciam o caractere, não a função.
 *
 * Aqui são desenhos vetoriais com a mesma malha de 24, o mesmo traço e a mesma
 * terminação, herdando a cor do texto. Ficam ocultos para tecnologia assistiva
 * porque o rótulo ao lado já diz o que o item é.
 */

type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

/** Painel — a visão geral. */
export const IconPainel = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="8" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="11" width="7" height="10" rx="1.5" />
  </svg>
);

/** Cadastros — pessoa entrando. */
export const IconCadastros = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="3.5" />
    <path d="M19 8v6M22 11h-6" />
  </svg>
);

/** Alunos — o grupo. */
export const IconAlunos = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="3.5" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/** Calendário — a semana. */
export const IconCalendario = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

/** Planilhas — o modelo de treino. */
export const IconPlanilhas = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);

/** Testes e zonas — o resultado que sobe. */
export const IconTestes = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 20h18" />
    <path d="M6 20v-5M11 20V9M16 20v-8M21 20V5" />
  </svg>
);

/** Provas — a linha de chegada. */
export const IconProvas = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 21V4" />
    <path d="M5 4h13l-2.5 4L18 12H5" />
  </svg>
);

/** Financeiro — o valor. */
export const IconFinanceiro = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2.5" y="6" width="19" height="13" rx="2" />
    <path d="M2.5 10.5h19" />
    <path d="M6.5 15h3" />
  </svg>
);

/** Integrações — o relógio do atleta. */
export const IconIntegracoes = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="5.5" />
    <path d="M12 9.5V12l1.8 1.2" />
    <path d="M8.5 6.5 9 3h6l.5 3.5M8.5 17.5 9 21h6l.5-3.5" />
  </svg>
);

/** Contas — o acesso de cada aluno. */
export const IconContas = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10.5" r="2.5" />
    <path d="M5.5 17c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7M15.5 9.5H19M15.5 13H19" />
  </svg>
);

/** Segurança — o que está protegido. */
export const IconSeguranca = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.3-7.5 9.5-4.4-1.2-7.5-5.1-7.5-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/** Mais — as seções que não cabem na barra do celular. */
export const IconMais = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

/** Ver como aluno — trocar de ponto de vista. */
export const IconTrocarVisao = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);

/** Sair da conta. */
export const IconSair = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
);

/** Avisos pendentes. */
export const IconAviso = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </svg>
);

/** Um passo adiante — usado em item de lista que abre outra tela. */
export const IconAvancar = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

/** Mapa do menu do professor: cada seção e o seu ícone. */
export function NavIcon({ item, size = 18 }: { item: string; size?: number }) {
  switch (item) {
    case "Painel": return <IconPainel size={size} />;
    case "Cadastros": return <IconCadastros size={size} />;
    case "Alunos": return <IconAlunos size={size} />;
    case "Calendário": return <IconCalendario size={size} />;
    case "Planilhas": return <IconPlanilhas size={size} />;
    case "Testes e zonas": return <IconTestes size={size} />;
    case "Provas": return <IconProvas size={size} />;
    case "Financeiro": return <IconFinanceiro size={size} />;
    case "Integrações": return <IconIntegracoes size={size} />;
    case "Contas": return <IconContas size={size} />;
    case "Segurança": return <IconSeguranca size={size} />;
    case "Equipe": return <IconAlunos size={size} />;
    default: return <IconMais size={size} />;
  }
}
