/**
 * Side Service — roda dentro do aplicativo Zepp, no celular do aluno.
 *
 * É a única parte com acesso à internet: o relógio não tem. O papel dele é ser a
 * ponte nos dois sentidos, sem que o aluno abra nada:
 *
 *   ZonasApp ──GET treino do dia──▶ celular ──Bluetooth──▶ relógio
 *   relógio ──Bluetooth──▶ celular ──POST resultado──▶ ZonasApp
 *
 * A credencial é o token de ingestão que o aluno colou uma vez ao conectar o
 * Amazfit na tela de Integrações. É o MESMO token nos dois sentidos — buscar o
 * treino e devolver o resultado — porque os dois são a mesma autorização: este
 * aparelho fala por este aluno.
 */
import { settingsLib } from "@zos/settings";

/* O endereço do sistema. Vem do wrangler.jsonc: é o worker em produção.
   Não é `zonasapp.com` — esse domínio não é nosso, e apontar para ele faria o
   relógio conversar com o site de outra pessoa. */
const BASE = "https://zonasapp.fluxo-pessoal.workers.dev";
const ROTA_TREINO = `${BASE}/api/ingest/device/workout`;
const ROTA_RESULTADO = `${BASE}/api/ingest/device`;

/* De quanto em quanto tempo procurar treino novo. Quinze minutos é folgado de
   propósito: o treino do dia muda no máximo algumas vezes por dia, e o Side
   Service divide a bateria do celular com todo o resto. */
const INTERVALO_MS = 15 * 60 * 1000;

AppSideService({
  onInit() {
    this.timer = null;
    this.ultimoTreino = "";

    /* O relógio fala primeiro quando termina uma corrida. Fica escutando desde o
       início: perder essa mensagem significa perder o treino que o aluno
       acabou de fazer, e ele não tem como reenviar. */
    messaging.peerSocket.addListener("message", (payload) => {
      this.receberDoRelogio(payload);
    });

    this.buscarTreino();
    this.timer = setInterval(() => this.buscarTreino(), INTERVALO_MS);
  },

  onDestroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  /** O token que o aluno colou ao conectar o Amazfit nas Integrações. */
  token() {
    try { return settingsLib.getItem("zonasapp_token") || ""; }
    catch { return ""; }
  },

  /**
   * Busca o treino do dia e manda para o relógio.
   *
   * Só despacha quando o conteúdo mudou. Reenviar o mesmo treino a cada quinze
   * minutos gastaria bateria dos dois aparelhos para reescrever o que já está
   * lá — e o relógio teria de decidir se aquilo é novo, decisão que ele não tem
   * como tomar bem.
   */
  buscarTreino() {
    const token = this.token();
    if (!token) return;

    /* A Fetch da Zepp recebe UM objeto com url, method, headers e body — não a
       assinatura (url, options) do fetch do navegador. Passar dois argumentos
       aqui falha em silêncio. */
    fetch({
      url: ROTA_TREINO,
      method: "GET",
      headers: { "x-zonas-ingest-token": token },
    }).then((resposta) => {
      if (resposta.status !== 200) return;
      const corpo = typeof resposta.body === "string" ? JSON.parse(resposta.body) : resposta.body;
      if (!corpo || !corpo.workout) return;

      const assinatura = JSON.stringify(corpo.workout);
      if (assinatura === this.ultimoTreino) return;
      this.ultimoTreino = assinatura;

      messaging.peerSocket.send({ tipo: "treino", dia: corpo.day, treino: corpo.workout, plano: corpo.plan });
    }).catch(() => {
      /* Sem rede, sem token válido, servidor fora: tentar de novo no próximo
         ciclo é a resposta certa. O aluno não tem o que fazer com um erro aqui,
         e o relógio continua com o último treino que recebeu. */
    });
  },

  /**
   * Recebe o resultado do relógio e entrega ao sistema.
   *
   * Os nomes dos campos são os da nuvem Zepp — `trackid`, `dis`, `run_time`,
   * `avg_heart_rate` — porque o normalizador do servidor já os entende. Inventar
   * nomes novos obrigaria a um segundo normalizador para a mesma coisa.
   */
  receberDoRelogio(payload) {
    if (!payload || payload.tipo !== "resultado" || !payload.atividade) return;
    const token = this.token();
    if (!token) return;

    fetch({
      url: ROTA_RESULTADO,
      method: "POST",
      headers: { "content-type": "application/json", "x-zonas-ingest-token": token },
      body: JSON.stringify({ workouts: [payload.atividade] }),
    }).then((resposta) => {
      /* Confirma ao relógio. Sem isso ele não sabe se pode descartar o registro,
         e a escolha seria entre reenviar para sempre ou perder o treino. */
      messaging.peerSocket.send({
        tipo: "recebido",
        trackid: payload.atividade.trackid,
        ok: resposta.status === 200,
      });
    }).catch(() => {
      messaging.peerSocket.send({ tipo: "recebido", trackid: payload.atividade.trackid, ok: false });
    });
  },
});
