/**
 * Conversa com o Garmin Connect pela API que o aplicativo do celular usa.
 *
 * ATENÇÃO, antes de mexer aqui: esta NÃO é a API oficial do Garmin Developer
 * Program. É a mesma que o aplicativo Garmin Connect usa no telefone, alcançada
 * com o e-mail e a senha do atleta. A escolha foi consciente — a oficial exige
 * aprovação que não temos e uma Training API cuja URL só vem no material de
 * aprovação —, mas ela traz três consequências que precisam ficar à vista:
 *
 * 1. Guardamos a senha do Garmin do atleta. Cifrada, mas guardada. É credencial
 *    de um serviço de terceiro, e isso pesa em LGPD.
 * 2. O Garmin pode mudar este caminho sem aviso, porque não é contrato público.
 * 3. O login fica atrás da proteção anti-bot da Cloudflare. O cliente em Python
 *    contorna isso imitando a impressão digital TLS do Chrome (`curl_cffi`);
 *    um Worker não tem como fazer isso, e sai de um endereço de datacenter.
 *    Se o Garmin barrar, a resposta é 403 e não há o que ajustar no código —
 *    por isso `bloqueado_na_porta` é um resultado nomeado, e não "falhou".
 *
 * Os endereços e o formato vieram de cyberjunky/python-garminconnect, que é o
 * cliente que o Yan testou e viu funcionar pelo terminal.
 */

/* --- Endereços ------------------------------------------------------------ */

const SSO = "https://sso.garmin.com/mobile/api/login";
const TROCA_DE_TICKET = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const API = "https://connectapi.garmin.com";

/** O serviço pelo qual o ticket é emitido. Precisa ser o MESMO no login e na troca. */
const SERVICO = "https://mobile.integration.garmin.com/gcm/ios";
const CLIENTE_SSO = "GCM_IOS_DARK";

/**
 * O aplicativo do celular se identifica assim.
 *
 * Não é disfarce: é a identificação que corresponde ao caminho que estamos
 * usando. O SSO móvel responde de forma diferente — ou não responde — a um
 * agente que não bate com o `clientId` pedido.
 */
const AGENTE_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/**
 * Os identificadores de cliente da troca de ticket, do mais novo para o mais
 * velho. O Garmin aposenta um de tempos em tempos e o seguinte passa a valer —
 * tentar em ordem é o que o cliente em Python faz, e é por isso que ele
 * sobrevive às viradas de trimestre.
 */
const CLIENTES_DI = [
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  "GARMIN_CONNECT_MOBILE_IOS_DI",
];

const CONCESSAO = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";

/* --- Resultado ------------------------------------------------------------ */

/**
 * Por que falhou, em vocabulário que a tela consegue explicar ao treinador.
 *
 * Cada um destes pede uma ação diferente de quem está olhando, e é isso que os
 * torna valiosos: "falhou" mandaria o treinador tentar de novo em todos eles,
 * inclusive nos dois em que tentar de novo não resolve nada.
 */
export type FalhaDoGarmin =
  | "credenciais_invalidas"
  | "verificacao_em_duas_etapas"
  | "desafio_de_robo"
  | "bloqueado_na_porta"
  | "limite_de_tentativas"
  | "garmin_indisponivel";

export type Sessao = { token: string; expiraEm: number };

export type Resultado<T> = { ok: true; valor: T } | { ok: false; falha: FalhaDoGarmin; detalhe?: string };

/* --- Entrada -------------------------------------------------------------- */

/**
 * Troca e-mail e senha por um token de acesso.
 *
 * São dois passos: o SSO devolve um "service ticket" de uso único, e a troca
 * converte esse ticket num token de portador. O ticket sozinho não abre nada, e
 * é por isso que ele não é guardado em lugar nenhum.
 */
export async function entrar(email: string, senha: string): Promise<Resultado<Sessao>> {
  const endereco = `${SSO}?clientId=${CLIENTE_SSO}&locale=pt-BR&service=${encodeURIComponent(SERVICO)}`;

  let resposta: Response;
  try {
    resposta = await fetch(endereco, {
      method: "POST",
      headers: {
        "User-Agent": AGENTE_IOS,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://sso.garmin.com",
      },
      body: JSON.stringify({ username: email, password: senha, rememberMe: true, captchaToken: "" }),
    });
  } catch (erro) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: String(erro) };
  }

  if (resposta.status === 429) return { ok: false, falha: "limite_de_tentativas" };

  /* 403 aqui é quase sempre a proteção anti-bot, não senha errada. Chamar isso
     de "credenciais inválidas" mandaria o treinador trocar a senha do aluno
     atrás de um problema que não é de senha. */
  if (resposta.status === 403) return { ok: false, falha: "bloqueado_na_porta" };

  let corpo: Record<string, unknown>;
  try {
    corpo = await resposta.json() as Record<string, unknown>;
  } catch {
    /* Resposta que não é JSON, vinda de um endereço que só fala JSON, é página
       de desafio. */
    return { ok: false, falha: "bloqueado_na_porta", detalhe: `HTTP ${resposta.status}` };
  }

  const situacao = String((corpo.responseStatus as Record<string, unknown> | undefined)?.type ?? "");

  if (situacao === "MFA_REQUIRED") return { ok: false, falha: "verificacao_em_duas_etapas" };
  if (situacao === "CAPTCHA_REQUIRED") return { ok: false, falha: "desafio_de_robo" };
  if (situacao === "INVALID_USERNAME_PASSWORD") return { ok: false, falha: "credenciais_invalidas" };
  if (situacao !== "SUCCESSFUL" || !corpo.serviceTicketId) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: situacao || `HTTP ${resposta.status}` };
  }

  return await trocarTicket(String(corpo.serviceTicketId));
}

/**
 * Converte o ticket de uso único em token de portador.
 *
 * Percorre os identificadores de cliente em ordem porque o Garmin aposenta o
 * mais antigo sem aviso. Falhar no primeiro é esperado, não é erro — só depois
 * de todos é que a troca falhou de verdade.
 */
async function trocarTicket(ticket: string): Promise<Resultado<Sessao>> {
  let ultimoDetalhe = "";

  for (const cliente of CLIENTES_DI) {
    const corpo = new URLSearchParams({
      client_id: cliente,
      service_ticket: ticket,
      grant_type: CONCESSAO,
      service_url: SERVICO,
    });

    let resposta: Response;
    try {
      resposta = await fetch(TROCA_DE_TICKET, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${cliente}:`)}`,
          "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GCM-Android-5.23",
        },
        body: corpo.toString(),
      });
    } catch (erro) {
      ultimoDetalhe = String(erro);
      continue;
    }

    if (resposta.status === 429) return { ok: false, falha: "limite_de_tentativas" };
    if (!resposta.ok) { ultimoDetalhe = `HTTP ${resposta.status} em ${cliente}`; continue; }

    try {
      const dados = await resposta.json() as { access_token?: string; expires_in?: number };
      if (!dados.access_token) { ultimoDetalhe = `sem access_token em ${cliente}`; continue; }
      /* Um minuto de folga antes do vencimento real: token que vence no meio do
         envio da semana derruba os treinos do fim da lista, e o treinador veria
         metade da semana no calendário do aluno. */
      const duracao = (Number(dados.expires_in) || 3600) - 60;
      return { ok: true, valor: { token: dados.access_token, expiraEm: Date.now() + duracao * 1000 } };
    } catch (erro) {
      ultimoDetalhe = String(erro);
    }
  }

  return { ok: false, falha: "garmin_indisponivel", detalhe: ultimoDetalhe };
}

/* --- Treinos -------------------------------------------------------------- */

async function chamar(
  sessao: Sessao,
  caminho: string,
  corpo: unknown,
): Promise<Resultado<Record<string, unknown>>> {
  let resposta: Response;
  try {
    resposta = await fetch(`${API}${caminho}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sessao.token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "GCM-Android-5.23",
        /* O Garmin roteia a chamada pelo cabeçalho, não só pelo domínio. Sem
           ele a API responde 403 mesmo com token bom. */
        "DI-Backend": "connectapi.garmin.com",
        "NK": "NT",
      },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: String(erro) };
  }

  if (resposta.status === 401 || resposta.status === 403) {
    return { ok: false, falha: "bloqueado_na_porta", detalhe: `HTTP ${resposta.status}` };
  }
  if (resposta.status === 429) return { ok: false, falha: "limite_de_tentativas" };
  if (!resposta.ok) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: `HTTP ${resposta.status}` };
  }

  try {
    return { ok: true, valor: await resposta.json() as Record<string, unknown> };
  } catch {
    /* Agendar devolve corpo vazio quando dá certo. */
    return { ok: true, valor: {} };
  }
}

/** Sobe o treino e devolve o id que o Garmin deu a ele. */
export async function subirTreino(sessao: Sessao, treino: Record<string, unknown>): Promise<Resultado<number>> {
  const r = await chamar(sessao, "/workout-service/workout", treino);
  if (!r.ok) return r;
  const id = Number(r.valor.workoutId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: "resposta sem workoutId" };
  }
  return { ok: true, valor: id };
}

/**
 * Põe um treino já subido numa data do calendário do atleta.
 *
 * Sem este passo o treino existe na conta mas não aparece no relógio no dia —
 * fica na biblioteca, esperando o aluno procurar. É o agendamento que faz a
 * semana chegar sozinha, que é o ponto inteiro da integração.
 */
export async function agendarTreino(sessao: Sessao, idDoTreino: number, dataIso: string): Promise<Resultado<true>> {
  const r = await chamar(sessao, `/workout-service/schedule/${idDoTreino}`, { date: dataIso });
  if (!r.ok) return r;
  return { ok: true, valor: true };
}
