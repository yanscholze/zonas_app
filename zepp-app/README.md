# Mini-app ZonasApp para Amazfit (Zepp OS)

O relógio recebe o treino do dia e devolve o resultado **sem o aluno abrir nada**.

## Como funciona

```
ZonasApp ──GET /api/ingest/device/workout──▶ celular ──BLE──▶ relógio
relógio  ──BLE──▶ celular ──POST /api/ingest/device──▶ ZonasApp
```

O relógio não tem internet. Quem fala com o servidor é o **Side Service**, que
roda dentro do aplicativo Zepp no celular — inclusive com o mini-app fechado.

O aluno corre pelo aplicativo de esporte **nativo** do relógio, como sempre fez.
O mini-app só escuta o fim da atividade e repassa o que foi medido. É isso que
torna a sincronização invisível: ninguém muda de hábito.

## Arquivos

| | |
|---|---|
| `app.json` | manifesto, permissões e aparelhos suportados |
| `app-side/index.js` | Side Service — o lado com internet |
| `page/index.js` | aplicativo do relógio |
| `PAYLOAD.md` | os dois payloads, campo a campo |

## Compilar

```bash
npm i -g @zeppos/zeus-cli
cd zepp-app
zeus dev        # simulador
zeus build      # gera o .zab para publicar
```

## Ligar a um aluno

1. Na Zonas-App, o aluno abre **Mais → Integrações → Amazfit / Zepp → Conectar**
2. O token aparece **uma única vez** — o servidor guarda só o hash dele
3. No aplicativo Zepp do celular, instalar o mini-app e colar o token nas configurações

A partir daí não há passo manual.

## Decisões que valem saber

**Um token para os dois sentidos.** É a mesma autorização — *este aparelho fala
por este aluno*. Dois dobrariam o que se cola e o que se revoga pela metade.

**As zonas chegam resolvidas em ritmo.** O relógio não sabe o que é "Z1". A conta
cruza a planilha com o teste de desempenho do atleta e é feita no servidor; fazê-la
aqui obrigaria a mandar o teste inteiro para o relógio e a repetir a fórmula em
JavaScript, onde sairia do lugar na primeira mudança.

**Semana não liberada não chega ao relógio.** O aluno não deve ver o que o
treinador ainda está revisando, e furar isso pelo caminho que ninguém olha seria
pior que não ter o caminho.

**O resultado é guardado antes de enviar.** Se o celular estiver longe ou sem
rede — que é exatamente quando se corre —, o treino espera em vez de sumir. Só é
descartado quando o celular confirma a entrega.
