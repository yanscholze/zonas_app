"use client";

/**
 * Camada única de acesso à API da Zonas-App.
 *
 * Existe por dois motivos concretos:
 *
 * 1. O Worker protege as rotas de escrita com `preventDuplicateSubmission`, que
 *    responde `409 duplicate_submission` quando a mesma requisição chega duas
 *    vezes em trinta segundos. Isso significa "a sua ação já foi aceita" — é
 *    sucesso, não falha. Antes, cada chamador tratava qualquer resposta não-OK
 *    como erro e dizia ao treinador que o salvamento falhou, mesmo com os dados
 *    já gravados.
 *
 * 2. As chamadas descartavam o status HTTP e o corpo da resposta, então nenhum
 *    erro era diagnosticável. Aqui o erro carrega rota, método, status e código
 *    devolvido pelo servidor, e é registrado no console para investigação.
 *
 * A interface continua mostrando mensagens amigáveis; quem precisa do detalhe
 * técnico o encontra em `ApiError` e no console.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly path: string;
  readonly method: string;
  readonly details: unknown;

  constructor(init: { status: number; code: string; path: string; method: string; details?: unknown }) {
    super(`${init.method} ${init.path} → ${init.status} ${init.code}`);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.path = init.path;
    this.method = init.method;
    this.details = init.details;
  }

  /** Mensagem em português adequada para mostrar ao usuário. */
  get friendlyMessage(): string {
    return friendlyMessages[this.code] ?? friendlyByStatus(this.status);
  }
}

const friendlyMessages: Record<string, string> = {
  authentication_required: "Sua sessão expirou. Entre novamente.",
  coach_access_required: "Esta área é exclusiva do treinador.",
  student_access_required: "Esta área é exclusiva do aluno.",
  access_not_active: "Seu acesso ainda não foi liberado pelo treinador.",
  too_many_requests: "Muitas ações seguidas. Aguarde um instante e tente de novo.",
  payload_too_large: "O conteúdo é grande demais para ser enviado.",
  unexpected_field: "Há um campo não reconhecido neste formulário.",
  invalid_payload: "Confira os dados preenchidos.",
  invalid_json: "Confira os dados preenchidos.",
  email_already_linked: "Este e-mail já está vinculado a outro aluno.",
  email_already_registered: "Já existe uma conta com este e-mail.",
  athlete_and_email_required: "Informe o aluno e o e-mail.",
  athlete_required: "Selecione o aluno.",
  invalid_email: "Confira o endereço de e-mail.",
  database_unavailable: "O banco de dados não respondeu. Tente novamente em instantes.",
  not_connected: "Conecte o serviço antes de sincronizar.",
  token_unreadable: "A autorização guardada não pode mais ser lida. Conecte o serviço novamente.",
  refresh_failed: "A autorização expirou e não pôde ser renovada. Conecte o serviço novamente.",
  strava_request_failed: "O Strava não respondeu agora. Tente de novo em instantes.",
  provider_setup_required: "Este serviço ainda não foi liberado pelo professor.",
};

function friendlyByStatus(status: number): string {
  if (status === 401 || status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return "Recurso não encontrado.";
  if (status >= 500) return "O servidor não respondeu. Tente novamente em instantes.";
  return "Não foi possível concluir. Confira os dados e tente de novo.";
}

export type ApiResult<T> = T & {
  /**
   * Verdadeiro quando o servidor reconheceu a requisição como repetição de uma
   * que já havia sido aceita. Do ponto de vista do usuário, salvou.
   */
  alreadySaved?: boolean;
};

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: method === "GET" ? "no-store" : undefined,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // Falha de rede: nunca houve resposta do servidor.
    const error = new ApiError({ status: 0, code: "network_error", path, method, details: cause });
    console.error("[zonasapp] falha de rede", { method, path, cause });
    throw error;
  }

  const payload = await readBody(response);
  const code = (payload && typeof payload === "object" && "error" in payload)
    ? String((payload as { error: unknown }).error)
    : "";

  if (response.ok) return (payload ?? {}) as ApiResult<T>;

  // A deduplicação do Worker recusa o reenvio porque a primeira já foi gravada.
  // Tratar isso como erro faria a interface mentir sobre o que aconteceu.
  if (response.status === 409 && code === "duplicate_submission") {
    return { alreadySaved: true } as ApiResult<T>;
  }

  const error = new ApiError({ status: response.status, code, path, method, details: payload });
  console.error("[zonasapp] erro de API", {
    method, path, status: response.status, code, corpo: payload,
  });
  throw error;
}

export const api = {
  get: <T = Record<string, unknown>>(path: string) => request<T>("GET", path),
  post: <T = Record<string, unknown>>(path: string, body: unknown) => request<T>("POST", path, body),
};

/**
 * Converte qualquer falha em texto para o usuário, preservando a mensagem
 * específica do servidor quando existe uma.
 */
export function describeError(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): string {
  if (error instanceof ApiError) return error.friendlyMessage;
  return fallback;
}

/**
 * Copia um texto e diz se conseguiu. A API de área de transferência não existe
 * em contexto inseguro nem em alguns navegadores embarcados, então há um
 * caminho alternativo antes de desistir — sem ele, o botão parece não fazer
 * nada quando falha.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Cai no caminho alternativo abaixo.
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}
