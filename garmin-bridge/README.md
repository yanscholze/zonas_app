# Garmin Bridge — experimento, **inativo**

> **Nada no ZonasApp chama este serviço.** Ele não roda em produção, não é
> publicado, e nenhuma linha do worker ou do cliente aponta para ele. Está aqui
> como registro de um experimento que deu certo.

## O que ele provou

Yan rodou este serviço no terminal para responder a uma pergunta: o
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect)
consegue mesmo entrar na conta de um atleta e publicar um treino no calendário
do Garmin Connect?

Consegue. Foi essa confirmação que autorizou construir a integração de verdade —
sem ela, teríamos escrito um cliente inteiro apostando num caminho não
documentado.

## O que está no ar, em vez dele

`worker/garmin-conexao.ts`, dentro do próprio Worker. Faz o mesmo login e o mesmo
envio, em TypeScript, sem um segundo serviço para hospedar e manter. O caminho é
idêntico: `sso.garmin.com` para entrar, `diauth` para trocar o ticket por token,
`connectapi` para subir e agendar o treino.

## Por que continua aqui

**É a saída se o Worker for barrado.** Em 18/09/2026 foi medido que um Worker
alcança o Garmin com as mesmas respostas que uma máquina doméstica. Se isso mudar
— o Garmin passar a filtrar endereços de datacenter, por exemplo —, o Python tem
uma carta que o Worker não tem: o `curl_cffi` imita a impressão digital TLS do
Chrome. Reescrever isto do zero sob pressão seria pior do que mantê-lo parado.

**E o normalizador dele não é código morto.** `worker/integrations.ts` entende o
formato que o `python-garminconnect` devolve — `activityId`, `beginTimestamp`,
`activityType.typeKey` — porque é o MESMO formato que o nosso cliente em
TypeScript receberá no dia em que importar atividades: os dois falam com a mesma
API interna do Garmin. O outro formato aceito ali, `startTimeInSeconds`, é o da
Activity API oficial, que passa a valer se o programa de desenvolvedores for
aprovado.

## Se um dia precisar ligar

```bash
cd garmin-bridge
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GARMIN_BRIDGE_SECRET="algo-longo-e-aleatorio"
uvicorn app:app --port 8000
```

Sem `GARMIN_BRIDGE_SECRET` ele recusa toda requisição com 500 — falha fechado, de
propósito. `.env` e `tokenstore/` estão no `.gitignore`: o repositório é público e
o tokenstore guarda a sessão Garmin dos atletas.

**Religá-lo é uma decisão, não um detalhe.** Passa a existir um segundo lugar que
faz login no Garmin, e dois clientes para o mesmo serviço divergem na primeira
mudança que o Garmin fizer. Se for para voltar, o certo é ele substituir o
caminho do Worker — não conviver com ele.
