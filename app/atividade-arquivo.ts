"use client";

/**
 * Leitura do arquivo exportado do relógio.
 *
 * Importar por link do Strava só funcionaria para quem já autorizou a
 * integração — ler a página pública seria raspagem, proibida pelos termos da
 * API. O arquivo exportado não depende de aprovação de fabricante nenhum e
 * funciona com qualquer marca: o aluno exporta a atividade e envia.
 *
 * A leitura acontece aqui, no navegador. O arquivo inteiro nunca sobe: o que
 * vai para o servidor são o tempo e a distância, os mesmos dois números que o
 * aluno digitaria à mão. É menos dado trafegando e menos dado guardado.
 */

export type AtividadeLida = {
  minutos: number;
  km: number;
  inicio: string | null;
  formato: "GPX" | "TCX";
  pontos: number;
};

export class ArquivoInvalido extends Error {}

const RAIO_DA_TERRA_M = 6_371_000;

/** Distância entre duas coordenadas, em metros. */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (grau: number) => (grau * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_DA_TERRA_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

function texto(no: Element | null): string {
  return no?.textContent?.trim() ?? "";
}

/**
 * TCX já traz os totais somados por volta, então não há o que calcular: basta
 * somar as voltas. É o formato preferido quando o arquivo tem os dois.
 */
function leTcx(documento: Document): AtividadeLida | null {
  const voltas = [...documento.getElementsByTagName("Lap")];
  if (!voltas.length) return null;
  let segundos = 0;
  let metros = 0;
  for (const volta of voltas) {
    segundos += Number(texto(volta.getElementsByTagName("TotalTimeSeconds")[0] ?? null)) || 0;
    metros += Number(texto(volta.getElementsByTagName("DistanceMeters")[0] ?? null)) || 0;
  }
  if (segundos <= 0 && metros <= 0) return null;
  const inicio = voltas[0].getAttribute("StartTime");
  return {
    minutos: Math.round(segundos / 60),
    km: Number((metros / 1000).toFixed(2)),
    inicio: inicio ? inicio.slice(0, 10) : null,
    formato: "TCX",
    pontos: documento.getElementsByTagName("Trackpoint").length,
  };
}

/**
 * GPX guarda só os pontos: a distância sai da soma dos trechos e a duração, do
 * primeiro ao último horário. Pontos sem coordenada ou sem hora são ignorados
 * em vez de virarem zero no meio da conta.
 */
function leGpx(documento: Document): AtividadeLida | null {
  const pontos = [...documento.getElementsByTagName("trkpt")];
  if (pontos.length < 2) return null;
  let metros = 0;
  let anterior: { lat: number; lon: number } | null = null;
  const horarios: number[] = [];
  for (const ponto of pontos) {
    const lat = Number(ponto.getAttribute("lat"));
    const lon = Number(ponto.getAttribute("lon"));
    const quando = Date.parse(texto(ponto.getElementsByTagName("time")[0] ?? null));
    if (Number.isFinite(quando)) horarios.push(quando);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (anterior) metros += haversine(anterior.lat, anterior.lon, lat, lon);
    anterior = { lat, lon };
  }
  if (!horarios.length && metros <= 0) return null;
  const segundos = horarios.length > 1 ? (Math.max(...horarios) - Math.min(...horarios)) / 1000 : 0;
  return {
    minutos: Math.round(segundos / 60),
    km: Number((metros / 1000).toFixed(2)),
    inicio: horarios.length ? new Date(Math.min(...horarios)).toISOString().slice(0, 10) : null,
    formato: "GPX",
    pontos: pontos.length,
  };
}

/** Lê um .gpx ou .tcx exportado e devolve tempo e distância. */
export async function leArquivoDeAtividade(arquivo: File): Promise<AtividadeLida> {
  if (arquivo.size > 12 * 1024 * 1024) {
    throw new ArquivoInvalido("O arquivo passa de 12 MB. Exporte a atividade sozinha, sem o histórico inteiro.");
  }
  const conteudo = await arquivo.text();
  const documento = new DOMParser().parseFromString(conteudo, "application/xml");
  if (documento.getElementsByTagName("parsererror").length) {
    throw new ArquivoInvalido("Não foi possível ler este arquivo. Ele precisa ser o .gpx ou .tcx exportado pelo relógio ou pelo aplicativo.");
  }
  const lido = leTcx(documento) ?? leGpx(documento);
  if (!lido) {
    throw new ArquivoInvalido("O arquivo não tem tempo nem distância registrados. Confira se exportou a atividade completa.");
  }
  if (lido.minutos <= 0 && lido.km <= 0) {
    throw new ArquivoInvalido("A atividade veio sem duração e sem distância. Não há o que comparar com o treino planejado.");
  }
  return lido;
}
