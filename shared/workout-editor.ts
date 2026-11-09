/** The array is the execution order; labels never determine position. */
export const FREE_ZONE = "__free__";
export type Activity = "run" | "walk";
export type StepUnit = "s" | "min" | "m" | "km";
export type SimpleEditorStep = {
  id: string; kind: "simple"; label: string; amount: number; unit: StepUnit;
  zone: string; activity: Activity;
};
export type RepeatEditorStep = {
  id: string; kind: "repeat"; label: string; repetitions: number;
  effort: number; effortUnit: "s" | "min" | "m"; effortZone: string; effortActivity: Activity;
  recovery: number; recoveryUnit: "s" | "min"; recoveryZone: string; recoveryActivity: Activity;
};
export type EditorStep = SimpleEditorStep | RepeatEditorStep;
type SavedStep = Record<string, unknown>;
const zoneForEditor = (value: unknown, fallback: string) =>
  value === null || String(value).toLowerCase() === "livre" ? FREE_ZONE : String(value || fallback);
const activity = (value: unknown): Activity => value === "walk" ? "walk" : "run";

export function readEditorSteps(steps: SavedStep[]): EditorStep[] {
  return steps.map((step, index): EditorStep => {
    const id = `saved-${index}`;
    if (step.kind === "repeat") return {
      id, kind: "repeat", label: String(step.label || "Série principal"),
      repetitions: Number(step.repetitions) || 1,
      effort: Number(step.effortMeters ?? step.effortSeconds ?? step.effortMinutes) || 1,
      effortUnit: step.effortMeters != null ? "m" : step.effortSeconds != null ? "s" : "min",
      effortZone: zoneForEditor(step.effortZone, "Z4"), effortActivity: activity(step.effortActivity),
      recovery: Number(step.recoverySeconds ?? step.recoveryMinutes ?? 1),
      recoveryUnit: step.recoverySeconds != null ? "s" : "min",
      recoveryZone: zoneForEditor(step.recoveryZone, "Z1"), recoveryActivity: activity(step.recoveryActivity),
    };
    const meters = Number(step.meters ?? step.distanceMeters);
    const unit: StepUnit = meters > 0 ? step.distanceUnit === "km" ? "km" : "m" : step.seconds != null ? "s" : "min";
    return {
      id, kind: "simple", label: String(step.label || "Passo adicional"), unit,
      amount: meters > 0 ? unit === "km" ? meters / 1000 : meters : Number(step.seconds ?? step.minutes) || 10,
      zone: zoneForEditor(step.zone, "Z2"), activity: activity(step.activity),
    };
  });
}

export function moveEditorStep(steps: EditorStep[], id: string, position: number): EditorStep[] {
  const from = steps.findIndex(step => step.id === id);
  if (from < 0 || !Number.isInteger(position) || position < 0 || position >= steps.length || from === position) return steps;
  const next = [...steps];
  const [step] = next.splice(from, 1);
  next.splice(position, 0, step);
  return next;
}

export function saveEditorSteps(steps: EditorStep[], paceFor: (zone: string) => string | undefined): SavedStep[] {
  const zone = (value: string) => value === FREE_ZONE ? null : value;
  const pace = (value: string) => value === FREE_ZONE ? undefined : paceFor(value);
  return steps.map(step => step.kind === "repeat" ? {
    kind: "repeat", label: step.label, repetitions: step.repetitions,
    ...(step.effortUnit === "m" ? { effortMeters: step.effort } : step.effortUnit === "s" ? { effortSeconds: step.effort } : { effortMinutes: step.effort }),
    effortZone: zone(step.effortZone), effortActivity: step.effortActivity,
    ...(pace(step.effortZone) ? { effortPace: pace(step.effortZone) } : {}),
    ...(step.recoveryUnit === "s" ? { recoverySeconds: step.recovery } : { recoveryMinutes: step.recovery }),
    recoveryZone: zone(step.recoveryZone), recoveryActivity: step.recoveryActivity,
    ...(pace(step.recoveryZone) ? { recoveryPace: pace(step.recoveryZone) } : {}),
  } : {
    kind: "simple", label: step.label, activity: step.activity,
    ...(step.unit === "m" || step.unit === "km" ? { meters: Math.round(step.amount * (step.unit === "km" ? 1000 : 1)), distanceUnit: step.unit } : step.unit === "s" ? { seconds: step.amount } : { minutes: step.amount }),
    zone: zone(step.zone), ...(pace(step.zone) ? { pace: pace(step.zone) } : {}),
  });
}
