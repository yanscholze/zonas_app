"use client";

import { useEffect, useSyncExternalStore } from "react";

/* ---------------------------------------------------------------------------
   Avisos e confirmações dentro da interface.

   O produto avisava e perguntava por `window.alert` e `window.confirm`. Além de
   não terem a aparência do ZonasApp, esses diálogos podem ser suprimidos pelo
   navegador: depois que o Chrome oferece "impedir que esta página crie caixas
   de diálogo adicionais" e o usuário aceita, todo `confirm` seguinte devolve
   "não" na hora e sem aparecer nada. Era exatamente isso que fazia o botão
   "Liberar semana para o aluno" parar de responder — a rotina no servidor
   estava certa, mas a pergunta que a precede nunca chegava à tela.

   Aqui aviso e confirmação são parte da página, e por isso não dependem de
   permissão do navegador nem somem sem deixar rastro.
   ------------------------------------------------------------------------- */

type TomDoAviso = "erro" | "atencao" | "ok";
type AvisoNaTela = { id: number; tom: TomDoAviso; titulo: string; detalhe?: string; saindo?: boolean };
type PedidoDeConfirmacao = {
  id: number;
  titulo: string;
  descricao?: string;
  linhas?: string[];
  resumo?: string;
  historico?: string[];
  confirmar: string;
  perigo?: boolean;
  resolver: (aceitou: boolean) => void;
};

/* Espelha `--dur-base` do CSS. Quem reduz o movimento não espera: a animação é
   desligada por `prefers-reduced-motion` e o aviso some de imediato. */
const DURACAO_DA_SAIDA = 180;

let proximoAviso = 1;
let avisosNaTela: AvisoNaTela[] = [];
let confirmacaoNaTela: PedidoDeConfirmacao | null = null;
const ouvintesDeAviso = new Set<() => void>();
const notificaOuvintes = () => ouvintesDeAviso.forEach(ouvinte => ouvinte());
const inscreveOuvinte = (ouvinte: () => void) => {
  ouvintesDeAviso.add(ouvinte);
  return () => { ouvintesDeAviso.delete(ouvinte); };
};

/** Mostra um aviso na interface. Substitui `window.alert`. */
export function avise(tom: TomDoAviso, titulo: string, detalhe?: string) {
  avisosNaTela = [...avisosNaTela, { id: proximoAviso++, tom, titulo, detalhe }];
  notificaOuvintes();
}

/** Pergunta na interface e devolve a resposta. Substitui `window.confirm`. */
export function pergunte(pedido: Omit<PedidoDeConfirmacao, "id" | "resolver">): Promise<boolean> {
  return new Promise(resolver => {
    confirmacaoNaTela = { ...pedido, id: proximoAviso++, resolver };
    notificaOuvintes();
  });
}

/**
 * Onde os avisos e a confirmação aparecem.
 *
 * Fica montado uma única vez, na raiz da área do treinador: qualquer tela chama
 * `avise` ou `pergunte` sem precisar carregar estado próprio.
 */
export function CentralDeAvisos() {
  const avisos = useSyncExternalStore(inscreveOuvinte, () => avisosNaTela, () => avisosNaTela);
  const pedido = useSyncExternalStore(inscreveOuvinte, () => confirmacaoNaTela, () => confirmacaoNaTela);

  /* Fechar em dois tempos. O aviso sumia no mesmo quadro do clique, e com vários
     empilhados os de baixo saltavam para cima sem que se enxergasse qual tinha
     saído. Agora ele é marcado como saindo, a animação corre, e só então some da
     lista — o salto vira deslizamento.

     O tempo aqui e a duração no CSS são a mesma coisa dita duas vezes: se
     mudarem, mudam juntos. `--dur-base` é o valor de referência. */
  const fecharAviso = (id: number) => {
    if (avisosNaTela.some(item => item.id === id && item.saindo)) return;
    avisosNaTela = avisosNaTela.map(item => item.id === id ? { ...item, saindo: true } : item);
    notificaOuvintes();
    window.setTimeout(() => {
      avisosNaTela = avisosNaTela.filter(item => item.id !== id);
      notificaOuvintes();
    }, DURACAO_DA_SAIDA);
  };
  const responder = (aceitou: boolean) => {
    const atual = confirmacaoNaTela;
    confirmacaoNaTela = null;
    notificaOuvintes();
    atual?.resolver(aceitou);
  };

  /* Um aviso que não some sozinho vira ruído permanente; um erro que some cedo
     demais não chega a ser lido. Oito segundos cobrem os dois casos, e o × está
     sempre disponível para quem quiser fechar antes. */
  useEffect(() => {
    if (!avisos.length) return;
    const relogio = window.setTimeout(() => fecharAviso(avisos[0].id), 8000);
    return () => window.clearTimeout(relogio);
  }, [avisos]);

  useEffect(() => {
    if (!pedido) return;
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === "Escape") responder(false); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  return <>
    {avisos.length > 0 && <div className="avisos-do-sistema" role="status" aria-live="polite">
      {avisos.map(item => <article key={item.id} className={`${item.tom}${item.saindo ? " saindo" : ""}`}>
        <div><b>{item.titulo}</b>{item.detalhe && <span>{item.detalhe}</span>}</div>
        <button onClick={() => fecharAviso(item.id)} aria-label="Fechar aviso">×</button>
      </article>)}
    </div>}

    {pedido && <div className="overlay overlay-centro" onMouseDown={evento => evento.target === evento.currentTarget && responder(false)}>
      <section className="confirmacao-sistema" role="dialog" aria-modal="true" aria-labelledby="confirmacao-titulo">
        <header>
          <h2 id="confirmacao-titulo">{pedido.titulo}</h2>
          {pedido.descricao && <p>{pedido.descricao}</p>}
        </header>
        {pedido.linhas && pedido.linhas.length > 0 && <ul className="confirmacao-linhas">
          {pedido.linhas.map((linha, indice) => <li key={indice}>{linha}</li>)}
        </ul>}
        {pedido.resumo && <p className="confirmacao-resumo">{pedido.resumo}</p>}
        {pedido.historico && pedido.historico.length > 0 && <details className="confirmacao-historico">
          <summary>Histórico recente desta semana</summary>
          <ul>{pedido.historico.map((linha, indice) => <li key={indice}>{linha}</li>)}</ul>
        </details>}
        <footer>
          <button className="outline" onClick={() => responder(false)}>Cancelar</button>
          <button className={pedido.perigo ? "danger-confirm" : "gold"} onClick={() => responder(true)}>{pedido.confirmar}</button>
        </footer>
      </section>
    </div>}
  </>;
}
