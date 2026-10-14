# Auditoria da integração Amazfit / Zepp — 13/10/2026

## Resultado

A integração ainda não está comprovada como funcional. O código-fonte atual tem
peças para publicar treinos e receber atividades por um Side Service, mas o
pacote mais recente da pasta `ZeppOS` não corresponde a esse código e não inclui
os módulos essenciais. A interface agora distingue token, contato do celular e
atividade recebida, sem chamar a geração do token de conexão concluída.

## Pacotes comparados

O pacote mais recente encontrado foi
`ZeppOS/1126787-ZonasApp-1.0.0-20261001163743.zab` (01/10/2026):

- appId `1126787`, versão `1.0.0` e manifesto do pacote em `configVersion v2`;
- runtime com API `2.0.0`;
- módulos compilados listam apenas `page/index`; não incluem `app-side` nem
  `setting`;
- o código-fonte atual em `zepp-app/app.json` usa configuração v3, API 3.0 e
  declara os módulos `page`, `app-side` e `setting`.

Isso prova que o `.zab` de 01/10 não foi compilado do código-fonte atual. O
arquivo contém o mesmo appId, mas isso sozinho não prova que ele foi aprovado,
publicado ou corresponde à primeira versão aceita. O estado e o pacote aceito
precisam ser confirmados no Zepp Developer Console.

## Limites funcionais encontrados

- A documentação oficial do Zepp OS coloca `Workout.getHistory()` a partir da
  API 3.0 e documenta para cada item somente `startTime` e `duration`.
- A página atual lê outros campos (`distance`, `avgHeartRate`, `calorie`) como se
  fossem garantidos. A documentação pública consultada não os garante; sem teste
  em dispositivo, não se pode afirmar que distância e métricas serão importadas.
- O observador `Workout.onChange` está dentro da página do mini-app. O código não
  comprova que essa página permanece ativa durante o exercício no app nativo do
  relógio. Portanto, o retorno automático após fechar o mini-app não está
  validado.
- `getSportData` começa na API 3.6 e fornece dados da aplicação de esporte em
  execução; isso não prova a leitura retroativa de uma atividade concluída.
- O `.zab` mais recente não tem Side Service nem configurações, então não pode
  buscar treinos pela internet ou receber o token descrito pelo front.

## Ajustes feitos nesta entrega

- A compilação local de validação gerou
  `zepp-app/dist/1126787-ZonasApp-1.0.1-20261013210124.zab`, com configuração
  v3, API 3.0 e os módulos `page`, `app-side` e `setting`. O build terminou sem
  o alerta de resolução de `@zos/settings`, após trocar para
  `settings.settingsStorage` documentado pelo Zepp.
- Card Amazfit na tela inicial com acesso a Integrações e links oficiais para
  baixar o aplicativo Zepp no Android e iPhone.
- Instruções de instalação do mini-app pelo caminho documentado: Zepp → Perfil →
  dispositivo → App Store. O `.zab` é pacote de desenvolvimento/publicação e não
  um instalador direto para o aluno.
- A interface informa que token criado ainda não comprova conexão. O backend
  agora registra `Aguardando conexão`, `Celular conectado` e `Atividade recebida`
  em etapas diferentes.
- A publicação da semana Zepp depende do token ativo, não de um status de
  conexão que só poderia surgir após o celular consultar a própria semana. O
  contato do Side Service é registrado como contato do celular, sem afirmar que
  houve entrega Bluetooth.
- O README do mini-app foi corrigido para registrar as limitações e remover a
  promessa de sincronização automática sem ação do aluno.

## Critérios para confirmar funcionamento

1. Compilar um `.zab` a partir do código-fonte atual e conferir manifesto,
   versão de API e inclusão de `app-side` e `setting` no pacote.
2. Enviar esse pacote como atualização no Zepp Developer Console e confirmar
   aprovação/publicação para os modelos alvo.
3. Instalar pela App Store do Zepp em um relógio real compatível; provar busca de
   treino publicado e confirmação de entrega ao relógio.
4. Encerrar uma corrida nativa com o mini-app fechado e demonstrar quais campos
   o SDK realmente fornece. Comparar o registro no relógio, payload recebido e
   telas do aluno e professor.

O `.zab` 1.0.1 foi apenas compilado localmente e não foi testado em relógio nem
enviado ao Zepp Developer Console. Até essas etapas passarem, a integração
permanece em validação e não oferece retorno completo de zonas, voltas, gráfico
ou métricas por etapa.

## Referências oficiais

- [Workout API do Zepp OS](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Workout/) — API 3.0, `getHistory` e campos documentados.
- [getSportData](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-access/getSportData/) — API 3.6 e dados de esporte.
- [Publicar um app Zepp](https://docs.zepp.com/docs/v2/distribute/) — envio do `.zab`, revisão e atualização de versão.
- [Instalar apps no Amazfit Balance](https://support.amazfit.com/en/amazfit_balance/docs/GcK8dmd16oh60cxuk0uchHEHnIh) — instalação pelo Zepp App → App Store.
