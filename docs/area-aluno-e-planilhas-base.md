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

## Auditoria de Caio, retornos Garmin e edição global — 14/10/2026

### Treinos não apareciam para Caio

A semana de Caio iniciada em 12/10/2026 está liberada e contém treinos nos
sete dias. A consulta do painel busca essa semana; portanto, os dados não
estavam ausentes no servidor. A tela consultava o painel apenas ao montar e
podia continuar exibindo estado antigo se já estivesse aberta quando a semana
foi liberada. Agora a consulta não usa cache e é repetida ao voltar para a aba,
ao recuperar foco e a cada minuto enquanto a página está visível.

A auditoria também encontrou um estado inconsistente na conta de Caio:
`athlete_access` está `Ativo`, mas `user_accounts.status` continua
`Aguardando aprovação`. A autenticação do aluno usa o primeiro estado, então
isso não explica por si só a falta do treino. A rotina de ativação agora
sincroniza o estado da conta. O registro já existente não foi alterado nesta
entrega; se o painel continuar sem dados após recarregar, essa divergência
precisa ser regularizada na conta de produção.

### Retornos Garmin para os alunos

A consulta de produção encontrou 44 atividades importadas: todas com distância
e resultado de atividade; 43 também têm frequência cardíaca média. Quatorze
atividades estão associadas a um treino publicado e viraram retorno na tela do
treino. Isso é uma associação intencionalmente restrita: quando a atividade
traz um identificador de treino, ele precisa corresponder ao treino publicado
pela ZonasApp; sem esse identificador, a correspondência usa data local e dia
planejado. Atividades que não correspondem ficam importadas, mas não são
apresentadas como execução de um treino específico.

Entre oito cadastros de aluno não arquivados, quatro têm Garmin conectada, um
cadastro tem integração desconectada e três ainda não têm registro Garmin.
Nos quatro conectados, a auditoria não encontrou erro de importação salvo. Os
retornos associados por aluno foram 8, 4, 2 e 0; os demais não tinham atividade
associada. A disponibilidade das métricas adicionais continua dependendo do
que o Connect devolveu para cada atividade.

### Edição da planilha-base e integração escolhida

O botão de edição de treinos abre a base sem selecionar automaticamente o
primeiro aluno. Os editores de sessão usam o contexto `Planilha-base`, e a
alteração persiste como ajuste global para novos rascunhos. Resumo de aplicação
só aparece depois que um aluno é escolhido; semanas já liberadas não são
reescritas.

Na tela inicial, os cards de Garmin ou Amazfit/Zepp só aparecem depois que a
preferência do aluno foi carregada e somente para a integração selecionada.
Assim, o valor inicial padrão não mostra um card Garmin transitório para quem
escolheu Amazfit. O card Garmin mantém login na própria página inicial; o card
Amazfit mostra o caminho de instalação no app Zepp.

### Verificação desta entrega

- `npm test`: 224 testes aprovados.
- `npm run build`: compilação validada.
- O registro preexistente de Caio em `user_accounts` requer correção operacional
  separada; nenhum dado de produção foi alterado nesta entrega.

## Retorno por treino, cartões de integração e revisão operacional — 14/10/2026

### Comentários e revisões dos treinos

Cada execução tem um comentário persistente do treinador e estado de revisão.
Salvar comentário não marca revisão; ao marcar como revisado, o registro sai da
fila padrão de pendentes. A tela permite abrir a lista revisada e reabrir um
registro, preservando o comentário. O endpoint verifica o vínculo do aluno com
a carteira antes de alterar o retorno. O aluno vê a nota no detalhe do treino e
no histórico recente.

### Prévia do aluno e integração escolhida

A prévia de professor não consulta endpoints privados da sessão do aluno. Por
isso os cartões de provedores dessa tela não informam disponibilidade nem
conexão real: passam a dizer explicitamente que o status privado não foi
consultado. A preferência exibida vem do perfil do aluno; o cartão correspondente
aparece na página inicial da prévia. Na sessão real, o cartão escolhido fica na
página inicial até uma conexão ser confirmada. O formulário de senha Garmin não
é apresentado na prévia do professor.

### Contraste e saúde do sistema

Os resultados de atividade no painel do treinador usam painel escuro, bordas e
texto claro; a apresentação compartilhada da área do aluno permanece clara. A
lista da Saúde do Zonas deixou de reservar 140 px para o primeiro campo: cada
registro ocupa a largura disponível, com quatro colunas flexíveis em telas
grandes e conteúdo empilhado no celular.

### Ativação de conta e dados antigos

A aprovação continua ativando a linha de acesso e sincroniza a conta de login.
Além disso, ao abrir a lista de contas, registros pendentes são reconciliados
somente quando existe acesso ativo para o mesmo nome de aluno e o mesmo e-mail
exato. Contas bloqueadas ou sem essa correspondência não são alteradas. A
auditoria operacional encontrou 12 contas de aluno: 7 pendentes com acesso
ativo, 1 ativa e consistente e 3 pendentes sem acesso ativo; duas identidades
de aluno aparecem com mais de uma conta. Há ainda uma conta marcada como ativa
sem vínculo exato correspondente; ela não foi alterada. Após publicar a
reconciliação, as sete correspondências ativas também foram marcadas como ativas
na conta de login. A correção não apaga contas, senhas ou histórico, e as
duplicidades permanecem para conferência manual.

### Validação desta implementação

- `npm test`: 226 testes aprovados.
- React Doctor em arquivos alterados: nenhum diagnóstico; pontuação geral
  reportada pela ferramenta: 37/100.
- A correção em lote da produção foi limitada às 7 contas pendentes cujo e-mail
  coincide exatamente com o acesso ativo do mesmo aluno; demais contas foram
  preservadas.
- Issue de histórico: [#13](https://github.com/yanscholze/zonas_app/issues/13).
- Cloudflare Worker publicado na versão `39790d9f-7789-4178-a125-24f5e52b6c57`;
  a URL de produção respondeu HTTP 200.
- Após a correção, a consulta remota confirmou 8 contas com status e acesso
  ativos correspondentes, 3 pendentes sem vínculo ativo e 1 conta ativa sem
  vínculo exato, preservada.
