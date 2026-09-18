/**
 * Aplicativo do relógio.
 *
 * Mostra o treino do dia e devolve o resultado quando o aluno termina de correr.
 * A tela existe para ele conferir o que vai fazer — mas não precisa ser aberta:
 * o Side Service empurra o treino e recebe o resultado com o aplicativo fechado.
 */
import { getDeviceInfo } from "@zos/device";
import { createWidget, widget, align, prop, deleteWidget } from "@zos/ui";
import { localStorage } from "@zos/storage";
import { Workout } from "@zos/sensor";
import { BasePage } from "@zeppos/zml/base-page";

const { width: LARGURA } = getDeviceInfo();

/* O treino fica em disco. Sem isso, sair da tela apagaria o que o celular
   mandou, e o aluno abriria o relógio na hora de correr para encontrar nada —
   justamente quando não há celular por perto para buscar de novo. */
const CHAVE_TREINO = "zonasapp_treino";
const CHAVE_PENDENTE = "zonasapp_pendente";

function guardar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* disco cheio: segue em memória */ }
}
function ler(chave) {
  try { const bruto = localStorage.getItem(chave); return bruto ? JSON.parse(bruto) : null; } catch { return null; }
}

/** Ritmo em segundos por km vira "4:30", que é como corredor lê. */
function ritmo(segundos) {
  if (!segundos || !isFinite(segundos)) return "";
  const min = Math.floor(segundos / 60);
  const seg = Math.round(segundos % 60);
  return `${min}:${seg < 10 ? "0" : ""}${seg}`;
}

/** Uma etapa em uma linha, do jeito que se lê correndo: o quanto e em que ritmo. */
function descreverEtapa(etapa) {
  const alvo = etapa.target ? ` · ${ritmo(etapa.target.paceFastSeconds)}–${ritmo(etapa.target.paceSlowSeconds)}/km` : "";
  if (etapa.type === "repeat") {
    const esforco = etapa.effort.meters ? `${etapa.effort.meters} m` : `${Math.round((etapa.effort.seconds || 0) / 60)} min`;
    const alvoEsforco = etapa.effort.target
      ? ` a ${ritmo(etapa.effort.target.paceFastSeconds)}–${ritmo(etapa.effort.target.paceSlowSeconds)}`
      : "";
    const pausa = etapa.recovery.meters ? `${etapa.recovery.meters} m` : `${Math.round((etapa.recovery.seconds || 0) / 60)} min`;
    return `${etapa.repetitions}× ${esforco}${alvoEsforco} · ${pausa} leve`;
  }
  const quanto = etapa.meters ? `${etapa.meters} m` : `${Math.round((etapa.seconds || 0) / 60)} min`;
  return `${etapa.label}: ${quanto}${alvo}`;
}

Page(
  BasePage({
    build() {
      this.widgets = [];
      this.treino = ler(CHAVE_TREINO);
      this.desenhar();
      this.escutarTreinoDoRelogio();

      /* Pede o treino ao abrir em vez de esperar o próximo ciclo de quinze
         minutos. Quem abriu a tela está de tênis no pé. */
      this.request({ method: "BUSCAR_TREINO" })
        .then((dados) => {
          if (!dados || !dados.treino) return;
          this.treino = dados.treino;
          guardar(CHAVE_TREINO, this.treino);
          this.desenhar();
        })
        .catch(() => { /* sem celular por perto: fica o que está em disco */ });

      this.reenviarPendente();
    },

    onDestroy() {
      if (this.workout) { try { this.workout.offChange(); } catch { /* já removido */ } }
    },

    /**
     * O celular empurrando treino novo, sem ninguém ter pedido.
     *
     * É o caminho normal: o Side Service descobre que a semana foi liberada e
     * manda. Se a tela estiver aberta, ela se redesenha na hora.
     */
    onCall(dados) {
      if (!dados || dados.method !== "TREINO") return;
      this.treino = { dia: dados.dia, treino: dados.treino, plano: dados.plano };
      guardar(CHAVE_TREINO, this.treino);
      this.desenhar();
    },

    /* ---------------------------------------------------------------- tela --- */

    /**
     * Redesenha do zero.
     *
     * Apaga os widgets antes de recriar. Sem isso, cada treino novo empilharia
     * texto por cima do anterior — e como a fonte tem fundo transparente, o
     * resultado é ilegível em vez de simplesmente errado.
     */
    desenhar() {
      for (const w of this.widgets) { try { deleteWidget(w); } catch { /* já foi */ } }
      this.widgets = [];

      const pacote = this.treino;
      this.widgets.push(createWidget(widget.TEXT, {
        x: 0, y: 40, w: LARGURA, h: 48,
        text: pacote ? pacote.treino.title : "Sem treino hoje",
        text_size: 26, color: 0xd7aa39, align_h: align.CENTER_H,
      }));

      if (!pacote) {
        this.widgets.push(createWidget(widget.TEXT, {
          x: 20, y: 100, w: LARGURA - 40, h: 120,
          text: "Quando o treinador liberar a semana, o treino aparece aqui sozinho.",
          text_size: 18, color: 0x999999, align_h: align.CENTER_H, text_style: prop.MULTIPLE_LINE,
        }));
        return;
      }

      let y = 100;
      for (const etapa of pacote.treino.steps || []) {
        this.widgets.push(createWidget(widget.TEXT, {
          x: 20, y, w: LARGURA - 40, h: 52,
          text: descreverEtapa(etapa),
          text_size: 17, color: 0xffffff, align_h: align.LEFT, text_style: prop.MULTIPLE_LINE,
        }));
        y += 58;
      }
    },

    /* ------------------------------------------- fim de treino no relógio --- */

    /**
     * Escuta o treino nativo do relógio.
     *
     * O aluno corre pelo aplicativo de esporte do próprio relógio, como sempre
     * fez — não por este. Quando ele encerra, pegamos o que o relógio mediu e
     * mandamos para o celular. É o que torna a sincronização invisível: ninguém
     * muda de hábito.
     */
    escutarTreinoDoRelogio() {
      try {
        this.workout = new Workout();
        this.workout.onChange((estado) => {
          /* 0 = parado. A transição para parado é o fim da atividade. */
          if (estado && estado.status === 0) this.colherResultado();
        });
      } catch {
        /* Relógio sem o sensor de esporte exposto: a tela do treino continua
           valendo, e o envio automático simplesmente não acontece. */
      }
    },

    colherResultado() {
      let ultimo = null;
      try {
        const historico = this.workout.getHistory();
        ultimo = historico && historico.length ? historico[historico.length - 1] : null;
      } catch { return; }
      if (!ultimo) return;

      /* Os nomes são os da nuvem Zepp porque o servidor já sabe lê-los. Inventar
         nomes aqui obrigaria a um segundo normalizador para a mesma informação. */
      const atividade = {
        trackid: String(ultimo.trackid || ultimo.startTime || ""),
        start_time: Math.round((ultimo.startTime || 0) / 1000),
        end_time: Math.round((ultimo.endTime || 0) / 1000),
        type: String(ultimo.type || "run"),
        dis: Number(ultimo.distance) || 0,
        run_time: Number(ultimo.duration) || 0,
        avg_heart_rate: Number(ultimo.avgHeartRate) || null,
        calorie: Number(ultimo.calorie) || null,
        origem: "zepp-os-miniapp",
      };
      if (!atividade.trackid || !atividade.start_time) return;

      /* Guarda ANTES de enviar. Se o celular estiver longe ou sem rede, o treino
         fica esperando em vez de sumir. */
      const pendentes = ler(CHAVE_PENDENTE) || [];
      if (!pendentes.some((a) => a.trackid === atividade.trackid)) {
        pendentes.push(atividade);
        guardar(CHAVE_PENDENTE, pendentes);
      }
      this.entregar(atividade);
    },

    /** O que ficou para trás quando o celular não estava por perto. */
    reenviarPendente() {
      for (const atividade of ler(CHAVE_PENDENTE) || []) this.entregar(atividade);
    },

    /**
     * Entrega um resultado e só descarta com confirmação.
     *
     * Apagar no momento do envio perderia o treino sempre que o celular
     * estivesse sem rede — que é exatamente quando se corre.
     */
    entregar(atividade) {
      this.request({ method: "ENVIAR_RESULTADO", atividade })
        .then((resposta) => {
          if (!resposta || !resposta.ok) return;
          const restantes = (ler(CHAVE_PENDENTE) || []).filter((a) => a.trackid !== atividade.trackid);
          guardar(CHAVE_PENDENTE, restantes);
        })
        .catch(() => { /* fica pendente para a próxima abertura */ });
    },
  }),
);
