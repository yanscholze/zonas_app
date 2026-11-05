# Zonas padrão e atualização Garmin

## Regra de resolução

Z1–Z5 usam as faixas individuais aprovadas mais recentes. Se uma faixa individual estiver ausente, é usada a respectiva faixa de `coach_pace_defaults`, configurada pelo dono da carteira. Aluno e treinador recebem o mesmo mapa `trainingZones`, com origem `individual` ou `default`. O frontend identifica referências padrão e prioriza a faixa atual sobre textos de ritmo guardados na sessão.

O padrão pode ser salvo na aba Integrações, no cartão “Zonas padrão do professor”. Não há números genéricos pré-ativados. A fonte consultada descreve percentuais do limiar de cada corredor, não uma equivalência universal de Z1–Z5 em min/km:

- [Joe Friel / TrainingPeaks — definição de zonas de ritmo](https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/).

As cinco faixas devem ser preenchidas explicitamente pelo professor. O endpoint valida formato, limites finitos e ordem rápido/lento. As faixas de um treinador não afetam outra carteira. Padrões entram nos backups.

Livre/null permanece sem alvo. Referências Tempo Run usam o ritmo individual aprovado de `tempo_runs`; não são substituídas arbitrariamente por Z3. Testes de cinco minutos continuam sem geração automática de zonas/VO₂máx.

Se uma etapa pede uma zona sem faixa disponível, o publicador Garmin informa quais faixas faltam e não envia silenciosamente esse treino sem alvo. Ele não substitui a zona por Z1 nem inventa um ritmo-base.

## Aprovação posterior e publicação

Aprovar zonas ou salvar o padrão enfileira a atualização de publicações existentes e liberadas da semana vigente e de semanas futuras. O cron de dez minutos processa um aluno por rodada e reduz o lote de importações durante essa rodada para preservar o orçamento de chamadas externas.

A fila `pace_refresh_jobs` usa lease e versão por `requested_at`. Falhas permanecem para nova tentativa; uma aprovação nova durante o processamento não é apagada pelo término de uma tarefa antiga. A fila só executa para integração Garmin escolhida e conectada.

Somente os dias de hoje em diante da semana vigente são republicados. Semanas futuras entram na publicação quando vigentes. Semanas e snapshots passados são preservados; não há mudança retroativa de alvos históricos. Falha ao renovar a sessão Garmin preserva `remote_workouts` já existente.

## Evidência e limites

Testes cobrem padrão por carteira, prioridade individual, payload Garmin com m/s, Livre, aprovação e fila automática, snapshots antigos, ausência de faixa e controle de acesso. Eles validam o contrato por HTTP simulado; não substituem confirmação em um relógio físico. Não foi habilitado padrão numérico para alunos reais sem definição das cinco faixas.
