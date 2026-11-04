# Realocação, conversa e cálculo de acerto

## Dias de treino

Preferências do cadastro servem para montar a base. O treinador pode adicionar ou realocar um treino em qualquer um dos sete dias pelo arrasto ou botão Mover. Um destino ocupado troca os dois treinos. O dia de origem vazio recebe uma marca de remoção, para não ser recriado ao salvar/reabrir. `training_days` da semana representa os dias efetivamente programados; o cadastro permanece com as preferências originais. Integrações recebem os dias da semana salva.

## Conversa por treino

`workout_messages` guarda mensagens por execução, papel do autor, texto e data. A autorização usa o aluno da sessão ou a carteira do treinador, nunca um aluno informado pelo cliente. Comentários antigos continuam visíveis como mensagem inicial. As conversas são acessíveis na revisão do treinador, no histórico e nos resultados do aluno. A conversa aberta consulta atualizações a cada 15 segundos; não é um WebSocket. Cada mensagem tem até 2.000 caracteres. Resposta do aluno reabre a revisão e ganha destaque na fila; resposta do treinador gera aviso na área do aluno. Marcar como revisado preserva o histórico.

Mensagens são incluídas nos snapshots e removidas quando o cadastro é excluído, junto das respectivas execuções.

## Acerto

A comparação anterior usava duração e distância estimadas da sessão como se ambas fossem metas exatas. Agora:

- Etapa por tempo: compara o tempo prescrito; ignora a distância estimada.
- Etapa por distância: compara a distância prescrita; ignora o tempo estimado.
- Ritmo com limites aprovados: toda a faixa inclusiva vale 100%. Exemplo: faixa 5:00–6:00/km, realizado 5:20/km, critério de ritmo = 100%.
- Fora da faixa: `max(0, 100 - abs(realizado - borda mais próxima) / borda * 100)`. O critério de volume utiliza a mesma regra com os dois limites iguais ao valor prescrito. Não há tolerância adicional oculta.
- Critérios disponíveis da etapa são promediados; etapas são ponderadas pelo tempo prescrito (ou tempo medido, ou distância / 3 quando não há tempo).
- Sem divisões medidas, compara-se apenas o volume de etapas que compartilham a mesma unidade. Ritmo médio global só é comparado se todas compartilham os mesmos limites; não se usa média de intervalados para afirmar execução por zona.
- Etapas sem métricas não recebem zeros inventados nem contam como avaliadas. A tela informa quantas etapas sustentam a comparação. Sem critérios comparáveis, exibe conclusão sem medição.

O percentual é uma comparação dos critérios medidos, não a fração de segundos dentro da zona. Os limiares de classificação existentes foram mantidos (80/60). Resultados históricos são recalculados na leitura quando possuem etapas/snapshot ou plano salvo; dados brutos ficam preservados. Em registros antigos sem limites de ritmo salvos, não se inventam limites retroativos. Zonas livres continuam sem alvo.

## Validação

Testes cobrem as bordas da faixa, o exemplo 5:20/km, estimativas que não são metas, ausência de métricas, realocação e troca de dias, persistência por API, histórico, conversa bidirecional e isolamento entre carteiras/alunos.
