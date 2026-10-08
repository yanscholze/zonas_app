export type FiveMinuteExecutionType = "continuous" | "run_walk";
export type FiveMinuteEffort = "maximum_sustainable" | "submaximal";

export const FIVE_MINUTE_TEST_EXPLANATION =
  "O teste registra a distância percorrida em 5 minutos. Quando realizado em corrida contínua e esforço máximo sustentável, pode fornecer uma estimativa da VAM. O resultado é uma estimativa de campo, não uma medida direta.";

export function calculateFiveMinuteTest(input: {
  distanceMeters: number;
  completed: boolean;
  executionType: FiveMinuteExecutionType;
  effortClassification: FiveMinuteEffort;
}) {
  const { distanceMeters, completed, executionType, effortClassification } = input;
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  if (!completed) {
    return {
      distanceMeters,
      meanSpeedKmh: null,
      meanPaceSecondsRaw: null,
      meanPaceSeconds: null,
      meanPaceLabel: null,
      estimatedVamKmh: null,
    };
  }

  const meanSpeedKmh = distanceMeters * 0.012;
  const meanPaceSecondsRaw = 300_000 / distanceMeters;
  const meanPaceSeconds = Math.round(meanPaceSecondsRaw);
  const estimatedVamKmh = executionType === "continuous" && effortClassification === "maximum_sustainable"
    ? meanSpeedKmh
    : null;
  return {
    distanceMeters,
    meanSpeedKmh,
    meanPaceSecondsRaw,
    meanPaceSeconds,
    meanPaceLabel: `${Math.floor(meanPaceSeconds / 60)}:${String(meanPaceSeconds % 60).padStart(2, "0")}/km`,
    estimatedVamKmh,
  };
}
