/**
 * Tela de configurações do mini-app, dentro do aplicativo Zepp no celular.
 *
 * É o único lugar onde o aluno digita alguma coisa. O Side Service lê daqui a
 * credencial (`zonasapp_token`) e, sem ela, não busca treino nem devolve
 * resultado — fica em silêncio, que é o comportamento certo para "ninguém
 * conectou ainda", mas seria um beco sem saída se não houvesse esta tela.
 *
 * A validação do formato acontece aqui, no momento da colagem. O erro de colar
 * um espaço a mais, meia string ou o texto da tela junto é o erro comum, e ele
 * se manifesta lá na frente como "não sincroniza" — sintoma que não aponta para
 * a causa. Conferir no ato transforma isso numa frase que o aluno resolve
 * sozinho.
 */

/* O token nasce com 24 bytes em hexadecimal — 48 caracteres de 0-9a-f. É o
   formato que `issueDeviceIngestToken` produz no servidor; se ele mudar lá, esta
   conferência passa a recusar token válido, então o número vive nos dois lados
   de propósito visível, e não escondido numa expressão regular solta. */
const TAMANHO_DO_TOKEN = 48;

/* Mostrado como sugestão no campo avançado. Repete o padrão do Side Service de
   propósito: aqui ele é texto de tela, lá é o endereço usado de fato, e juntar
   os dois obrigaria a tela de configurações a importar o serviço. */
const SERVIDOR_PADRAO = "https://zonasapp.cloudfapp.workers.dev";
const SO_HEXADECIMAL = /^[0-9a-f]+$/;

function diagnostico(bruto) {
  const token = String(bruto || "").trim().toLowerCase();
  if (!token) return { ok: false, texto: "Nenhum token colado ainda." };
  if (token.length !== TAMANHO_DO_TOKEN) {
    return {
      ok: false,
      texto:
        `Token com ${token.length} caracteres — são ${TAMANHO_DO_TOKEN}. ` +
        "Copie de novo, sem espaços nas pontas.",
    };
  }
  if (!SO_HEXADECIMAL.test(token)) {
    return { ok: false, texto: "Há caracteres que não pertencem ao token. Copie de novo." };
  }
  return { ok: true, texto: "Token válido. A sincronização é automática a partir daqui." };
}

AppSettingsPage({
  build(props) {
    const guardado = props.settingsStorage.getItem("zonasapp_token");
    const estado = diagnostico(guardado);

    return View({}, [
      Section({ title: "ZonasApp" }, [
        Text(
          { paragraph: true },
          "Cole aqui o token que apareceu na ZonasApp em " +
            "Mais → Integrações → Amazfit / Zepp → Conectar. " +
            "Ele aparece uma única vez: o servidor guarda apenas o resumo dele.",
        ),
      ]),

      Section({ title: "Token de sincronização" }, [
        TextInput({
          label: "Token",
          settingsKey: "zonasapp_token",
          placeholder: "48 caracteres",
          /* Normaliza na entrada em vez de na leitura. O Side Service roda em
             segundo plano, sem ninguém olhando: é aqui, com o aluno na frente da
             tela, que dá para consertar o espaço colado junto. */
          onChange: (valor) => {
            props.settingsStorage.setItem("zonasapp_token", String(valor || "").trim().toLowerCase());
          },
        }),
        Text({ paragraph: true, bold: estado.ok }, estado.texto),
      ]),

      /* Fica por último e sem destaque de propósito: quem instala não precisa
         mexer aqui. Existe porque o endereço do sistema já mudou uma vez, e sem
         este campo a correção passaria por uma nova revisão da Zepp — semanas
         com todos os relógios parados. */
      Section({ title: "Endereço do sistema (avançado)" }, [
        Text(
          { paragraph: true },
          "Deixe em branco para usar o endereço oficial. Só preencha se quem " +
            "mantém a ZonasApp pedir.",
        ),
        TextInput({
          label: "Endereço",
          settingsKey: "zonasapp_servidor",
          placeholder: SERVIDOR_PADRAO,
          onChange: (valor) => {
            props.settingsStorage.setItem(
              "zonasapp_servidor",
              String(valor || "").trim().replace(/\/+$/, ""),
            );
          },
        }),
      ]),

      Section({ title: "Desconectar" }, [
        Text(
          { paragraph: true },
          "Apagar o token interrompe a sincronização neste celular. " +
            "Para encerrar o acesso de vez, revogue também na ZonasApp — " +
            "token apagado só daqui continua valendo no servidor.",
        ),
        Button({
          label: "Apagar o token deste celular",
          onClick: () => props.settingsStorage.setItem("zonasapp_token", ""),
        }),
      ]),
    ]);
  },
});
