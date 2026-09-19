/**
 * Integrações com relógios e aplicativos de corrida.
 *
 * Os quatro provedores compartilham o mesmo ciclo de vida — conectar, guardar
 * token cifrado, importar atividades, desconectar — mas não a mesma mecânica de
 * autorização, e é essa diferença que este módulo torna explícita:
 *
 *   Strava  OAuth2 clássico. Funciona hoje, basta cadastrar o aplicativo.
 *   Garmin  OAuth2 com PKCE. O fluxo está implementado, mas o Garmin Connect
 *           Developer Program precisa aprovar a conta e liberar as APIs antes
 *           de as chamadas responderem.
 *   Zepp    OAuth2. Depende de quais recursos a conta tem liberados no portal.
 *   Apple   NÃO tem API de servidor. O HealthKit só existe dentro do iPhone,
 *           então a importação acontece pelo aparelho do atleta, com um token
 *           de ingestão que ele cola em um Atalho do iOS. É por isso que a
 *           Apple aparece aqui com `authType: "device"` em vez de "oauth2".
 *
 * Enquanto as credenciais de um provedor não existirem no ambiente, ele é
 * reportado como indisponível em vez de falhar no meio do fluxo.
 */

export type ProviderId = "strava" | "garmin" | "zepp" | "apple";
/* "senha" é o caminho em que o ATLETA entra com a conta dele e o sistema guarda
   só o token devolvido — a senha é usada na troca e descartada na mesma
   requisição, nunca chega ao banco. É o caso do Garmin, cuja API oficial exige
   aprovação que ainda não temos. */
export type AuthType = "oauth2" | "oauth2-pkce" | "device" | "senha";

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  authType: AuthType;
  authorizeUrl: string | null;
  tokenUrl: string | null;
  scope: string | null;
  /** Nomes das variáveis de ambiente exigidas para o provedor sair do papel. */
  requiredEnv: string[];
  canImportActivities: boolean;
  canSendWorkouts: boolean;
  notes: string;
  /**
   * Endpoint de listagem de atividades, quando o provedor tem um documentado.
   * `null` significa que a importação não parte daqui — ou porque o provedor
   * empurra os dados por webhook, ou porque não há API pública para isso.
   */
  activitiesUrl: string | null;
  /** Como o período é passado na consulta de atividades. */
  activitiesRange: "epoch-seconds" | "iso" | null;
  /** Onde a lista de atividades aparece na resposta; vazio = a própria raiz. */
  activitiesPath: string;
};

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  strava: {
    id: "strava",
    label: "Strava",
    authType: "oauth2",
    authorizeUrl: "https://www.strava.com/oauth/authorize",
    tokenUrl: "https://www.strava.com/api/v3/oauth/token",
    scope: "activity:read_all",
    requiredEnv: ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_TOKEN_ENCRYPTION_KEY"],
    canImportActivities: true,
    canSendWorkouts: false,
    notes: "Importa atividades concluídas. O Strava não recebe treinos planejados.",
    activitiesUrl: "https://www.strava.com/api/v3/athlete/activities",
    activitiesRange: "epoch-seconds",
    activitiesPath: "",
  },
  garmin: {
    id: "garmin",
    label: "Garmin",
    /* O atleta entra com a conta dele e guardamos só o token.
     *
     * Era "oauth2-pkce", apontando para o Garmin Connect Developer Program —
     * que exige aprovação que não temos e uma Training API cuja URL só vem no
     * material de aprovação. Enquanto isso não existe, o caminho é o mesmo que o
     * aplicativo Garmin Connect do celular usa.
     *
     * Quem digita a senha é o ATLETA, na área dele, e ela morre na troca pelo
     * token: o banco guarda token e refresh, nunca a senha. */
    authType: "senha",
    authorizeUrl: null,
    tokenUrl: "https://diauth.garmin.com/di-oauth2-service/oauth/token",
    scope: null,
    /* Só a chave de cifra. A consumer key e o secret serviam ao caminho OAuth
       do programa de desenvolvedores; exigi-los aqui faria a tela dizer
       "credenciais não configuradas" para uma integração que funciona. */
    requiredEnv: ["STRAVA_TOKEN_ENCRYPTION_KEY"],
    canImportActivities: true,
    canSendWorkouts: true,
    notes: "O atleta entra com a conta do Garmin Connect. A Zonas-App guarda apenas o token de acesso.",
    // Endpoint público da Health/Activity API. A janela é obrigatória e o
    // próprio Garmin limita o intervalo por chamada.
    activitiesUrl: "https://apis.garmin.com/wellness-api/rest/activities",
    activitiesRange: "epoch-seconds",
    activitiesPath: "",
  },
  zepp: {
    id: "zepp",
    label: "Amazfit / Zepp",
    /* O caminho é o mini-app no relógio, não a nuvem Zepp.
     *
     * A Zepp não publica API de leitura de atividades: o que existe é o SDK do
     * Zepp OS para aplicativos no próprio relógio, e uma API interna alcançável
     * só por engenharia reversa — essa segunda via quebraria os termos e poria a
     * conta do atleta em risco.
     *
     * O SDK, porém, resolve o problema por outro lado e melhor: um mini-app roda
     * no relógio, um Side Service roda dentro do aplicativo Zepp no celular, e é
     * ele que fala com a internet. O celular busca o treino do dia aqui e devolve
     * o resultado quando o aluno termina de correr — sem nuvem intermediária e
     * sem o aluno abrir nada.
     *
     * Por isso o tipo é "device", o mesmo do Atalho do iPhone: quem apresenta a
     * credencial é um aparelho, não um servidor. O código do mini-app está em
     * `zepp-app/`.
     */
    authType: "device",
    authorizeUrl: null,
    tokenUrl: null,
    scope: null,
    requiredEnv: [],
    canImportActivities: true,
    canSendWorkouts: true,
    notes: "O mini-app do relógio busca o treino do dia e devolve o resultado sozinho, sem o aluno abrir nada.",
    activitiesUrl: null,
    activitiesRange: null,
    activitiesPath: "",
  },
  apple: {
    id: "apple",
    label: "Apple Saúde / Apple Watch",
    authType: "device",
    authorizeUrl: null,
    tokenUrl: null,
    scope: null,
    /* Nenhuma. Provedor "device" não guarda token de servidor: o que existe é um
       token de ingestão que o aparelho apresenta, e os campos cifrados ficam
       vazios. Exigir a chave de cifra fazia a tela dizer "credenciais não
       configuradas" para algo que não usa credencial nenhuma — e o atleta ficava
       sem conseguir conectar por uma exigência que não era real. */
    requiredEnv: [],
    canImportActivities: true,
    canSendWorkouts: false,
    notes: "Sem API de servidor. O envio parte do iPhone por um Atalho do iOS.",
    activitiesUrl: null,
    activitiesRange: null,
    activitiesPath: "",
  },
};

export const SUPPORTED_PROVIDER_LABELS = Object.values(PROVIDERS).map(provider => provider.label);

export function providerByLabel(label: string): ProviderDefinition | null {
  return Object.values(PROVIDERS).find(provider => provider.label === label) ?? null;
}

export function providerById(id: string): ProviderDefinition | null {
  return (PROVIDERS as Record<string, ProviderDefinition>)[id] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Tabelas                                                                     */
/*                                                                             */
/* As tabelas destas integrações são declaradas em `db/schema.ts`, junto com o  */
/* resto do esquema, e criadas a partir de lá — não há SQL duplicado aqui.      */
/* -------------------------------------------------------------------------- */






/* -------------------------------------------------------------------------- */
/* Normalização                                                                */
/* -------------------------------------------------------------------------- */

export type NormalizedActivity = {
  externalId: string;
  startedAt: number;
  sport: string;
  distanceMeters: number | null;
  movingSeconds: number | null;
  elapsedSeconds: number | null;
  averageHeartRate: number | null;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

/** Converte a atividade de cada provedor para o mesmo formato interno. */
export function normalizeActivity(provider: ProviderId, raw: Record<string, unknown>): NormalizedActivity | null {
  if (provider === "strava") {
    const id = String(raw.id ?? "");
    const start = Date.parse(String(raw.start_date ?? ""));
    if (!id || !Number.isFinite(start)) return null;
    return {
      externalId: id,
      startedAt: start,
      sport: String(raw.sport_type ?? raw.type ?? "Run"),
      distanceMeters: finiteNumber(raw.distance),
      movingSeconds: finiteNumber(raw.moving_time),
      elapsedSeconds: finiteNumber(raw.elapsed_time),
      averageHeartRate: finiteNumber(raw.average_heartrate),
    };
  }
  if (provider === "garmin") {
  /*
   * Dois formatos, porque há duas APIs do Garmin com nomes diferentes para os
   * mesmos campos.
   *
   * O primeiro é o da API INTERNA — `activityId`, `beginTimestamp`,
   * `activityType.typeKey`. É o que o `python-garminconnect` devolve, e é o que
   * o nosso próprio cliente receberá quando importar atividades: os dois falam
   * com `connectapi.garmin.com`. (O serviço em `garmin-bridge/` está inativo e
   * não é chamado por ninguém — ver o README de lá.)
   *
   * O segundo é o da Activity API OFICIAL do Developer Program —
   * `summaryId`, `startTimeInSeconds`, `distanceInMeters` —, que passa a valer
   * se o programa for aprovado.
   *
   * Os DOIS são aceitos porque ler só um faz o outro devolver `null` — e
   * atividade nula é descartada em silêncio, sem erro em lugar nenhum: o aluno
   * correria e o treino sumiria sem ninguém saber por quê.
   */

  const id = String(
    raw.activityId ??
    raw.activityUUID ??
    raw.summaryId ??      /* Activity API oficial */
    ""
  );

  /*
   * python-garminconnect retorna:
   *
   * startTimeGMT: "2026-09-16 21:04:00"
   * beginTimestamp: 1789592640000
   *
   * beginTimestamp já está em milissegundos e é a fonte mais segura.
   */
  const beginTimestamp = Number(raw.beginTimestamp ?? NaN);
  /* A oficial manda segundos; a ponte manda milissegundos. Confundir as duas
     joga a atividade para 1970 ou para o ano 58000, e ela nunca casa com a
     semana planejada. */
  const startTimeInSeconds = Number(raw.startTimeInSeconds ?? NaN);

  let startedAt: number;

  if (Number.isFinite(beginTimestamp)) {
    startedAt = beginTimestamp;
  } else if (Number.isFinite(startTimeInSeconds)) {
    startedAt = startTimeInSeconds * 1000;
  } else {
    const startTime = String(
      raw.startTimeGMT ??
      raw.startTimeLocal ??
      ""
    );

    startedAt = Date.parse(
      startTime.includes("T")
        ? startTime
        : startTime.replace(" ", "T") + "Z"
    );
  }

  if (!id || !Number.isFinite(startedAt)) {
    return null;
  }

  const activityType =
    raw.activityType &&
    typeof raw.activityType === "object"
      ? raw.activityType as Record<string, unknown>
      : {};

  return {
    externalId: id,

    startedAt,

    sport: String(
      activityType.typeKey ??
      (typeof raw.activityType === "string" ? raw.activityType : null) ??
      "running"
    ),

    distanceMeters:
      finiteNumber(raw.distance ?? raw.distanceInMeters),

    movingSeconds:
      finiteNumber(raw.duration ?? raw.durationInSeconds),

    elapsedSeconds:
      finiteNumber(
        raw.elapsedDuration ??
        raw.duration ??
        raw.durationInSeconds
      ),

    averageHeartRate:
      finiteNumber(
        raw.averageHR ??
        raw.averageHeartRate ??
        raw.averageHeartRateInBeatsPerMinute
      ),
  };
  }
  if (provider === "zepp") {
    const id = String(raw.trackid ?? raw.id ?? "");
    const startSeconds = Number(raw.start_time ?? raw.trackid ?? NaN);
    if (!id || !Number.isFinite(startSeconds)) return null;
    return {
      externalId: id,
      startedAt: startSeconds * 1000,
      sport: String(raw.type ?? "run"),
      distanceMeters: finiteNumber(raw.dis ?? raw.distance),
      movingSeconds: finiteNumber(raw.run_time ?? raw.duration),
      elapsedSeconds: finiteNumber(raw.end_time && raw.start_time ? Number(raw.end_time) - Number(raw.start_time) : null),
      averageHeartRate: finiteNumber(raw.avg_heart_rate),
    };
  }
  // Apple: o Atalho do iOS envia já no formato do HealthKit.
  const id = String(raw.uuid ?? raw.id ?? "");
  const start = Date.parse(String(raw.startDate ?? ""));
  if (!id || !Number.isFinite(start)) return null;
  return {
    externalId: id,
    startedAt: start,
    sport: String(raw.workoutActivityType ?? "HKWorkoutActivityTypeRunning"),
    distanceMeters: finiteNumber(raw.totalDistanceMeters ?? raw.distance),
    movingSeconds: finiteNumber(raw.durationSeconds ?? raw.duration),
    elapsedSeconds: finiteNumber(raw.durationSeconds ?? raw.duration),
    averageHeartRate: finiteNumber(raw.averageHeartRate),
  };
}

/** Ritmo médio em segundos por quilômetro, quando dá para calcular. */
export function averagePaceSeconds(activity: NormalizedActivity): number | null {
  if (!activity.distanceMeters || !activity.movingSeconds) return null;
  const kilometers = activity.distanceMeters / 1000;
  if (kilometers < 0.4) return null;
  return Math.round(activity.movingSeconds / kilometers);
}

/** A segunda-feira da semana da atividade, no mesmo formato de `training_weeks`. */
export function weekStartOf(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

const WEEKDAY_KEYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

export function workoutDayOf(timestamp: number): string {
  return WEEKDAY_KEYS[new Date(timestamp).getUTCDay()];
}

/* -------------------------------------------------------------------------- */
/* Treino estruturado para a Garmin                                            */
/* -------------------------------------------------------------------------- */

/**
 * Converte a sessão montada na Zonas-App para o formato de treino da Garmin.
 *
 * O treino da Zonas-App é uma lista de etapas com duração e zona; a Garmin
 * espera passos com `stepOrder`, tipo de duração e alvo. A tradução vive aqui,
 * separada do transporte, porque é a parte que continua valendo mesmo que o
 * endpoint mude quando a conta for aprovada.
 */
export type GarminWorkoutStep = {
  stepOrder: number;
  stepName: string;
  durationType: "TIME" | "DISTANCE" | "OPEN";
  durationValue?: number;
  durationValueType?: "SECOND" | "METER";
  intensity: "WARMUP" | "INTERVAL" | "RECOVERY" | "COOLDOWN" | "REST";
  description?: string;
};

export type GarminWorkout = {
  workoutName: string;
  description?: string;
  sport: "RUNNING";
  steps: GarminWorkoutStep[];
};

/** Zonas mais leves abrem e fecham o treino; as demais são esforço. */
function intensidadeDaEtapa(rotulo: string, zona: string, posicao: number, total: number): GarminWorkoutStep["intensity"] {
  const nome = rotulo.toLowerCase();
  // "desaquecimento" contém "aquec": o encerramento precisa ser testado antes,
  // senão o treino termina com um passo marcado como aquecimento.
  if (nome.includes("desaquec") || nome.includes("volta à calma") || nome.includes("volta a calma")) return "COOLDOWN";
  if (nome.includes("aquec")) return "WARMUP";
  if (nome.includes("recuper") || nome.includes("trote") || zona === "Z1") return "RECOVERY";
  if (posicao === 0) return "WARMUP";
  if (posicao === total - 1) return "COOLDOWN";
  return "INTERVAL";
}

/**
 * Traduz uma sessão para o formato da Garmin.
 *
 * Etapas repetidas viram passos sequenciais em vez de um bloco de repetição:
 * a Garmin aceita repetição aninhada, mas expandir mantém o treino legível no
 * relógio e evita depender de uma estrutura que muda entre versões da API.
 */
export function toGarminWorkout(
  nome: string,
  descricao: string,
  etapas: Array<Record<string, unknown>>,
): GarminWorkout {
  const steps: GarminWorkoutStep[] = [];
  const expandidas: Array<{ rotulo: string; zona: string; minutos?: number; metros?: number }> = [];

  for (const etapa of etapas) {
    const kind = String(etapa.kind ?? "simple");
    if (kind === "repeat") {
      const vezes = Math.max(1, Math.min(30, Number(etapa.repetitions) || 1));
      for (let volta = 1; volta <= vezes; volta += 1) {
        expandidas.push({
          rotulo: `${String(etapa.label ?? "Série")} ${volta}/${vezes}`,
          zona: String(etapa.effortZone ?? "Z3"),
          minutos: Number(etapa.effortMinutes) || undefined,
        });
        if (Number(etapa.recoveryMinutes)) {
          expandidas.push({ rotulo: "Recuperação", zona: String(etapa.recoveryZone ?? "Z1"), minutos: Number(etapa.recoveryMinutes) });
        }
      }
      continue;
    }
    expandidas.push({
      rotulo: String(etapa.label ?? "Etapa"),
      zona: String(etapa.zone ?? "Z2"),
      minutos: Number(etapa.minutes) || undefined,
      metros: Number(etapa.distanceMeters) || undefined,
    });
  }

  expandidas.forEach((etapa, indice) => {
    const passo: GarminWorkoutStep = {
      stepOrder: indice + 1,
      stepName: etapa.rotulo.slice(0, 40),
      durationType: etapa.minutos ? "TIME" : etapa.metros ? "DISTANCE" : "OPEN",
      intensity: intensidadeDaEtapa(etapa.rotulo, etapa.zona, indice, expandidas.length),
      description: `Zona ${etapa.zona}`,
    };
    if (etapa.minutos) { passo.durationValue = Math.round(etapa.minutos * 60); passo.durationValueType = "SECOND"; }
    else if (etapa.metros) { passo.durationValue = Math.round(etapa.metros); passo.durationValueType = "METER"; }
    steps.push(passo);
  });

  return { workoutName: nome.slice(0, 60), description: descricao.slice(0, 200), sport: "RUNNING", steps };
}
