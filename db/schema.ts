import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const athletes = sqliteTable("athletes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  distance: text("distance").notNull(),
  phase: text("phase").notNull(),
  week: text("week").notNull(),
  nextWorkout: text("next_workout").notNull(),
  /** Classe de preço aplicada na geração das cobranças. Vazio usa o padrão. */
  priceClass: text("price_class"),
  /**
   * Aluno que treina sem prova-alvo no momento.
   *
   * Sem esta marca, quem não corre prova ficava para sempre como "cadastro
   * incompleto" e o painel seguia cobrando um dado que não existe. A marca diz
   * que a ausência é intencional, e não um cadastro pela metade.
   */
  noTargetRace: integer("no_target_race"),
  status: text("status"),
  phone: text("phone"),
  email: text("email"),
  trainingDays: text("training_days"),
  integration: text("integration"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /**
   * Quando o aluno foi inativado. Nulo enquanto ativo.
   *
   * Aluno que sai é inativado, nunca apagado: o histórico de treinos, testes e
   * queixas continua valendo como registro do trabalho feito, e apagá-lo
   * destruiria o passado do atleta e as estatísticas do treinador.
   */
  archivedAt: integer("archived_at"),
  archivedReason: text("archived_reason"),
  /**
   * Treinador dono deste aluno.
   *
   * O sistema nasceu para um treinador só e nenhuma tabela guardava esse
   * vínculo. Como todas as outras se ligam ao aluno por `athlete_name`, marcar
   * o dono aqui basta para separar as carteiras: o que cada treinador enxerga
   * decorre de quais alunos são dele. Nulo significa um aluno anterior a esta
   * coluna, que continua pertencendo ao treinador principal.
   */
  coachEmail: text("coach_email"),
}, (table) => ({
  /**
   * O nome do aluno é a chave que liga ficha, treinos, testes, provas e
   * cobranças — `athlete_name` aparece em dezoito tabelas. Sem unicidade, dois
   * homônimos compartilhariam silenciosamente todo o histórico um do outro.
   */
  nameIdx: uniqueIndex("athletes_name_idx").on(table.name),
}));

export const athleteProfiles = sqliteTable("athlete_profiles", {
  athleteName: text("athlete_name").primaryKey(),
  phone: text("phone"),
  birthDate: text("birth_date"),
  objective: text("objective"),
  integration: text("integration"),
  trainingDays: text("training_days").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const athletePlanning = sqliteTable("athlete_planning", {
  athleteName: text("athlete_name").primaryKey(),
  plan: text("plan").notNull(),
  phase: text("phase").notNull(),
  weekNumber: integer("week_number").notNull(),
  totalWeeks: integer("total_weeks").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const performanceTests = sqliteTable("performance_tests", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  testDate: text("test_date").notNull(),
  distanceKm: integer("distance_km").notNull(),
  totalSeconds: integer("total_seconds").notNull(),
  age: integer("age").notNull(),
  vam: text("vam").notNull(),
  vo2: text("vo2").notNull(),
  fcMax: integer("fc_max").notNull(),
  paceSeconds: text("pace_seconds").notNull(),
  zones: text("zones").notNull(),
  tempoRuns: text("tempo_runs").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  athleteDateIdx: index("performance_tests_athlete_date_idx").on(table.athleteName, table.testDate),
}));

export const trainingWeeks = sqliteTable("training_weeks", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  weekStart: text("week_start").notNull(),
  plan: text("plan").notNull(),
  phase: text("phase").notNull(),
  weekLabel: text("week_label").notNull(),
  trainingDays: text("training_days").notNull(),
  sessions: text("sessions").notNull(),
  status: text("status").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const painReports = sqliteTable("pain_reports", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  bodyArea: text("body_area").notNull(),
  intensity: integer("intensity").notNull(),
  trainingImpact: text("training_impact").notNull(),
  note: text("note"),
  status: text("status").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /* Acompanhamento da queixa, do aviso do aluno até a alta. */
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
  contactedAt: integer("contacted_at"),
  coachNote: text("coach_note"),
  resolution: text("resolution"),
  resolvedAt: integer("resolved_at"),
  linkedWeekStart: text("linked_week_start"),
});

/** Cada movimento de um relato de dor: contato, avaliação, ajuste e desfecho. */
export const painReportUpdates = sqliteTable("pain_report_updates", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  reportIdx: index("pain_report_updates_report_idx").on(table.reportId, table.createdAt),
}));

export const trainingFeedbacks = sqliteTable("training_feedbacks", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  weekStart: text("week_start"),
  workoutDay: text("workout_day"),
  feeling: text("feeling").notNull(),
  note: text("note"),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  reviewedAt: integer("reviewed_at"),
}, (table) => ({
  statusIdx: index("training_feedbacks_status_created_idx").on(table.status, table.createdAt),
  athleteIdx: index("training_feedbacks_athlete_created_idx").on(table.athleteName, table.createdAt),
}));

export const workoutExecutions = sqliteTable("workout_executions", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  weekStart: text("week_start").notNull(),
  workoutDay: text("workout_day").notNull(),
  plannedMinutes: integer("planned_minutes"),
  plannedKm: text("planned_km"),
  actualMinutes: integer("actual_minutes"),
  actualKm: text("actual_km"),
  correctPercentage: integer("correct_percentage").notNull(),
  wrongPercentage: integer("wrong_percentage").notNull(),
  classification: text("classification").notNull(),
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /* Conclusão explícita e métricas vindas das integrações. */
  status: text("status"),
  note: text("note"),
  averageHeartRate: integer("average_heart_rate"),
  averagePaceSeconds: integer("average_pace_seconds"),
  externalActivityId: text("external_activity_id"),
}, (table) => ({
  athleteIdx: index("workout_executions_athlete_created_idx").on(table.athleteName, table.createdAt),
}));

export const externalIntegrations = sqliteTable("external_integrations", {
  id: text("id").primaryKey(), athleteName: text("athlete_name").notNull(), provider: text("provider").notNull(),
  externalAthleteId: text("external_athlete_id"), scopes: text("scopes").notNull(), accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(), expiresAt: integer("expires_at").notNull(), status: text("status").notNull(),
  lastSyncAt: integer("last_sync_at"), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ athleteProviderIdx: uniqueIndex("external_integrations_athlete_provider_idx").on(table.athleteName, table.provider) }));

/** Fluxos OAuth em andamento. Guarda o `code_verifier` exigido pelo PKCE da Garmin. */
export const oauthFlows = sqliteTable("oauth_flows", {
  stateHash: text("state_hash").primaryKey(), athleteName: text("athlete_name").notNull(), actorEmail: text("actor_email").notNull(),
  provider: text("provider").notNull(), codeVerifier: text("code_verifier"), redirectUri: text("redirect_uri").notNull(),
  expiresAt: integer("expires_at").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Atividades importadas dos provedores, já normalizadas. */
export const externalActivities = sqliteTable("external_activities", {
  id: text("id").primaryKey(), athleteName: text("athlete_name").notNull(), provider: text("provider").notNull(),
  externalActivityId: text("external_activity_id").notNull(), startedAt: integer("started_at").notNull(), sport: text("sport").notNull(),
  distanceMeters: integer("distance_meters"), movingSeconds: integer("moving_seconds"), elapsedSeconds: integer("elapsed_seconds"),
  averageHeartRate: integer("average_heart_rate"), averagePaceSeconds: integer("average_pace_seconds"), rawPayload: text("raw_payload"),
  matchedWeekStart: text("matched_week_start"), matchedWorkoutDay: text("matched_workout_day"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  providerActivityIdx: uniqueIndex("external_activities_provider_activity_idx").on(table.provider, table.externalActivityId),
  athleteStartedIdx: index("external_activities_athlete_started_idx").on(table.athleteName, table.startedAt),
}));

/** Tokens que o Atalho do iOS usa para enviar treinos do Apple Saúde. */
export const deviceIngestTokens = sqliteTable("device_ingest_tokens", {
  tokenHash: text("token_hash").primaryKey(), athleteName: text("athlete_name").notNull(), provider: text("provider").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), lastUsedAt: integer("last_used_at"), revokedAt: integer("revoked_at"),
}, (table) => ({
  athleteIdx: index("device_ingest_tokens_athlete_idx").on(table.athleteName, table.provider),
}));

/** Contas de login da própria Zonas-App. */
export const userAccounts = sqliteTable("user_accounts", {
  id: text("id").primaryKey(), email: text("email").notNull(), name: text("name").notNull(), role: text("role").notNull(),
  athleteName: text("athlete_name"), passwordHash: text("password_hash").notNull(), passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(), status: text("status").notNull(),
  mustChangePassword: integer("must_change_password").notNull(), failedAttempts: integer("failed_attempts").notNull(),
  lockedUntil: integer("locked_until"), lastLoginAt: integer("last_login_at"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  emailIdx: uniqueIndex("user_accounts_email_idx").on(table.email),
}));

/** Sessões ativas. Guarda apenas o hash do token que vai no cookie. */
export const userSessions = sqliteTable("user_sessions", {
  tokenHash: text("token_hash").primaryKey(), userId: text("user_id").notNull(), email: text("email").notNull(),
  expiresAt: integer("expires_at").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  /**
   * Treinador que a conta de manutenção está visitando.
   *
   * Fica na sessão, e não no navegador, para que o servidor decida o que
   * mostrar: quem está de fato agindo continua sendo o `user_id`, e é esse
   * nome que vai para os registros de auditoria.
   */
  impersonatingUserId: text("impersonating_user_id"),
}, (table) => ({
  expiresIdx: index("user_sessions_expires_idx").on(table.expiresAt),
}));

export const financialSettings = sqliteTable("financial_settings", {
  id: text("id").primaryKey(), pixKey: text("pix_key"), pixName: text("pix_name"),
  defaultAmountCents: integer("default_amount_cents").notNull(), dueDay: integer("due_day").notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Faixas de preço da assessoria.
 *
 * O valor raramente é o mesmo para todo mundo, e antes só existia um padrão
 * único. A classe agrupa quem paga igual, para um reajuste alcançar o grupo de
 * uma vez; a negociação de um aluno continua sendo o valor da própria cobrança.
 */
/**
 * Planilhas-base criadas pelo treinador.
 *
 * As dez planilhas originais vivem no código. Quando o treinador muda o método
 * ou quer uma progressão própria, precisa de um lugar para criá-la — e as
 * semanas dela usam o mesmo `plan_template_overrides` que já edita as semanas
 * das planilhas de fábrica, em vez de um segundo mecanismo.
 */
export const customPlans = sqliteTable("custom_plans", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  distance: text("distance").notNull(), weeks: integer("weeks").notNull(),
  frequency: text("frequency").notNull(), level: text("level").notNull(),
  goal: text("goal").notNull(), phases: text("phases").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ nameIdx: uniqueIndex("custom_plans_name_idx").on(table.name) }));

export const priceClasses = sqliteTable("price_classes", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  amountCents: integer("amount_cents").notNull(), dueDay: integer("due_day").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ nameIdx: uniqueIndex("price_classes_name_idx").on(table.name) }));

export const studentPayments = sqliteTable("student_payments", {
  id: text("id").primaryKey(), athleteName: text("athlete_name").notNull(), referenceMonth: text("reference_month").notNull(),
  amountCents: integer("amount_cents").notNull(), dueDate: text("due_date").notNull(), status: text("status").notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  /** Comprovante anexado pelo treinador: imagem reduzida no navegador. */
  receiptImage: text("receipt_image"), receiptNote: text("receipt_note"),
  receiptAddedAt: integer("receipt_added_at", { mode: "timestamp_ms" }),
}, (table) => ({ athleteMonthIdx: uniqueIndex("student_payments_athlete_month_idx").on(table.athleteName, table.referenceMonth) }));

export const athleteRaces = sqliteTable("athlete_races", {
  id: text("id").primaryKey(), athleteName: text("athlete_name").notNull(), name: text("name").notNull(),
  raceDate: text("race_date").notNull(), distance: text("distance").notNull(), city: text("city"),
  goal: text("goal"), priority: text("priority").notNull(), status: text("status").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const personalRecords = sqliteTable("personal_records", {
  id: text("id").primaryKey(), athleteName: text("athlete_name").notNull(), distance: text("distance").notNull(),
  resultTime: text("result_time").notNull(), raceDate: text("race_date"), eventName: text("event_name"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const athleteAccess = sqliteTable("athlete_access", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull(),
  invitedAt: integer("invited_at", { mode: "timestamp_ms" }),
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  lastAccessAt: integer("last_access_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  athleteNameIdx: uniqueIndex("athlete_access_athlete_name_idx").on(table.athleteName),
  emailIdx: uniqueIndex("athlete_access_email_idx").on(table.email),
}));

export const accessRequests = sqliteTable("access_requests", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  objective: text("objective"),
  distance: text("distance").notNull(),
  trainingDays: text("training_days").notNull(),
  integration: text("integration").notNull(),
  status: text("status").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => ({
  emailIdx: uniqueIndex("access_requests_email_idx").on(table.email),
  statusIdx: index("access_requests_status_idx").on(table.status, table.createdAt),
}));

export const accessAuditLog = sqliteTable("access_audit_log", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  previousEmail: text("previous_email"),
  newEmail: text("new_email").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  athleteCreatedIdx: index("access_audit_log_athlete_created_idx").on(table.athleteName, table.createdAt),
}));

export const dataBackups = sqliteTable("data_backups", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  payload: text("payload").notNull(),
  recordCount: integer("record_count").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  restoredBy: text("restored_by"),
  restoredAt: integer("restored_at", { mode: "timestamp_ms" }),
}, (table) => ({
  createdIdx: index("data_backups_created_idx").on(table.createdAt),
}));

export const requestRateLimits = sqliteTable("request_rate_limits", {
  id: text("id").primaryKey(),
  actorEmail: text("actor_email").notNull(),
  route: text("route").notNull(),
  method: text("method").notNull(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  actorWindowIdx: index("request_rate_limits_actor_window_idx").on(table.actorEmail, table.windowStart),
}));

export const securityEvents = sqliteTable("security_events", {
  id: text("id").primaryKey(),
  actorEmail: text("actor_email").notNull(),
  eventType: text("event_type").notNull(),
  route: text("route").notNull(),
  details: text("details").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  createdIdx: index("security_events_created_idx").on(table.createdAt),
}));

export const requestDeduplication = sqliteTable("request_deduplication", {
  id: text("id").primaryKey(),
  requestToken: text("request_token").notNull(),
  actorEmail: text("actor_email").notNull(),
  route: text("route").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  expiresIdx: index("request_deduplication_expires_idx").on(table.expiresAt),
}));

export const trainingWeekAudit = sqliteTable("training_week_audit", {
  id: text("id").primaryKey(),
  athleteName: text("athlete_name").notNull(),
  weekStart: text("week_start").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  changedFields: text("changed_fields").notNull(),
  previousSnapshot: text("previous_snapshot"),
  newSnapshot: text("new_snapshot").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  athleteWeekIdx: index("training_week_audit_athlete_week_idx").on(table.athleteName, table.weekStart, table.createdAt),
}));

export const applicationErrors = sqliteTable("application_errors", {
  id: text("id").primaryKey(),
  area: text("area").notNull(),
  errorCode: text("error_code").notNull(),
  method: text("method").notNull(),
  statusCode: integer("status_code").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  createdIdx: index("application_errors_created_idx").on(table.createdAt),
}));

export const planTemplateOverrides = sqliteTable("plan_template_overrides", {
  id: text("id").primaryKey(),
  planName: text("plan_name").notNull(),
  weekNumber: integer("week_number").notNull(),
  sessionsJson: text("sessions_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({
  planWeekIdx: uniqueIndex("plan_template_overrides_plan_week_idx").on(table.planName, table.weekNumber),
}));
