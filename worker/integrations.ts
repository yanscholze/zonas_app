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
export type AuthType = "oauth2" | "oauth2-pkce" | "device";

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
  },
  garmin: {
    id: "garmin",
    label: "Garmin",
    authType: "oauth2-pkce",
    authorizeUrl: "https://connect.garmin.com/oauth2Confirm",
    tokenUrl: "https://diauth.garmin.com/di-oauth2-service/oauth/token",
    scope: "ACTIVITY_EXPORT WORKOUT_IMPORT",
    requiredEnv: ["GARMIN_CONSUMER_KEY", "GARMIN_CONSUMER_SECRET", "STRAVA_TOKEN_ENCRYPTION_KEY"],
    canImportActivities: true,
    canSendWorkouts: true,
    notes: "Exige aprovação no Garmin Connect Developer Program antes de responder.",
  },
  zepp: {
    id: "zepp",
    label: "Amazfit / Zepp",
    authType: "oauth2",
    authorizeUrl: "https://user.huami.com/oauth2/authorize",
    tokenUrl: "https://api-user.huami.com/oauth2/access_token",
    scope: "user_activity",
    requiredEnv: ["ZEPP_APP_ID", "ZEPP_APP_SECRET", "STRAVA_TOKEN_ENCRYPTION_KEY"],
    canImportActivities: true,
    canSendWorkouts: false,
    notes: "Os recursos liberados variam por conta; confirme no portal Zepp.",
  },
  apple: {
    id: "apple",
    label: "Apple Saúde / Apple Watch",
    authType: "device",
    authorizeUrl: null,
    tokenUrl: null,
    scope: null,
    requiredEnv: ["STRAVA_TOKEN_ENCRYPTION_KEY"],
    canImportActivities: true,
    canSendWorkouts: false,
    notes: "Sem API de servidor. O envio parte do iPhone por um Atalho do iOS.",
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
    const id = String(raw.summaryId ?? raw.activityId ?? "");
    const startSeconds = Number(raw.startTimeInSeconds ?? NaN);
    if (!id || !Number.isFinite(startSeconds)) return null;
    return {
      externalId: id,
      startedAt: startSeconds * 1000,
      sport: String(raw.activityType ?? "RUNNING"),
      distanceMeters: finiteNumber(raw.distanceInMeters),
      movingSeconds: finiteNumber(raw.durationInSeconds),
      elapsedSeconds: finiteNumber(raw.durationInSeconds),
      averageHeartRate: finiteNumber(raw.averageHeartRateInBeatsPerMinute),
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
