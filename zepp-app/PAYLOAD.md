# Modelo de payload — ZonasApp ↔ Zepp OS

Os dois sentidos, com os nomes exatos que o servidor produz e consome.
Este arquivo descreve o que o código já faz; ele não é a fonte, o código é.

---

## 1. Treino do dia — servidor → relógio

`GET /api/ingest/device/workout`
Cabeçalho: `x-zonas-ingest-token: <48 hex>`

As zonas (Z1–Z5) **já vêm resolvidas em ritmo**. O relógio não sabe o que é "Z1":
a conta cruza a planilha com o teste de desempenho aprovado do atleta, e ela é do
servidor — fazê-la no relógio obrigaria a mandar o teste inteiro para lá e a
repetir a fórmula em JavaScript, onde sairia do lugar na primeira mudança.

```json
{
  "athlete": "Ana Souza",
  "day": "QUA",
  "date": "2026-09-12",
  "workout": {
    "title": "Velocidade 8 × 200 m",
    "description": "8 × 200 m · recuperação entre cada série",
    "estimatedSeconds": 2280,
    "estimatedMeters": 6600,
    "maxHeartRate": 190,
    "steps": [
      {
        "type": "simple",
        "label": "Aquecimento",
        "seconds": 600,
        "meters": null,
        "target": { "zone": "Z1", "label": "Recuperação", "paceSlowSeconds": 420, "paceFastSeconds": 360 }
      },
      {
        "type": "repeat",
        "label": "Série principal",
        "repetitions": 8,
        "effort":   { "seconds": null, "meters": 200, "target": { "zone": "Z5", "label": "VO₂ máximo", "paceSlowSeconds": 240, "paceFastSeconds": 218 } },
        "recovery": { "seconds": 90,  "meters": null, "target": { "zone": "Z1", "label": "Recuperação", "paceSlowSeconds": 420, "paceFastSeconds": 360 } }
      },
      {
        "type": "simple",
        "label": "Desaquecimento",
        "seconds": 480,
        "meters": null,
        "target": { "zone": "Z1", "label": "Recuperação", "paceSlowSeconds": 420, "paceFastSeconds": 360 }
      }
    ]
  },
  "plan": { "name": "5 km Prata", "phase": "Específica", "week": "7 de 13" }
}
```

**Regras que o relógio pode assumir**

| Campo | Garantia |
|---|---|
| `steps[].type` | sempre `"simple"` ou `"repeat"` — não há terceiro |
| `seconds` / `meters` | um dos dois vem preenchido; o outro vem `null` |
| `target` | `null` quando o atleta ainda não tem teste aprovado |
| `paceSlowSeconds` | segundos por km do limite **lento** da faixa |
| `paceFastSeconds` | segundos por km do limite **rápido** — sempre menor que o lento |

**Quando não há treino**, `workout` vem `null` e `reason` diz por quê:

```json
{ "athlete": "Ana Souza", "day": "QUA", "workout": null, "reason": "week_not_released" }
```

`reason` é `"week_not_released"` (o treinador ainda não liberou) ou `"rest_day"`
(dia de descanso). Semana não liberada **não** é enviada ao relógio: o aluno não
deve ver o que o treinador ainda está revisando, e furar isso pelo caminho que
ninguém está olhando seria pior que não ter o caminho.

---

## 2. Resultado da corrida — relógio → servidor

`POST /api/ingest/device`
Cabeçalho: `x-zonas-ingest-token: <48 hex>`

Os nomes dos campos são **os da nuvem Zepp** — `trackid`, `dis`, `run_time`,
`avg_heart_rate`. Não é coincidência nem cópia: o normalizador do servidor já os
entende, e inventar nomes novos exigiria um segundo normalizador para a mesma
informação.

```json
{
  "workouts": [
    {
      "trackid": "1757683200",
      "start_time": 1757683200,
      "end_time": 1757685480,
      "type": "run",
      "dis": 6612,
      "run_time": 2280,
      "avg_heart_rate": 164,
      "calorie": 498,
      "origem": "zepp-os-miniapp"
    }
  ]
}
```

`trackid` e `start_time` são obrigatórios — sem eles a atividade é descartada em
silêncio pelo normalizador. `dis` é em **metros** e `run_time` em **segundos**.

Resposta: `{ "imported": 1, "received": 1 }`. `imported` menor que `received`
significa atividade repetida, que o banco ignora por `INSERT OR IGNORE` — o
relógio pode reenviar sem medo de duplicar.

---

## Por que um token só para os dois sentidos

É a mesma autorização: *este aparelho fala por este aluno*. Dois tokens dobrariam
o que o aluno cola e o que pode ser revogado pela metade — com um, desconectar o
Amazfit encerra os dois sentidos de uma vez.

O token é gravado como hash: o servidor nunca guarda o valor, e por isso ele
aparece uma única vez na tela. Perdido, gera-se outro, e o anterior é revogado no
mesmo ato — token antigo que continua valendo é token que ninguém sabe onde está.
