# Visibilidade dos treinos e acesso do aluno

## Incidente: semana liberada não aparecia ao aluno

O calendário do professor e a tabela `training_weeks` usam a segunda-feira como
chave de início da semana. A rota autenticada `/api/student/dashboard`, porém,
continuava calculando domingo. Com isso, a semana podia estar marcada como
`Liberada` e visível ao treinador, enquanto a consulta do aluno procurava outra
chave e retornava `week: null`.

### Auditoria de produção

Na semana iniciada em 12/10/2026, a consulta de produção encontrou seis semanas
salvas como `Liberada` e dois alunos sem registro para a semana atual. Duas das
seis liberações tinham publicação Garmin confirmada; uma aguardava conexão do
aluno; as demais estavam pendentes de publicação ou atualização no relógio.
Esses estados de publicação são independentes da visualização dentro do app.
Também havia três rascunhos para a semana seguinte, iniciada em 19/10/2026,
que corretamente ainda não estavam liberados.

Os registros foram resumidos sem nomes de alunos porque o repositório do código
é público. A validação de semana atual verificou o registro de cada aluno,
seu status e o estado da integração sem divulgar credenciais ou dados de treino.

### Correção

A rota do aluno passou a usar `weekStartOf(Date.now())`, o mesmo cálculo de
segunda-feira utilizado no fluxo de integração. Um teste do dashboard simula
uma terça-feira e confirma que a consulta autenticada busca a segunda-feira
correta.

## Integração Garmin na tela inicial

Quando o Garmin Connect não está conectado, a página inicial do aluno mostra um
card para iniciar o login e explicar que essa autorização integra o relógio e
permite receber treinos. O botão abre a tela da integração diretamente no
formulário Garmin. Campos de e-mail e senha aceitam preenchimento pelo gerenciador
de senhas (`username` e `current-password`).

Atalhos para semana, testes e zonas, provas e recordes, e integrações ficam
disponíveis na página inicial sem substituir a navegação existente.

## Edição das planilhas-base

Os controles de edição e exclusão estavam dentro de um card que também era um
botão, usando elementos `span` como controles. Isso tornava o clique e o uso por
teclado pouco claros. O card agora separa a abertura das semanas de ações de
botão reais. `Editar dados` abre o formulário, leva-o para a área visível e
posiciona o foco no primeiro campo. A abertura da planilha continua permitindo
editar os treinos estruturados de cada semana.

## Validação

- `npm test`: 223 testes aprovados.
- React Doctor, mudanças: nenhum diagnóstico.
- React Doctor, revisão de design: um aviso de manutenção preexistente em
  `app/ZonasAppClient.tsx:473`, fora das áreas alteradas.
- O estado de publicação Garmin não é usado para decidir se a semana liberada
  aparece na área do aluno.
