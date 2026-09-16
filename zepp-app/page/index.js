/**
 * Aplicativo do relógio.
 *
 * Guarda o treino que o celular manda e devolve o resultado quando o aluno
 * termina de correr. A tela existe para o aluno conferir o que vai fazer — mas
 * ele não precisa abri-la: a sincronização acontece pelo Side Service, mesmo com
 * o aplicativo fechado.
 */
import { getDeviceInfo } from "@zos/device";
import { createWidget, widget, align, prop } from "@zos/ui";
import { localStorage } from "@zos/storage";
import { Workout } from "@zos/sensor";

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

Page({
  build() {
    this.treino = ler(CHAVE_TREINO);
    this.desenhar();
    this.escutarCelular();
    this.escutarTreinoDoRelogio();
    this.reenviarPendente();
  },

  onDestroy() {
    if (this.workout) { try { this.workout.offChange(); } catch { /* já removido */ } }
  },

  /* ---------------------------------------------------------------- tela --- */

  desenhar() {
    const treino = this.treino;
    createWidget(widget.TEXT, {
      x: 0, y: 40, w: LARGURA, h: 48,
      text: treino ? treino.treino.title : "Sem treino hoje",
      text_size: 26, color: 0xd7aa39, align_h: align.CENTER_H,
    });

    if (!treino) {
      createWidget(widget.TEXT, {
        x: 20, y: 100, w: LARGURA - 40, h: 120,
        text: "Quando o treinador liberar a semana, o treino aparece aqui sozinho.",
        text_size: 18, color: 0x999999, align_h: align.CENTER_H, text_style: prop.MULTIPLE_LINE,
      });
      return;
    }

    let y = 100;
    for (const etapa of treino.treino.steps || []) {
      createWidget(widget.TEXT, {
        x: 20, y, w: LARGURA - 40, h: 52,
        text: descreverEtapa(etapa),
        text_size: 17, color: 0xffffff, align_h: align.LEFT, text_style: prop.MULTIPLE_LINE,
      });
      y += 58;
    }
  },

  /* --------------------------------------------------------- do celular --- */

  escutarCelular() {
    messaging.peerSocket.addListener("message", (payload) => {
      if (!payload) return;

      if (payload.tipo === "treino") {
        this.treino = { dia: payload.dia, treino: payload.treino, plano: payload.plano };
        guardar(CHAVE_TREINO, this.treino);
        this.desenhar();
        return;
      }

      /* O celular confirmou a entrega: só agora o registro pode ser descartado.
         Apagar no momento do envio perderia o treino sempre que o celular
         estivesse sem rede — que é exatamente quando se corre. */
      if (payload.tipo === "recebido" && payload.ok) {
        const pendentes = (ler(CHAVE_PENDENTE) || []).filter((a) => a.trackid !== payload.trackid);
        guardar(CHAVE_PENDENTE, pendentes);
      }
    });
  },

  /* ------------------------------------------------ fim de treino no relógio --- */

  /**
   * Escuta o treino nativo do relógio.
   *
   * O aluno corre pelo aplicativo de esporte do próprio relógio, como sempre fez
   * — não por este. Quando ele encerra, pegamos o que o relógio mediu e
   * mandamos para o celular. É o que torna a sincronização invisível: ninguém
   * muda de hábito.
   */
  escutarTreinoDoRelogio() {
    try {
      this.workout = new Workout();
      this.workout.onChange((estado) => {
        /* 0 = parado. A transição para parado é o fim da atividade. */
        if (estado && estado.status === 0) this.enviarResultado();
      });
    } catch {
      /* Relógio sem o sensor de esporte exposto: a tela do treino continua
         valendo, e o envio automático simplesmente não acontece. */
    }
  },

  enviarResultado() {
    let ultimo = null;
    try {
      const historico = this.workout.getHistory();
      ultimo = historico && historico.length ? historico[historico.length - 1] : null;
    } catch { return; }
    if (!ultimo) return;

    /* Os nomes são os da nuvem Zepp porque o servidor já sabe lê-los. Inventar
       nomes aqui obrigaria a um segundo normalizador para a mesma informação. */
    const atividade = {
      trackid: String(ultimo.trackid || ultimo.startTime || Date.now()),
      start_time: Math.round((ultimo.startTime || Date.now()) / 1000),
      end_time: Math.round((ultimo.endTime || Date.now()) / 1000),
      type: String(ultimo.type || "run"),
      dis: Number(ultimo.distance) || 0,
      run_time: Number(ultimo.duration) || 0,
      avg_heart_rate: Number(ultimo.avgHeartRate) || null,
      calorie: Number(ultimo.calorie) || null,
      origem: "zepp-os-miniapp",
    };

    /* Guarda ANTES de enviar. Se o celular estiver longe ou sem rede, o treino
       fica esperando em vez de sumir. */
    const pendentes = ler(CHAVE_PENDENTE) || [];
    if (!pendentes.some((a) => a.trackid === atividade.trackid)) {
      pendentes.push(atividade);
      guardar(CHAVE_PENDENTE, pendentes);
    }
    messaging.peerSocket.send({ tipo: "resultado", atividade });
  },

  /** O que ficou para trás quando o celular não estava por perto. */
  reenviarPendente() {
    for (const atividade of ler(CHAVE_PENDENTE) || []) {
      messaging.peerSocket.send({ tipo: "resultado", atividade });
    }
  },
});
