/**
 * Tradução de um treino da planilha para o formato de treino do Garmin Connect.
 *
 * Recebe o treino já resolvido — o mesmo formato plano que o relógio Amazfit
 * consome, com as zonas convertidas em ritmo — e devolve o JSON que o Garmin
 * aceita. Entra aqui `{type:"repeat", repetitions:6, effort:{seconds:60,
 * target:{paceFastSeconds:250}}}` e sai um `RepeatGroupDTO` com dois passos
 * dentro.
 *
 * É um módulo separado e sem acesso a banco nem a rede de propósito: tradução
 * de formato é a parte que dá errado em silêncio, e ela precisa ser testável
 * sem subir nada. Quem busca o treino é `treinoResolvido`, no index; quem
 * entrega ao Garmin é `garmin-conexao`.
 *
 * Os números mágicos (stepTypeId 1, conditionTypeId 2, …) não são invenção:
 * vêm da tabela que o Garmin publica em /workout-service/workout/types e estão
 * nomeados abaixo para que ninguém precise decorá-los.
 */

/* --- O vocabulário do Garmin ---------------------------------------------- */

/** Tipo de passo. O Garmin desenha cada um com cor e ícone próprios no relógio. */
const PASSO = {
  AQUECIMENTO: { id: 1, chave: "warmup" },
  DESAQUECIMENTO: { id: 2, chave: "cooldown" },
  INTERVALO: { id: 3, chave: "interval" },
  RECUPERACAO: { id: 4, chave: "recovery" },
  DESCANSO: { id: 5, chave: "rest" },
  REPETICAO: { id: 6, chave: "repeat" },
} as const;

/** O que encerra o passo: tempo, distância, ou o número de voltas de uma série. */
const FIM = {
  TEMPO: { id: 2, chave: "time" },
  DISTANCIA: { id: 3, chave: "distance" },
  VOLTAS: { id: 7, chave: "iterations" },
  BOTAO: { id: 1, chave: "lap.button" },
} as const;

/** O alvo do passo. Usamos faixa de ritmo; "sem alvo" é o padrão do Garmin. */
const ALVO = {
  NENHUM: { id: 1, chave: "no.target" },
  RITMO: { id: 6, chave: "pace.zone" },
} as const;

/**
 * Distância em metros precisa dizer em que unidade está.
 *
 * O `factor` 100 não é escala do valor — é como o Garmin guarda a precisão da
 * unidade. Omitir o bloco inteiro faz o relógio tratar o número como jardas em
 * conta configurada no sistema imperial.
 */
const UNIDADE_METRO = { unitId: 1, unitKey: "meter", factor: 100.0 };

/* --- O que entra ---------------------------------------------------------- */

export type AlvoDeRitmo = {
  zone: string;
  label: string;
  /** Segundos por km do limite lento da faixa. */
  paceSlowSeconds: number;
  /** Segundos por km do limite rápido — sempre menor que o lento. */
  paceFastSeconds: number;
};

export type TrechoSimples = {
  type: "simple";
  label: string;
  seconds: number | null;
  meters: number | null;
  target: AlvoDeRitmo | null;
};

export type TrechoRepetido = {
  type: "repeat";
  label: string;
  repetitions: number;
  effort: { seconds: number | null; meters: number | null; target: AlvoDeRitmo | null };
  recovery: { seconds: number | null; meters: number | null; target: AlvoDeRitmo | null };
};

export type Trecho = TrechoSimples | TrechoRepetido;

export type TreinoResolvido = {
  title: string;
  description: string;
  estimatedSeconds: number | null;
  estimatedMeters: number | null;
  maxHeartRate: number | null;
  steps: Trecho[];
};

/* --- Conversões ----------------------------------------------------------- */

/**
 * Segundos por quilômetro viram metros por segundo.
 *
 * O Garmin guarda alvo de ritmo como velocidade, não como ritmo: 5:00/km chega
 * lá como 3,333 m/s. Mandar 300 no lugar de 3,333 não dá erro — o treino sobe e
 * o relógio pede ao aluno que corra a 300 m/s. O erro só aparece na rua.
 */
export function ritmoParaVelocidade(segundosPorKm: number): number {
  if (!Number.isFinite(segundosPorKm) || segundosPorKm <= 0) return 0;
  return Number((1000 / segundosPorKm).toFixed(6));
}

/**
 * Decide o tipo do passo pelo rótulo que o treinador escreveu.
 *
 * O Garmin colore aquecimento e desaquecimento de forma distinta no relógio, e
 * acertar isso é o que faz o treino parecer nativo em vez de importado. A
 * planilha não tem um campo de tipo — tem o rótulo livre —, então a leitura é
 * pelo texto, sem acento e sem caixa, aceitando as formas que aparecem de fato.
 */
export function tipoDoPasso(rotulo: string): { id: number; chave: string } {
  const limpo = String(rotulo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/aquec|warm/.test(limpo) && !/desaquec/.test(limpo)) return PASSO.AQUECIMENTO;
  if (/desaquec|volta a calma|cool/.test(limpo)) return PASSO.DESAQUECIMENTO;
  if (/recup|pausa|descans|trote|rest/.test(limpo)) return PASSO.RECUPERACAO;
  return PASSO.INTERVALO;
}

type PassoGarmin = Record<string, unknown>;

/**
 * Um passo executável: quanto dura, o que o encerra e em que ritmo.
 *
 * `ordem` é contada em cima de TODOS os passos, inclusive os de dentro de uma
 * série e a própria série. O Garmin usa essa ordem para montar a fila no
 * relógio; numeração reiniciada dentro do grupo faz os passos aparecerem fora
 * de sequência.
 */
function passoExecutavel(
  ordem: number,
  tipo: { id: number; chave: string },
  duracao: { seconds: number | null; meters: number | null },
  alvo: AlvoDeRitmo | null,
  descricao: string,
  idDoGrupo: number | null,
): PassoGarmin {
  const passo: PassoGarmin = {
    type: "ExecutableStepDTO",
    stepId: null,
    stepOrder: ordem,
    stepType: { stepTypeId: tipo.id, stepTypeKey: tipo.chave, displayOrder: tipo.id },
    childStepId: idDoGrupo,
    description: descricao || null,
  };

  /* Distância manda sobre tempo quando os dois vierem. A planilha escreve
     "400 m" ou "10 min", nunca os dois para o mesmo trecho — mas se vierem,
     distância é a intenção mais específica.

     Sem nenhum dos dois, o encerramento é o botão de volta: é o que o Garmin
     faz com passo sem condição, e é honesto — o relógio espera o aluno decidir
     em vez de inventar uma duração que o treinador não escreveu. */
  if (Number.isFinite(duracao.meters) && (duracao.meters as number) > 0) {
    passo.endCondition = { conditionTypeId: FIM.DISTANCIA.id, conditionTypeKey: FIM.DISTANCIA.chave, displayOrder: FIM.DISTANCIA.id, displayable: true };
    passo.endConditionValue = Number(duracao.meters);
    passo.preferredEndConditionUnit = UNIDADE_METRO;
  } else if (Number.isFinite(duracao.seconds) && (duracao.seconds as number) > 0) {
    passo.endCondition = { conditionTypeId: FIM.TEMPO.id, conditionTypeKey: FIM.TEMPO.chave, displayOrder: FIM.TEMPO.id, displayable: true };
    passo.endConditionValue = Number(duracao.seconds);
  } else {
    passo.endCondition = { conditionTypeId: FIM.BOTAO.id, conditionTypeKey: FIM.BOTAO.chave, displayOrder: FIM.BOTAO.id, displayable: true };
    passo.endConditionValue = null;
  }

  /* O alvo de ritmo. `targetValueOne` é sempre a MENOR velocidade — ou seja, o
     ritmo mais lento da faixa. Trocar a ordem faz o relógio avisar o aluno que
     ele está rápido demais quando está no ritmo certo. */
  if (alvo && Number.isFinite(alvo.paceSlowSeconds) && Number.isFinite(alvo.paceFastSeconds)) {
    passo.targetType = { workoutTargetTypeId: ALVO.RITMO.id, workoutTargetTypeKey: ALVO.RITMO.chave, displayOrder: ALVO.RITMO.id };
    passo.targetValueOne = ritmoParaVelocidade(alvo.paceSlowSeconds);
    passo.targetValueTwo = ritmoParaVelocidade(alvo.paceFastSeconds);
  } else {
    passo.targetType = { workoutTargetTypeId: ALVO.NENHUM.id, workoutTargetTypeKey: ALVO.NENHUM.chave, displayOrder: ALVO.NENHUM.id };
    passo.targetValueOne = null;
    passo.targetValueTwo = null;
  }

  return passo;
}

/**
 * Traduz o treino inteiro.
 *
 * Devolve o corpo que `POST /workout-service/workout` aceita. O nome sai do
 * título da planilha; a descrição carrega o que o treinador escreveu, que é o
 * que o aluno lê no relógio antes de começar.
 */
export function treinoParaGarmin(treino: TreinoResolvido, nome?: string): Record<string, unknown> {
  const passos: PassoGarmin[] = [];
  let ordem = 1;
  let grupos = 0;

  for (const trecho of treino.steps ?? []) {
    if (trecho.type === "repeat") {
      grupos += 1;
      const idDoGrupo = grupos;
      const grupo: PassoGarmin = {
        type: "RepeatGroupDTO",
        stepId: null,
        stepOrder: ordem++,
        stepType: { stepTypeId: PASSO.REPETICAO.id, stepTypeKey: PASSO.REPETICAO.chave, displayOrder: PASSO.REPETICAO.id },
        childStepId: idDoGrupo,
        numberOfIterations: Math.max(1, Number(trecho.repetitions) || 1),
        smartRepeat: false,
        endCondition: { conditionTypeId: FIM.VOLTAS.id, conditionTypeKey: FIM.VOLTAS.chave, displayOrder: FIM.VOLTAS.id, displayable: false },
        endConditionValue: Math.max(1, Number(trecho.repetitions) || 1),
        workoutSteps: [] as PassoGarmin[],
      };

      (grupo.workoutSteps as PassoGarmin[]).push(
        passoExecutavel(ordem++, PASSO.INTERVALO, trecho.effort, trecho.effort.target, trecho.label, idDoGrupo),
      );

      /* A recuperação só entra se tiver duração. Série sem pausa declarada é
         série contínua — acrescentar um passo de zero segundos faria o relógio
         apitar entre as repetições sem ter o que executar. */
      const temPausa =
        (Number.isFinite(trecho.recovery.seconds) && (trecho.recovery.seconds as number) > 0) ||
        (Number.isFinite(trecho.recovery.meters) && (trecho.recovery.meters as number) > 0);
      if (temPausa) {
        (grupo.workoutSteps as PassoGarmin[]).push(
          passoExecutavel(ordem++, PASSO.RECUPERACAO, trecho.recovery, trecho.recovery.target, "Recuperação", idDoGrupo),
        );
      }

      passos.push(grupo);
      continue;
    }

    passos.push(passoExecutavel(ordem++, tipoDoPasso(trecho.label), trecho, trecho.target, trecho.label, null));
  }

  return {
    workoutId: null,
    workoutName: (nome || treino.title || "Treino").slice(0, 80),
    description: (treino.description || "").slice(0, 1024) || null,
    updatedDate: null,
    createdDate: null,
    sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
    estimatedDurationInSecs: Number.isFinite(treino.estimatedSeconds) ? treino.estimatedSeconds : null,
    estimatedDistanceInMeters: Number.isFinite(treino.estimatedMeters) ? treino.estimatedMeters : null,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
        workoutSteps: passos,
      },
    ],
  };
}
