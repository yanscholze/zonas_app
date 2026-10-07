import { METRICS, type ActivityResult, type Metrics, type PlannedStage } from "../shared/activity-results";

function time(value: number): string {
  const seconds = Math.round(value);
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function format(value: number, unit: string): string {
  if (unit === "s") return time(value);
  if (unit === "s/km") return `${time(value)} /km`;
  if (unit === "m" && value >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`;
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}

function MetricList({ metrics }: { metrics: Metrics }) {
  return <dl className="workout-result-metrics">{METRICS.map(([key, label, unit]) => {
    const value = metrics[key];
    return typeof value === "number" && Number.isFinite(value) ? <div key={key}><dt>{label}</dt><dd>{format(value, unit)}</dd></div> : null;
  })}</dl>;
}

function planned(stage: PlannedStage): string {
  const parts = [stage.activity === "walk" ? "Caminhar" : "Correr",
    stage.meters ? format(stage.meters, "m") : stage.seconds ? format(stage.seconds, "s") : "até avançar a etapa",
    stage.zone];
  if (stage.paceFastSeconds && stage.paceSlowSeconds) parts.push(`${time(stage.paceFastSeconds)}–${time(stage.paceSlowSeconds)} /km`);
  return parts.filter(Boolean).join(" · ");
}

/** A mesma leitura do resultado na ficha do professor e na área do aluno. */
export function WorkoutResultDetails({ result, expanded = false }: { result?: ActivityResult | null; expanded?: boolean }) {
  if (!result) return null;
  const unmatched = result.laps.filter(lap => lap.stageIndex === null);
  const sequence = result.laps.some(lap => lap.association === "sequence");
  const date = new Date(result.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  return <details className="workout-result" open={expanded}>
    <summary>Resultado de {result.provider} · métricas e etapas</summary>
    <div className="workout-result-body">
      <header><b>{result.title}</b><small>{date} · {result.workoutMatch === "workout-id" ? "Vinculado ao treino enviado" : result.workoutMatch === "date" ? "Relacionado ao treino desta data" : "Atividade recebida"}</small></header>
      {!result.complete && <p>O resumo chegou. Alguns detalhes ainda aguardam nova sincronização.</p>}
      <MetricList metrics={result.summary}/>
      {result.stages.length > 0 && <section aria-label="Resultados por etapa"><h3>Etapas planejadas e realizadas</h3>
        {sequence && <p>Etapas relacionadas pela sequência e pelos limites das voltas registradas. Confira a correspondência abaixo.</p>}
        {result.stages.map(stage => <article className="workout-result-stage" key={stage.index}>
          <h4>{stage.index + 1}. {stage.label}</h4><p>Planejado: {planned(stage)}</p>
          {stage.metrics ? <MetricList metrics={stage.metrics}/> : <p className="workout-result-missing">O relógio não enviou uma volta identificável para esta etapa.</p>}
        </article>)}
      </section>}
      {unmatched.length > 0 && <section aria-label="Voltas registradas"><h3>Voltas registradas no relógio</h3>
        <p>Estas voltas não puderam ser relacionadas com segurança às etapas planejadas.</p>
        {unmatched.map(lap => <article className="workout-result-stage" key={lap.index}><h4>{lap.label}</h4><MetricList metrics={lap.metrics}/></article>)}
      </section>}
      {!result.laps.length && <p>Esta atividade trouxe somente o resumo, sem métricas separadas por etapa.</p>}
    </div>
  </details>;
}
