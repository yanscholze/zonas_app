# Retorno de atividades Garmin

O Zonas usa o mesmo Garmin Connect móvel tanto para enviar treinos quanto para ler atividades concluídas. A importação antiga usava `wellness-api/rest/activities`, que pertence ao programa oficial e não aceita a sessão móvel obtida pelo login atual.

A referência conferida foi [cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect/blob/218e72ca5459e014435fc2d94fd18bd601fa0c14/garminconnect/__init__.py), commit `218e72ca5459e014435fc2d94fd18bd601fa0c14`. Os métodos `get_activities_by_date`, `get_activity`, `get_activity_splits`, `get_activity_typed_splits` e `get_activity_details` usam os endpoints implementados em `worker/garmin-conexao.ts`. É um caminho interno do Connect, sujeito a mudanças da Garmin. O experimento Python continua inativo.

## Quando aparece

Depois que o relógio sincroniza a atividade com o Garmin Connect, o cron `*/10 * * * *` consulta as contas conectadas cuja integração escolhida é Garmin. O cron de publicação da semana continua separado e roda somente nas duas programações de domingo.

Cada execução atende até cinco contas e dois resultados novos ou incompletos por conta. Isso mantém até 45 chamadas externas, mais até cinco renovações de sessão. Contas adicionais e o histórico inicial continuam nos próximos lotes. A ação existente de sincronização manual processa até dez atividades. A janela consulta os últimos 30 dias, com até 50 atividades na resposta do Connect.

`last_import_attempt_at` impede consultas concorrentes e organiza os lotes; `last_import_error` e o monitor de erros registram problemas. HTTP 429, 403 e 401 interrompem as chamadas seguintes daquela conta. Detalhes indisponíveis são tentados novamente; a autorização inválida pede reconexão. Nenhuma senha é persistida.

## Vínculo e etapas

O identificador do workout é comparado com `training_week_publications.remote_workouts`. Novos envios guardam também as etapas enviadas. Se o identificador não vier, uma corrida/caminhada pode ser relacionada pela data de Brasília a um treino liberado. Um workoutId conhecido de outra plataforma e atividades de outros esportes não concluem o plano.

Cada tiro e recuperação é expandido. Índices explícitos de etapa são aceitos no contrato de ingestão. No Garmin, `wktStepIndex`, `wktIndex` e os grupos `INTERVAL_*` com `lapIndexes` identificam as etapas do workout enviado. Isso permite reunir várias voltas do aquecimento, separar cada repetição e registrar o trecho parcial de um treino interrompido. A referência é o snapshot original; envios antigos o recuperam do fingerprint armazenado, sem usar uma edição posterior do plano para interpretar o índice.

Sem índices explícitos confiáveis, a associação sequencial das voltas só ocorre quando os limites medidos conferem e há identificador de workout correspondente ou marcações de intensidade. Auto Lap por quilômetro não é automaticamente tratado como etapa. Voltas sem correspondência permanecem visíveis separadamente; etapas sem medida mostram a ausência. A versão de associação é gravada em `mappingVersion`; resultados antigos são enriquecidos nos próximos lotes.

As métricas conhecidas incluem tempo, distância, ritmo, frequência cardíaca, cadência, potência, calorias, elevação, dinâmica de corrida, efeito do treino e temperatura, quando recebidas. O payload completo é preservado como JSON válido dentro do limite de armazenamento; não há preenchimento de métricas que não vieram do relógio.

A importação cria a conclusão automaticamente. Se o aluno já concluiu manualmente, o registro é enriquecido preservando a observação. Reenvios usam o mesmo identificador. As APIs do aluno e do professor devolvem o mesmo resultado, com o recorte de acesso já existente. As telas atualizam a lista a cada minuto enquanto visíveis.

## Zepp

A ingestão autenticada existente também registra conclusões e pode receber `step_metrics` com `stepIndex` zero-based e métricas em unidades SI. Essa capacidade de receber não prova que o mini-app instalado produz tais dados. O `Workout.getHistory()` documentado pela Zepp não fornece o detalhamento por etapas; este trabalho não adiciona uma coleta nativa nova no relógio Zepp.

## Validação

Os testes `garmin-return.test.mjs` exercitam os endpoints, falhas temporárias, quota, expansão de repetições e a distinção entre etapas e Auto Lap. `workout-return-integration.test.mjs` usa SQLite real com respostas Garmin sintéticas para verificar a rotina do cron, conclusão automática, idempotência, reconciliação manual, vínculo e isolamento entre professores.

A validação inicial das contas reais confirmou quatro conexões Garmin no D1. A chave de cifra local não correspondia à chave de produção; nenhuma autorização foi alterada e nenhum resultado real foi lido nessa etapa. Testes locais não demonstram que uma atividade real já voltou de um relógio.

`npm test` concluiu o build e os 216 testes sem falhas, incluindo os formatos observados em produção: aquecimento com Auto Lap, repetição interrompida, desaquecimento e volta adicional sem etapa. O React Doctor manteve a pontuação 36 da versão anterior; o projeto já apresenta pendências de complexidade e acessibilidade. O `tsc --noEmit` continua com os mesmos seis erros anteriores de tipos Cloudflare e tipagem de callbacks, sem erros adicionais desta mudança. A chave de cifra existente em produção deve ser preservada no deploy.

A primeira execução do cron em produção, em 07/10/2026 às 10h30 de Brasília, importou atividades reais e criou conclusões relacionadas ao workoutId enviado. A análise desses payloads confirmou o vínculo explícito de todas as oito etapas de um treino completo e de seis etapas de um treino interrompido; as etapas não executadas continuam sem medições. Isso confirmou o retorno real pelo Connect, além dos testes sintéticos. A tentativa de login com a credencial local de manutenção foi recusada; não foi feita uma inspeção autenticada das telas com as contas reais de aluno/professor.

Às 10h40, a segunda execução confirmou a versão final `4229b102-a597-467a-a633-c1a3feab5a05`, com resultado `ok`, sem exceções. Foram consultadas três contas ativas com preferência Garmin; o banco registrou cinco atividades recebidas, duas conclusões vinculadas e 14 etapas com métricas. A rotina enriqueceu sozinha os resultados da primeira execução; o reprocessamento manual preparado não precisou alterar registros. Não houve erros na área `retorno Garmin`. Código publicado no commit `7ae4cb5`.
