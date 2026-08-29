# ZonasApp — código-fonte para desenvolvimento

Plataforma de treinamento de corrida com área do treinador e área do atleta,
autenticação própria e integração com Strava, Garmin, Amazfit/Zepp e Apple Saúde.

## Executar localmente

Requisitos: Node.js 22.13 ou superior e npm.

```bash
npm ci
npm run dev
```

O Vite sobe em `http://localhost:5173`. Em `localhost` (e em `terminal.local`) o
Worker entra em modo de prévia local: `isLocalAgentPreview` dispensa o cabeçalho
de autenticação do ChatGPT, trata o visitante como professor
(`preview@zonasapp.local`) e desliga o limitador de tráfego. Ou seja, a interface
completa do treinador abre sem login.

O banco é um D1 emulado pelo Miniflare, gravado em `.wrangler/state/v3/d1/`.
As tabelas são criadas sob demanda pelas funções `ensure*` do Worker, então não é
preciso rodar migração para começar. Para zerar o banco local, pare o servidor e
apague a pasta `.wrangler/`.

### Configuração exigida

O `vite.config.ts` lê `.openai/hosting.json` para saber o nome dos bindings de D1
e R2. Esse arquivo não vem no ZIP e precisa existir antes do `npm run dev`:

```json
{ "d1": "DB", "r2": null }
```

### Primeiro acesso

A aplicação tem autenticação própria e **não traz nenhuma conta embutida**. A
conta do treinador é criada no primeiro acesso a partir de duas variáveis de
ambiente, que precisam existir antes de o aplicativo subir:

```dotenv
COACH_EMAIL=seu-email@exemplo.com
COACH_INITIAL_PASSWORD=uma-senha-forte-2026
```

Sem elas, `/api/auth/*` responde `503 coach_account_not_configured` e nenhuma
conta é criada. Isso é proposital: um e-mail e uma senha padrão escritos no
código seriam uma porta conhecida em toda instalação onde alguém esquecesse de
configurar as variáveis.

A troca de senha é obrigatória no primeiro login, e o seed roda **uma única
vez** — depois que a conta existe, alterar as variáveis não tem mais efeito.

Localmente essas variáveis ficam em `.dev.vars`, que está no `.gitignore`. Em
produção, use os secrets do Cloudflare:

```bash
npx wrangler secret put COACH_EMAIL
```

### Recuperar o acesso do treinador

O treinador redefine a senha dos alunos pelo painel, mas ninguém redefine a
dele: é a única conta sem recuperação dentro do aplicativo. Se a senha se
perder, use o script abaixo, que age direto no banco.

```bash
npm run coach:reset-password -- "minha-nova-senha-2026"
```

Sem o argumento, o script gera uma senha aleatória e a imprime. Para corrigir
também o endereço de login — por exemplo quando a conta já foi semeada com o
e-mail padrão — acrescente `--email`:

```bash
npm run coach:reset-password -- "minha-nova-senha-2026" --email voce@email.com
``` Ele encerra as
sessões abertas e mostra, ao final, o comando `wrangler d1 execute` equivalente
para fazer o mesmo em produção.

Para zerar o banco local por inteiro e recomeçar do zero, **pare o servidor**
antes de apagar `.wrangler/` — apagar com o servidor no ar deixa o banco em um
estado inconsistente.

### Variáveis das integrações

Os segredos chegam ao Worker como bindings, não como `process.env`. Localmente,
copie `.dev.vars.example` para `.dev.vars` e preencha o que for testar. Cada
provedor só é oferecido ao atleta depois que as variáveis que ele exige existem;
antes disso a interface o mostra como "Credenciais não configuradas" em vez de
falhar no meio do fluxo.

Para validar:

```bash
npm test
```

## Autenticação

A identidade vem de uma sessão em cookie (`zonas_session`, HttpOnly, SameSite
Lax, sete dias), e não mais de um cabeçalho injetado por uma plataforma externa.
As senhas são guardadas como PBKDF2-SHA256 com 210 mil iterações e sal por
conta; o banco nunca vê a senha nem o token de sessão, apenas os seus hashes.

Há dois papéis. O **treinador** é a conta única com o e-mail definido em
`COACH_EMAIL`. Cada **aluno** tem a sua própria conta, criada pelo treinador na
aba *Contas* a partir de um aluno já cadastrado; o sistema gera uma senha
temporária que aparece uma única vez e que o aluno troca ao entrar. Um aluno só
enxerga os próprios dados: todas as rotas `/api/student/*` são fixadas ao atleta
vinculado à conta, ignorando qualquer nome vindo da requisição.

O aluno também pode se cadastrar sozinho pela tela de login. A conta nasce sem
vínculo e sem acesso, e só vira acesso real quando o treinador aprova a
solicitação em *Cadastros*.

Bloquear uma conta encerra as sessões dela na hora. Redefinir a senha faz o
mesmo e devolve uma nova senha temporária.

Proteções em vigor: bloqueio temporário de quinze minutos após oito tentativas
erradas, limite por origem em `/api/auth/login` e `/api/auth/register`, resposta
igual para e-mail inexistente e senha errada, e derrubada das demais sessões
quando a senha muda.


## Diagnóstico de erros

Toda chamada à API passa por `app/api-client.ts`. Quando algo falha, o erro
lançado é um `ApiError` com rota, método, status HTTP, código devolvido pelo
servidor e o corpo da resposta, e a mesma informação vai para o console do
navegador com o prefixo `[zonasapp]`. A interface mostra uma mensagem amigável,
mas o detalhe técnico está sempre disponível sem precisar reproduzir o problema.

O Worker protege as rotas de escrita contra reenvio com
`preventDuplicateSubmission`, que responde `409 duplicate_submission`. Esse
código significa **"a sua ação já foi aceita"**, e é por isso que a camada de
API o converte em sucesso (`alreadySaved: true`) em vez de erro. Rotas cuja
gravação é um UPSERT sobre chave estável — ficha, planejamento, semana de
treino, vínculo de acesso, preferência de integração — estão isentas da
deduplicação, listadas em `idempotentWriteRoutes`: salvar duas vezes o mesmo
conteúdo leva ao mesmo estado final e não pode ser tratado como falha.

## SisRUN Elite

O treinador já usa o [SisRUN](https://sisrun.com.br/), plataforma brasileira de
gestão para assessorias esportivas. **Não há nada implementado no ZonasApp a
respeito** — a busca por qualquer referência no código não retorna nada — e esta
seção existe apenas para registrar a estratégia, não uma integração.

O que se sabe hoje: o SisRUN oferece integração com Garmin, Strava, Polar e
Coros, importação de arquivos `.FIT` e exportação de planilhas em PDF. **Não há
API pública documentada para terceiros**, e nenhuma foi encontrada nos canais
oficiais e na central de ajuda do produto.

Estratégia recomendada, em ordem de custo:

1. **Não integrar diretamente.** ZonasApp e SisRUN consomem as mesmas fontes
   (Strava, Garmin). A atividade concluída pelo atleta chega aos dois sistemas
   por conta própria, sem nenhuma ponte entre eles. Isso já cobre a maior parte
   do trabalho manual de lançar execução de treino.
2. **Perguntar ao fornecedor.** Antes de qualquer desenvolvimento, confirmar com
   a SisRUN Tecnologia em Esportes se existe API, exportação estruturada ou
   parceria técnica. É a única forma de saber o que é possível.
3. **Importação por arquivo.** Se houver exportação em CSV ou `.FIT`, uma tela
   de importação no ZonasApp resolveria a carga inicial de atletas e histórico
   sem depender de API.

O que **não** fazer: raspagem de tela, automação do aplicativo ou uso de
endpoints internos não documentados. Além de frágil, viola os termos de uso e
colocaria em risco a conta do treinador.

## Conta de manutenção

Além do treinador e dos alunos existe um terceiro papel, `dev`, para quem mantém
a plataforma. Ele alcança tudo o que o treinador alcança e mais um painel de
diagnóstico em `/api/dev/overview`: erros da aplicação, contas e sessões,
eventos de segurança, uso por rota, volume de cada tabela e o estado das
integrações.

A conta **só existe se estas duas variáveis estiverem definidas**:

```dotenv
DEV_LOGIN=
DEV_INITIAL_PASSWORD=
```

Sem elas, o papel simplesmente não é criado — uma conta de acesso irrestrito não
pode existir por padrão. O login não precisa ser um e-mail: é um identificador
curto que ninguém usa para receber mensagem.

O diagnóstico devolve apenas a **presença** de cada variável de ambiente, nunca
o valor, e nunca inclui hash de senha nem token de sessão: nem quem mantém o
sistema precisa deles para diagnosticar, e devolvê-los transformaria a rota num
alvo. Treinador e aluno recebem `403 dev_access_required`.

## Estrutura principal

- `app/`: interface e fluxos do professor e do aluno
- `db/`: acesso e esquema do banco
- `drizzle/`: migrações do banco
- `public/`: manifesto, service worker e ícones do aplicativo
- `worker/`: entrada do Cloudflare Worker, com `auth.ts` (login e sessões) e
  `integrations.ts` (catálogo e normalização dos provedores)
- `app/api-client.ts`: camada única de chamadas à API, com erros diagnosticáveis
- `app/DevDashboard.tsx`: painel de diagnóstico da conta de manutenção
- `db/sql.ts`: gera o SQL de criação a partir do schema Drizzle (fonte única)
- `tests/`: testes automatizados

## Integrações

As quatro integrações compartilham o mesmo ciclo — conectar, guardar token
cifrado, importar atividade, desconectar — mas não a mesma forma de autorizar. O
catálogo em `worker/integrations.ts` declara essa diferença de forma explícita.

| Serviço | Autorização | Estado |
| --- | --- | --- |
| Strava | OAuth2 | Fluxo completo, incluindo renovação de token e importação das atividades dos últimos 30 dias |
| Garmin | OAuth2 com PKCE | Fluxo implementado; depende da aprovação no Garmin Connect Developer Program |
| Amazfit / Zepp | OAuth2 | Fluxo implementado; os recursos liberados variam por conta no portal Zepp |
| Apple Saúde | Token de aparelho | Sem API de servidor — ver abaixo |

Tokens de acesso e de renovação são cifrados com AES-GCM antes de ir ao banco,
usando `STRAVA_TOKEN_ENCRYPTION_KEY`, e só são decifrados no instante da chamada
ao provedor. O `state` do OAuth existe apenas como hash e expira em dez minutos;
no caso da Garmin, o `code_verifier` do PKCE nunca sai do servidor.

As atividades importadas são normalizadas em `external_activities` — distância,
tempo, frequência cardíaca e ritmo médio — e já chegam ligadas à semana e ao dia
do treino planejado. A gravação é idempotente: reenviar a mesma atividade não a
duplica.

### Apple Saúde

O HealthKit só existe dentro do iPhone e não tem API que um servidor possa
chamar. Por isso a Apple não usa OAuth aqui: o atleta gera um token de ingestão
na tela de integrações e o usa em um Atalho do iOS que envia os treinos para
`POST /api/ingest/device`, no cabeçalho `x-zonas-ingest-token`. O token aparece
uma única vez, é guardado apenas como hash, e a atividade é sempre gravada no
atleta dono do token — nunca em um nome vindo do corpo da requisição.

### Antes de publicar cada integração

- Cadastrar a Zonas-App nos portais oficiais e preencher as variáveis do Worker.
- Garmin: aguardar a aprovação e ligar `GARMIN_ACTIVITY_API_ENABLED` e
  `GARMIN_TRAINING_API_ENABLED` conforme o que for liberado.
- Zepp: confirmar no portal quais APIs a conta tem.
- Não usar captura de senha, automação de site ou APIs não oficiais.

## Segurança

Este repositório não contém credenciais, tokens, senhas nem dados de produção.
Crie um `.dev.vars` apenas na máquina de desenvolvimento; ele está no
`.gitignore` e nunca deve ir para o Git ou para um ZIP.

Variáveis do Worker:

```dotenv
COACH_EMAIL=
COACH_INITIAL_PASSWORD=

STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_TOKEN_ENCRYPTION_KEY=

GARMIN_CONSUMER_KEY=
GARMIN_CONSUMER_SECRET=
GARMIN_ACTIVITY_API_ENABLED=false
GARMIN_TRAINING_API_ENABLED=false

ZEPP_APP_ID=
ZEPP_APP_SECRET=
ZEPP_WEBHOOK_SECRET=
```

`STRAVA_TOKEN_ENCRYPTION_KEY` cifra os tokens de todos os provedores, não só os
do Strava. Trocá-la invalida as conexões existentes, que precisarão ser
autorizadas de novo pelos atletas.

### O que ainda falta para uso comercial

A autenticação é adequada para uso real com poucos alunos, mas ainda não tem
verificação de e-mail, segundo fator, nem recuperação de senha automática — hoje
o treinador redefine a senha pelo painel.

## Observação

Esta é uma cópia de trabalho. Alterações locais não atualizam automaticamente a plataforma publicada.
