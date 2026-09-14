# O que enviar ao console da Zepp

Tudo o que o formulário de publicação pede, com o texto pronto para colar.
As especificações vêm da documentação oficial (`docs.zepp.com/docs/distribute`);
onde ela é explícita, o número está aqui.

---

## Antes de abrir o formulário

**1. Conta de desenvolvedor** em <https://console.zepp.com>, com o *Developer
nickname* preenchido no Account Center — o console usa esse apelido como nome
público do desenvolvedor, e sem ele o formulário não fecha.

**2. Registrar o aplicativo primeiro, compilar depois.** O console atribui o
`appId` no momento do registro, e o pacote é recusado se o `appId` de dentro dele
não for o mesmo. Hoje o `app.json` traz `1052001`, que é **provisório**: troque
pelo número que o console devolver e só então rode `zeus build`.

```bash
npm i -g @zeppos/zeus-cli
cd zepp-app
zeus build          # gera o .zab que se envia
```

**3. O nome não pode estar ocupado** por outro aplicativo seu.

---

## Campos do formulário

| Campo | O que preencher |
|---|---|
| AppId | o que o console atribuiu (e que está no `.zab`) |
| País/região | Brasil |
| Categoria | Saúde e exercício |
| Apelido do desenvolvedor | Yan Augusto Scholze |
| Pacote | `zepp-app/.zab` gerado pelo `zeus build` |
| Aparelhos compatíveis | reconhecidos do pacote — GTR 4, GTS 4, T-Rex Ultra |
| Versão | reconhecida do pacote — 1.0.0 |
| Idiomas | Português (Brasil) e Inglês |

### Nome

```
ZonasApp
```

### Resumo — pt-BR

```
Recebe o treino do dia do seu treinador e devolve o resultado, sozinho.
```

### Resumo — en-US

```
Receives today's workout from your coach and sends the result back, on its own.
```

### Descrição — pt-BR

```
O ZonasApp é a plataforma onde seu treinador monta a planilha e acompanha sua
evolução. Este mini-app fecha o ciclo no relógio.

O treino do dia chega com os ritmos já calculados a partir do seu último teste
de desempenho — você vê quanto correr e em que ritmo, sem abrir o celular.

Você corre pelo aplicativo de esporte do próprio relógio, como sempre fez.
Ao encerrar, o resultado volta para o seu treinador automaticamente.

Para usar, é preciso ter conta no ZonasApp com um treinador. Na plataforma, em
Integrações, escolha Amazfit / Zepp e cole aqui o token que aparecer.
```

### Descrição — en-US

```
ZonasApp is the platform where your coach builds your training plan and follows
your progress. This mini program closes the loop on the watch.

Today's workout arrives with paces already computed from your latest performance
test — you see how far to run and at what pace, without reaching for your phone.

You run with the watch's own sport app, as you always have. When you finish, the
result goes back to your coach automatically.

Requires a ZonasApp account with a coach. On the platform, under Integrations,
choose Amazfit / Zepp and paste the token shown here.
```

### Declaração de privacidade

```
Este mini-app trata dois conjuntos de dados, e nenhum outro.

Recebe da plataforma ZonasApp o treino planejado para o dia — distância, duração
e faixas de ritmo —, que fica guardado apenas no relógio e no celular do próprio
usuário, para poder ser exibido sem rede.

Envia à plataforma ZonasApp o registro da atividade que o aplicativo de esporte
do relógio mediu: início, fim, distância, duração, frequência cardíaca média e
calorias. Esse envio existe para que o treinador acompanhe o aluno, que é a
finalidade única do serviço.

Não há coleta de localização, não há terceiros e não há publicidade. O vínculo é
feito por um token que o usuário cola uma única vez e pode apagar quando quiser,
encerrando a sincronização.

Controlador: Yan Augusto Scholze — yanaugustoscholze@gmail.com
Política completa: https://zonasapp.cloudfapp.workers.dev/privacy
Termos de uso:    https://zonasapp.cloudfapp.workers.dev/terms
```

### Justificativa das permissões

São duas, e as duas são exercidas.

```
device:os.local_storage
Guarda no relógio o treino do dia e o resultado ainda não entregue. Sem ele, um
treino encerrado longe do celular seria perdido.

data:user.hd.workout
Lê o registro que o aplicativo de esporte nativo produziu ao fim da corrida —
distância, duração, frequência cardíaca média e calorias — que é exatamente o
que o mini-app devolve ao treinador.
```

### Declaração de SDK de terceiros

```
Nenhum. O mini-app usa apenas as APIs do Zepp OS e fala com um único servidor,
o da própria plataforma ZonasApp.
```

---

## Imagens

| | Especificação | Estado |
|---|---|---|
| Ícone do console | 240×240 PNG, círculo, fundo opaco, fora transparente | `assets/icon-console-240.png` — pronto |
| Ícone do pacote | 248×248 PNG, com 4 px de área segura | `assets/icon.png` — pronto |
| Capturas de tela | 360×360 PNG, fundo transparente, **mínimo 3** | falta gerar |

As capturas saem do simulador (`zeus dev`). As três que contam a história:

1. o treino do dia na tela do relógio, com os ritmos;
2. o aviso de resultado enviado, ao fim da corrida;
3. a tela de configurações no celular, com o campo do token.

---

## Conta de teste para o revisor

O revisor não tem treinador nem token, e sem os dois **o mini-app abre vazio** —
que é o comportamento correto, mas parece defeito e reprova a revisão.

Prepare antes de enviar:

- um aluno de demonstração na ZonasApp, com **teste de desempenho aprovado** (sem
  ele os ritmos não são calculados e o treino chega sem as faixas);
- uma **semana liberada** com treino no dia — semana não liberada não é enviada
  ao relógio, de propósito;
- o **token** desse aluno, gerado em Integrações → Amazfit / Zepp → Conectar.

E cole no campo de observações ao revisor:

```
Para testar: instale o mini-app, abra as configurações dele no aplicativo Zepp e
cole o token abaixo. O treino do dia aparece no relógio em até 15 minutos, ou
imediatamente ao reabrir o mini-app.

Token: <cole aqui>

O aplicativo depende de uma conta com treinador na plataforma ZonasApp. Sem
token ele fica ocioso — não há tela de cadastro no relógio por decisão de
segurança: a credencial nasce na plataforma.
```

---

## Depois de enviar

A revisão leva de **1 a 5 dias úteis**. Reprovada, dá para corrigir por *Edit* e
reenviar; aprovada, as versões seguintes sobem por *Version Upgrade* — sem
registrar o aplicativo de novo, e mantendo o mesmo `appId`.
