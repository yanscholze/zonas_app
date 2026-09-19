/**
 * Conversa com o Garmin Connect pela API que o aplicativo do celular usa.
 *
 * ATENÇÃO, antes de mexer aqui: esta NÃO é a API oficial do Garmin Developer
 * Program. É a mesma que o aplicativo Garmin Connect usa no telefone. A escolha
 * foi consciente — a oficial exige aprovação que não temos e uma Training API
 * cuja URL só vem no material de aprovação.
 *
 * Quem digita a senha é o ATLETA, na área dele. Ela é usada aqui para obter o
 * token e **não é guardada em lugar nenhum** — nem cifrada. O que fica no banco
 * é o token e o refresh, e é o refresh que permite ao atleta entrar uma única
 * vez. Se o desenho mudar e alguém precisar guardar a senha, isso é sinal de que
 * o desenho está errado, não de que falta uma coluna.
 *
 * Duas consequências continuam valendo e não devem ser esquecidas:
 *
 * 1. O Garmin pode mudar este caminho sem aviso, porque não é contrato público.
 *    Por isso cada falha tem nome próprio em vez de virar "deu erro".
 * 2. A renovação depende do refresh. Quando ele também vence, ou o atleta troca
 *    a senha no Garmin, não há recuperação automática: a conexão vira
 *    "reconectar" e o atleta precisa entrar de novo.
 *
 * Sobre bloqueio anti-robô: em 18/09/2026 foi medido que um Worker alcança
 * sso.garmin.com, diauth e connectapi com as MESMAS respostas que uma máquina
 * doméstica — sem `cf-mitigated` e sem página de desafio. A impersonação de TLS
 * que o cliente em Python faz serve à estratégia do formulário web, que não é
 * esta. `bloqueado_na_porta` segue existindo por precaução, não por diagnóstico.
 *
 * Os endereços e o formato vieram de cyberjunky/python-garminconnect.
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

/**
 * A sessão do atleta no Garmin.
 *
 * `refresh` é o que torna o desenho viável: o atleta entra UMA vez, e daí em
 * diante o sistema renova sozinho. Sem ele a senha teria de ficar guardada para
 * poder entrar de novo — que é exatamente o que este caminho evita.
 */
export type Sessao = { token: string; refresh: string; expiraEm: number };

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
      const dados = await resposta.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!dados.access_token) { ultimoDetalhe = `sem access_token em ${cliente}`; continue; }
      /* Um minuto de folga antes do vencimento real: token que vence no meio do
         envio da semana derruba os treinos do fim da lista, e o treinador veria
         metade da semana no calendário do aluno. */
      const duracao = (Number(dados.expires_in) || 3600) - 60;
      return { ok: true, valor: { token: dados.access_token, refresh: dados.refresh_token ?? "", expiraEm: Date.now() + duracao * 1000 } };
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

/* --- Renovação ------------------------------------------------------------ */

/**
 * Lê o `client_id` de dentro do próprio token.
 *
 * A renovação precisa apresentar o MESMO cliente que emitiu o token, e a lista
 * de clientes muda a cada trimestre do Garmin. Guardar o cliente numa coluna
 * criaria um segundo lugar para o mesmo fato, que divergiria; o token já carrega
 * a resposta no corpo dele.
 *
 * O token expirado continua legível: o vencimento impede de usá-lo, não de lê-lo.
 */
function clienteDoToken(token: string): string | null {
  try {
    const meio = token.split(".")[1];
    if (!meio) return null;
    const normal = meio.replace(/-/g, "+").replace(/_/g, "/");
    const corpo = JSON.parse(atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "="))) as { client_id?: string };
    return corpo.client_id ?? null;
  } catch { return null; }
}

/**
 * Renova a sessão sem pedir a senha de novo.
 *
 * É o que permite ao atleta entrar uma única vez. Quando a renovação falha — o
 * refresh também vence, ou o atleta trocou a senha no Garmin —, não há
 * recuperação automática possível: o resultado é `credenciais_invalidas`, e quem
 * chama deve marcar a conexão como "reconectar" para o atleta ver.
 */
export async function renovar(sessao: Sessao): Promise<Resultado<Sessao>> {
  if (!sessao.refresh) return { ok: false, falha: "credenciais_invalidas", detalhe: "sem refresh guardado" };

  const cliente = clienteDoToken(sessao.token) ?? CLIENTES_DI[0];
  const corpo = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cliente,
    refresh_token: sessao.refresh,
  });

  let resposta: Response;
  try {
    resposta = await fetch(TROCA_DE_TICKET, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${cliente}:`)}`,
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GCM-Android-5.23",
      },
      body: corpo.toString(),
    });
  } catch (erro) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: String(erro) };
  }

  if (resposta.status === 429) return { ok: false, falha: "limite_de_tentativas" };
  if (resposta.status === 400 || resposta.status === 401) {
    return { ok: false, falha: "credenciais_invalidas", detalhe: `HTTP ${resposta.status} na renovação` };
  }
  if (!resposta.ok) return { ok: false, falha: "garmin_indisponivel", detalhe: `HTTP ${resposta.status}` };

  try {
    const dados = await resposta.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!dados.access_token) return { ok: false, falha: "garmin_indisponivel", detalhe: "renovação sem access_token" };
    const duracao = (Number(dados.expires_in) || 3600) - 60;
    return {
      ok: true,
      valor: {
        token: dados.access_token,
        /* O Garmin pode ou não girar o refresh. Quando não manda um novo, o
           antigo continua valendo — descartá-lo encerraria a sessão do atleta
           por conta própria. */
        refresh: dados.refresh_token || sessao.refresh,
        expiraEm: Date.now() + duracao * 1000,
      },
    };
  } catch (erro) {
    return { ok: false, falha: "garmin_indisponivel", detalhe: String(erro) };
  }
}
