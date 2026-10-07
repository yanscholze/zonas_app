/** Dados medidos ficam separados da associação ao plano. Ausência nunca vira zero. */
export type Metrics = Partial<Record<string, number>>;
export type PlannedStage = {
  index: number; label: string; activity: string; seconds: number | null; meters: number | null;
  intensity: string; zone: string | null; paceFastSeconds: number | null; paceSlowSeconds: number | null;
};
export type ResultLap = {
  index: number; label: string; intensity: string | null; startedAt: number | null;
  metrics: Metrics; stageIndex: number | null; association: "explicit" | "sequence" | "unmatched";
};
export type ActivityResult = {
  version: 1; activityId: string; provider: string; title: string; startedAt: number; importedAt: number;
  workoutId: string | null; workoutMatch: "workout-id" | "date" | "unmatched";
  complete: boolean; mappingVersion?: number; summary: Metrics; laps: ResultLap[];
  stages: Array<PlannedStage & { metrics: Metrics | null; lapIndexes: number[] }>;
};

export const METRICS = [
  ["durationSeconds", "Tempo", "s"], ["elapsedSeconds", "Tempo total", "s"],
  ["movingSeconds", "Em movimento", "s"], ["distanceMeters", "Distância", "m"],
  ["paceSeconds", "Ritmo médio", "s/km"], ["averageHeartRate", "FC média", "bpm"],
  ["maxHeartRate", "FC máxima", "bpm"], ["minHeartRate", "FC mínima", "bpm"],
  ["averageCadence", "Cadência média", "passos/min"], ["maxCadence", "Cadência máxima", "passos/min"],
  ["averagePower", "Potência média", "W"], ["maxPower", "Potência máxima", "W"],
  ["normalizedPower", "Potência normalizada", "W"], ["calories", "Calorias", "kcal"],
  ["elevationGain", "Subida acumulada", "m"], ["elevationLoss", "Descida acumulada", "m"],
  ["averageSpeed", "Velocidade média", "m/s"], ["maxSpeed", "Velocidade máxima", "m/s"],
  ["strideLength", "Comprimento da passada", "cm"], ["verticalOscillation", "Oscilação vertical", "cm"],
  ["verticalRatio", "Razão vertical", "%"], ["groundContactTime", "Contato com o solo", "ms"],
  ["groundContactBalance", "Equilíbrio de contato", "%"],
  ["aerobicTrainingEffect", "Efeito aeróbico", ""], ["anaerobicTrainingEffect", "Efeito anaeróbico", ""],
  ["trainingLoad", "Carga do exercício", ""], ["averageTemperature", "Temperatura média", "°C"],
  ["minTemperature", "Temperatura mínima", "°C"], ["maxTemperature", "Temperatura máxima", "°C"],
] as const;

export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const FIELD_NAMES: Record<string, string[]> = {
  durationSeconds: ["durationSeconds", "duration", "run_time", "totalTimerTime", "total_timer_time"],
  elapsedSeconds: ["elapsedSeconds", "elapsedDuration", "totalElapsedTime"],
  movingSeconds: ["movingSeconds", "movingDuration", "movingTime"],
  distanceMeters: ["distanceMeters", "distance", "dis", "totalDistance"],
  averageHeartRate: ["averageHeartRate", "averageHR", "avgHeartRate", "avg_heart_rate"],
  maxHeartRate: ["maxHeartRate", "maxHR", "max_heart_rate"], minHeartRate: ["minHeartRate", "minHR"],
  paceSeconds: ["paceSeconds", "averagePaceSeconds"],
  averageCadence: ["averageCadence", "averageRunCadence", "averageRunningCadenceInStepsPerMinute"],
  maxCadence: ["maxCadence", "maxRunCadence", "maxRunningCadenceInStepsPerMinute"],
  averagePower: ["averagePower", "avgPower"], maxPower: ["maxPower"], normalizedPower: ["normalizedPower"],
  calories: ["calories", "calorie", "totalCalories"], elevationGain: ["elevationGain", "totalAscent"],
  elevationLoss: ["elevationLoss", "totalDescent"], averageSpeed: ["averageSpeed"], maxSpeed: ["maxSpeed"],
  strideLength: ["averageStrideLength", "avgStrideLength"],
  verticalOscillation: ["averageVerticalOscillation", "avgVerticalOscillation"],
  verticalRatio: ["averageVerticalRatio", "avgVerticalRatio"], groundContactTime: ["averageGroundContactTime", "avgGroundContactTime"],
  groundContactBalance: ["averageGroundContactBalance", "avgGroundContactBalance"],
  aerobicTrainingEffect: ["trainingEffect", "aerobicTrainingEffect"],
  anaerobicTrainingEffect: ["anaerobicTrainingEffect"], trainingLoad: ["activityTrainingLoad", "trainingLoad"],
  averageTemperature: ["averageTemperature"], minTemperature: ["minTemperature"], maxTemperature: ["maxTemperature"],
};

export function readMetrics(raw: Record<string, unknown>): Metrics {
  const metrics: Metrics = {};
  for (const [key, aliases] of Object.entries(FIELD_NAMES)) {
    for (const alias of [key, ...aliases]) {
      const value = numeric(raw[alias]);
      if (value !== null && (key.includes("Temperature") || value >= 0)) { metrics[key] = value; break; }
    }
  }
  if (metrics.distanceMeters && metrics.durationSeconds) metrics.paceSeconds = metrics.durationSeconds / (metrics.distanceMeters / 1000);
  else if (metrics.averageSpeed) metrics.paceSeconds = 1000 / metrics.averageSpeed;
  return metrics;
}

function positive(value: unknown): number | null { const n = numeric(value); return n !== null && n > 0 ? n : null; }
function intensityOf(label: string): string {
  const text = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/desaquec|volta a calma|cool/.test(text)) return "cooldown";
  if (/aquec|warm/.test(text)) return "warmup";
  if (/recup|pausa|descans|trote|rest/.test(text)) return "recovery";
  return "active";
}

/** Expande cada tiro e cada recuperação, na mesma ordem enviada ao relógio. */
export function expandStages(steps: unknown): PlannedStage[] {
  const stages: PlannedStage[] = [];
  const append = (raw: Record<string, unknown>, label: string, intensity = intensityOf(label)) => {
    if (stages.length >= 500) return;
    const target = object(raw.target);
    stages.push({ index: stages.length, label: label.slice(0, 160), intensity,
      activity: raw.activity === "walk" ? "walk" : "run",
      seconds: positive(raw.seconds) ?? (positive(raw.minutes) ? Number(raw.minutes) * 60 : null),
      meters: positive(raw.meters ?? raw.distanceMeters), zone: String(target.zone ?? raw.zone ?? "") || null,
      paceFastSeconds: positive(target.paceFastSeconds), paceSlowSeconds: positive(target.paceSlowSeconds),
    });
  };
  for (const value of Array.isArray(steps) ? steps.slice(0, 100) : []) {
    const raw = object(value);
    if (raw.kind !== "repeat" && raw.type !== "repeat") { append(raw, String(raw.label ?? "Etapa")); continue; }
    const effort = raw.effort ? object(raw.effort) : { seconds: raw.effortSeconds, minutes: raw.effortMinutes, meters: raw.effortMeters, activity: raw.effortActivity, zone: raw.effortZone };
    const recovery = raw.recovery ? object(raw.recovery) : { seconds: raw.recoverySeconds, minutes: raw.recoveryMinutes, meters: raw.recoveryMeters, activity: raw.recoveryActivity, zone: raw.recoveryZone };
    const repetitions = Math.min(100, Math.max(1, Math.floor(Number(raw.repetitions) || 1)));
    for (let repeat = 0; repeat < repetitions; repeat++) {
      append(effort, `${String(raw.label ?? "Tiro")} · ${repeat + 1}/${repetitions}`, "active");
      if (positive(recovery.seconds) || positive(recovery.minutes) || positive(recovery.meters)) append(recovery, `Recuperação · ${repeat + 1}/${repetitions}`, "recovery");
    }
  }
  return stages;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(object).filter(item => Object.keys(item).length > 0);
  const raw = object(value);
  for (const key of ["lapDTOs", "laps", "splits", "splitDTOs", "stepMetrics", "step_metrics"]) {
    if (Array.isArray(raw[key])) return rows(raw[key]);
  }
  return [];
}

function normalizeIntensity(value: unknown): string | null {
  const key = String(value ?? "").replace(/^INTERVAL_/i, "").toLowerCase().replace(/[_\s-]/g, "");
  if (key.includes("cooldown")) return "cooldown";
  if (key.includes("warmup")) return "warmup";
  if (["rest", "recovery", "recover"].includes(key)) return "recovery";
  if (["active", "interval", "work", "run"].includes(key)) return "active";
  return null;
}

function timestamp(raw: Record<string, unknown>): number | null {
  const value = numeric(raw.beginTimestamp ?? raw.startedAt);
  if (value !== null && value > 0) return value;
  const date = String(raw.startTimeGMT ?? raw.startTime ?? "");
  if (!date || /^\d+$/.test(date)) return null;
  const ms = Date.parse(date.includes("T") ? date : date.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : null;
}

export function remoteWorkoutId(raw: Record<string, unknown>): string | null {
  const metadata = object(raw.metadataDTO); const summary = object(raw.summaryDTO);
  const value = raw.workoutId ?? metadata.associatedWorkoutId ?? metadata.workoutId ?? summary.workoutId;
  return value !== null && value !== undefined && /^\d+$/.test(String(value)) && Number(value) > 0 ? String(value) : null;
}

/** Recupera as condições originais dos envios anteriores ao snapshot de etapas. */
export function stepsFromGarminWorkout(value: unknown): unknown[] | null {
  const raw = object(value);
  const segments = Array.isArray(raw.workoutSegments) ? raw.workoutSegments : [];
  if (segments.length !== 1) return null;
  const steps = object(segments[0]).workoutSteps;
  if (!Array.isArray(steps) || !steps.length) return null;
  const executable = (value: unknown) => {
    const step = object(value); const condition = object(step.endCondition).conditionTypeKey;
    const slowSpeed = positive(step.targetValueOne); const fastSpeed = positive(step.targetValueTwo);
    const label = String(step.description ?? object(step.stepType).stepTypeKey ?? "Etapa");
    return { type: "simple", label, activity: /^Caminhar\s*·/i.test(label) ? "walk" : "run",
      seconds: condition === "time" ? positive(step.endConditionValue) : null,
      meters: condition === "distance" ? positive(step.endConditionValue) : null,
      target: object(step.targetType).workoutTargetTypeKey === "pace.zone" && slowSpeed && fastSpeed
        ? { paceSlowSeconds: 1000 / slowSpeed, paceFastSeconds: 1000 / fastSpeed } : null };
  };
  const resolved: unknown[] = [];
  for (const value of steps) {
    const step = object(value);
    if (step.type === "ExecutableStepDTO") { resolved.push(executable(step)); continue; }
    if (step.type !== "RepeatGroupDTO" || !Array.isArray(step.workoutSteps) || step.workoutSteps.length < 1 || step.workoutSteps.length > 2) return null;
    resolved.push({ type: "repeat", label: String(object(step.workoutSteps[0]).description ?? "Tiro"),
      repetitions: positive(step.numberOfIterations) ?? 1, effort: executable(step.workoutSteps[0]),
      recovery: step.workoutSteps[1] ? executable(step.workoutSteps[1]) : {} });
  }
  return resolved;
}

/** FIT numera os passos executáveis antes da instrução que repete o grupo. */
function garminStepIndexes(steps: unknown): Map<number, number[]> {
  const indexes = new Map<number, number[]>(); let fitIndex = 0; let stageIndex = 0;
  for (const value of Array.isArray(steps) ? steps.slice(0, 100) : []) {
    const raw = object(value);
    if (raw.kind !== "repeat" && raw.type !== "repeat") { indexes.set(fitIndex++, [stageIndex++]); continue; }
    const recovery = raw.recovery ? object(raw.recovery) : { seconds: raw.recoverySeconds, minutes: raw.recoveryMinutes, meters: raw.recoveryMeters };
    const hasRecovery = Boolean(positive(recovery.seconds) || positive(recovery.minutes) || positive(recovery.meters));
    const effortIndex = fitIndex++; const recoveryIndex = hasRecovery ? fitIndex++ : null;
    const efforts: number[] = []; const recoveries: number[] = [];
    const repetitions = Math.min(100, Math.max(1, Math.floor(Number(raw.repetitions) || 1)));
    for (let repeat = 0; repeat < repetitions && stageIndex < 500; repeat++) {
      efforts.push(stageIndex++); if (hasRecovery && stageIndex < 500) recoveries.push(stageIndex++);
    }
    indexes.set(effortIndex, efforts); if (recoveryIndex !== null) indexes.set(recoveryIndex, recoveries);
    fitIndex++; // repeat_until_steps_cmplt no arquivo FIT, sem etapa executada.
  }
  return indexes;
}

function closeToPlan(lap: ResultLap, stage: PlannedStage): boolean {
  // Alguns dispositivos chamam de ACTIVE qualquer trecho correndo, inclusive
  // aquecimento. Uma marca específica de recuperação/aquecimento deve conferir.
  if (lap.intensity && lap.intensity !== "active" && lap.intensity !== stage.intensity) return false;
  if (stage.meters && lap.metrics.distanceMeters !== undefined) return Math.abs(lap.metrics.distanceMeters - stage.meters) <= Math.max(15, stage.meters * 0.15);
  if (stage.seconds && lap.metrics.durationSeconds !== undefined) return Math.abs(lap.metrics.durationSeconds - stage.seconds) <= Math.max(5, stage.seconds * 0.15);
  return false;
}

export function buildActivityResult(input: {
  provider: string; activityId: string; startedAt: number; raw: Record<string, unknown>;
  plannedSteps?: unknown; workoutMatch?: ActivityResult["workoutMatch"]; complete?: boolean; allowGarminStepIndexes?: boolean;
}): ActivityResult {
  const { raw } = input;
  const summaryRaw = { ...raw, ...object(raw.summaryDTO) };
  const explicit = rows(raw.stepMetrics ?? raw.step_metrics);
  const splitRows = rows(raw.splits);
  const typedRows = rows(raw.typedSplits);
  const source = explicit.length ? explicit : splitRows.length ? splitRows : typedRows.length ? typedRows : rows(raw.laps);
  const planned = expandStages(input.plannedSteps);
  const laps: ResultLap[] = source.slice(0, 500).map((lap, index) => {
    const typed = lap.lapIndex !== undefined ? typedRows.find(item => item.lapIndex === lap.lapIndex) ?? {} : {};
    const rawIndex = numeric(lap.plannedStepIndex ?? (explicit.length ? lap.stepIndex : null));
    const validIndex = rawIndex !== null && Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < planned.length;
    return { index, label: String(lap.label ?? `Volta ${index + 1}`).slice(0, 160),
      intensity: normalizeIntensity(lap.intensityType ?? typed.intensityType), startedAt: timestamp(lap),
      metrics: readMetrics({ ...lap, ...object(lap.metrics) }),
      stageIndex: validIndex ? rawIndex : null, association: validIndex ? "explicit" : "unmatched" };
  });
  const stageMetrics = new Map<number, Metrics>();
  if (input.provider === "Garmin" && input.workoutMatch === "workout-id" && input.allowGarminStepIndexes !== false && !explicit.length && splitRows.length) {
    const indexes = garminStepIndexes(input.plannedSteps); const occurrences = new Map<number, number>();
    const intervalGroups = typedRows.filter(group => /^INTERVAL_(WARMUP|ACTIVE|RECOVERY|REST|COOLDOWN)$/i.test(String(group.type ?? "")) && Array.isArray(group.lapIndexes))
      .sort((a, b) => Number((a.lapIndexes as number[])[0]) - Number((b.lapIndexes as number[])[0]));
    for (const group of intervalGroups) {
      const lapIds = [...new Set(group.lapIndexes as unknown[])];
      const members = lapIds.map(id => splitRows.findIndex(lap => lap.lapIndex === id));
      if (!members.length || members.some(index => index < 0 || index >= laps.length || laps[index].stageIndex !== null)) continue;
      const stepIds = members.map(index => numeric(splitRows[index].wktStepIndex));
      const stepIndex = stepIds[0];
      if (stepIndex === null || !Number.isInteger(stepIndex) || stepIds.some(id => id !== stepIndex)) continue;
      // Várias sessões dentro da atividade não compartilham o mesmo índice.
      if (members.some(index => numeric(splitRows[index].wktIndex) !== 0)) continue;
      const occurrence = occurrences.get(stepIndex) ?? 0;
      const stageIndex = indexes.get(stepIndex)?.[occurrence];
      occurrences.set(stepIndex, occurrence + 1);
      if (stageIndex === undefined || !planned[stageIndex] || normalizeIntensity(group.type) !== planned[stageIndex].intensity) continue;
      for (const index of members) { laps[index].stageIndex = stageIndex; laps[index].association = "explicit"; }
      stageMetrics.set(stageIndex, readMetrics(group));
    }
  }
  // Auto Lap não é uma etapa do treino. Só relacionamos a sequência quando os
  // limites medidos conferem e há workoutId ou marcações de intensidade.
  const hasMarkers = laps.some(lap => lap.intensity && lap.intensity !== "active");
  const sequence = planned.length > 0 && laps.length === planned.length &&
    (input.workoutMatch === "workout-id" || hasMarkers) && laps.every((lap, index) => closeToPlan(lap, planned[index]));
  if (sequence) for (const lap of laps) if (lap.stageIndex === null) { lap.stageIndex = lap.index; lap.association = "sequence"; }
  return {
    version: 1, provider: input.provider, activityId: input.activityId, startedAt: input.startedAt, importedAt: Date.now(),
    title: String(raw.activityName ?? raw.title ?? "Atividade concluída").slice(0, 160),
    workoutId: remoteWorkoutId(raw), workoutMatch: input.workoutMatch ?? "unmatched", complete: input.complete ?? true, mappingVersion: 2,
    summary: readMetrics(summaryRaw), laps,
    stages: planned.map(stage => {
      const stageLaps = laps.filter(lap => lap.stageIndex === stage.index);
      const measured = stageLaps.length === 1 ? stageLaps[0].metrics : stageLaps.length > 1 ? combineMetrics(stageLaps.map(lap => lap.metrics)) : null;
      return { ...stage, lapIndexes: stageLaps.map(lap => lap.index), metrics: measured ? { ...measured, ...stageMetrics.get(stage.index) } : null };
    }),
  };
}

function combineMetrics(parts: Metrics[]): Metrics {
  const combined: Metrics = {};
  for (const [key] of METRICS) {
    const present = parts.filter(part => part[key] !== undefined);
    if (!present.length) continue;
    if (["durationSeconds", "elapsedSeconds", "movingSeconds", "distanceMeters", "calories", "elevationGain", "elevationLoss"].includes(key)) {
      if (present.length === parts.length) combined[key] = present.reduce((sum, part) => sum + Number(part[key]), 0);
    } else if (key.startsWith("max")) combined[key] = Math.max(...present.map(part => Number(part[key])));
    else if (key.startsWith("min")) combined[key] = Math.min(...present.map(part => Number(part[key])));
    else if (present.every(part => Number(part.durationSeconds) > 0)) {
      const weight = present.reduce((sum, part) => sum + Number(part.durationSeconds), 0);
      combined[key] = present.reduce((sum, part) => sum + Number(part[key]) * Number(part.durationSeconds), 0) / weight;
    }
  }
  if (combined.durationSeconds && combined.distanceMeters) combined.paceSeconds = combined.durationSeconds / (combined.distanceMeters / 1000);
  return combined;
}

export function parseActivityResult(value: unknown): ActivityResult | null {
  try {
    const result = typeof value === "string" ? JSON.parse(value) : value;
    return result?.version === 1 && Array.isArray(result.laps) && Array.isArray(result.stages) ? result as ActivityResult : null;
  } catch { return null; }
}
