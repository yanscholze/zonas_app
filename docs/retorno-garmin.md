# Integração Garmin Connect: envio, retorno e auditoria

## Cliente e autenticação

A Zonas-App usa a sessão do Garmin Connect do próprio aluno. O login troca a senha pela sessão e a descarta; somente os tokens cifrados ficam no D1. O Worker conversa com `connectapi.garmin.com`, renova a sessão e usa o mesmo cliente para publicar treinos e consultar atividades. Nenhuma chave do Garmin Developer Program, Activity API oficial ou Training API é usada.

Referências upstream:

- [cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect): referência para autenticação Connect, atividades, divisões e detalhes.
- [sydspost/Garmin-Connect-Workout-and-Schedule-creator](https://github.com/sydspost/Garmin-Connect-Workout-and-Schedule-creator): referência para criação e agendamento de treinos no Connect. O projeto depende de automação Python/Chrome e não é executado dentro do Cloudflare Workers; a Zonas-App implementa o fluxo equivalente em TypeScript.

Os repositórios são referências, não dependências vendorizadas. Nenhum código GPL do criador de treinos foi copiado para este repositório.

## Envio de semanas

Salvar, liberar para o aluno e publicar no Connect continuam sendo operações distintas. Ao liberar uma semana, o backend consulta a integração preferida pelo aluno. Quando for Garmin, cria o treino e agenda cada dia no Garmin Connect. O cron de segunda-feira roda às 00:00 e 01:00 de Brasília; a segunda execução permite repetir publicações pendentes. A consulta de atividades concluídas roda a cada dez minutos.

O início da semana é segunda-feira. A migração `training-week-start-monday-v1` converte as chaves dominicais em treinamento, publicações, execuções, feedbacks, atividades e relatos de dor. Na auditoria de produção anterior à implantação foram encontradas 23 semanas com chave de domingo e nenhuma colisão com uma semana de segunda já existente.

## Importação e diagnóstico por aluno

O cron seleciona em lotes as contas Garmin conectadas cujo aluno escolheu Garmin. Para cada atividade, consulta o resumo, `/splits`, `/typedsplits` e `/details` com até 2.000 amostras de gráfico. O bloqueio de sincronização distingue conta ausente, sessão a reconectar e consulta já em andamento; sobreposição esperada não é registrada como falha de servidor.

O painel do professor usa o estado real da preferência, conexão, última tentativa, erro de importação, atividades recebidas e execuções relacionadas. Uma conexão Garmin não é tratada como sincronizada quando o aluno escolheu outro serviço. Uma conta conectada sem atividade recente aparece separadamente de uma conta que precisa reconectar.

## Dados apresentados

O resultado compartilhado entre a ficha do aluno e a do professor contém métricas do resumo, voltas, etapas planejadas e realizadas, dados disponíveis por etapa, séries temporais do Connect, distribuição de zonas quando o Connect a fornece e métricas numéricas adicionais do resumo. O gráfico reduz as séries a no máximo 500 pontos para manter o documento de resultado leve. O código não inventa zonas nem substitui dados ausentes por zero.

O vínculo de etapas usa o identificador do treino e os índices de passos FIT (`wktStepIndex`, `wktIndex`, grupos `INTERVAL_*` e `lapIndexes`) quando disponíveis. Auto Lap não é confundido com uma etapa do plano. Medições sem vínculo seguro ficam na lista de voltas; etapas interrompidas permanecem sem medição.

## Strava

O painel de Integrações permite à conta principal cadastrar o Client ID e o Client Secret do aplicativo Strava. Os valores são cifrados em repouso pelo segredo `STRAVA_TOKEN_ENCRYPTION_KEY`, nunca devolvidos à interface e substituídos somente por nova gravação. O servidor gera e guarda o token de verificação de webhook e tenta ativar as notificações automaticamente ao salvar. O card mostra o callback OAuth a configurar no portal Strava e o estado da assinatura de notificações.

O Client ID e o Client Secret ainda precisam ser fornecidos pelo responsável do aplicativo Strava. A mudança entrega o formulário seguro e o fluxo de credenciais, mas não inventa ou preenche credenciais externas.

## Limitações honestas

- O Garmin pode alterar os endpoints Connect sem aviso; a conexão pode exigir novo login quando a sessão expirar ou a conta mudar a senha.
- Os campos e gráficos expostos dependem dos dados que a conta e o dispositivo enviaram ao Connect. Campos ausentes não são fabricados.
- O retorno do Zepp depende dos dados que o mini-app no relógio realmente envia; os detalhes da Garmin não são aplicáveis à Zepp.

## Validação

Os testes `garmin-return.test.mjs` cobrem leitura do Connect, concorrência, falhas temporárias, repetição de etapas, limites medidos e Auto Lap. `workout-return-integration.test.mjs` cobre a rotina de importação, idempotência, vínculo e isolamento por aluno/professor. A publicação deve ser acompanhada da migração automática no primeiro acesso do Worker e de uma consulta de produção que confirme a aplicação da migration e as chaves da semana.
