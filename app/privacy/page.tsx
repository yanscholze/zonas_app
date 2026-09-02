export const metadata={title:"Privacidade | Zonas-App",description:"Política de privacidade da plataforma Zonas-App."};

/**
 * Identificação do controlador, exigida pela LGPD (art. 9º, I e art. 41).
 *
 * Estes dados são públicos por obrigação legal: quem trata dado pessoal precisa
 * se identificar a quem é tratado. A página os mostra a qualquer visitante, e é
 * para isso que existem.
 *
 * O que NÃO é obrigatório é que eles estejam no código-fonte. Este repositório é
 * público, então o CPF aqui também entra no histórico do Git — e histórico não
 * se apaga editando o arquivo depois. Duas saídas, se isso incomodar: tornar o
 * repositório privado, ou abrir um CNPJ e trocar o CPF por ele, que é o caminho
 * comum de quem presta serviço.
 */
const CONTROLADOR={
  nome:"Yan Scholze",
  documento:"CPF 074.226.659-12",
  encarregado:"Yan Scholze",
  email:"yanaugustoscholze@gmail.com",
};

const naoInformado="informado pelo treinador responsável pela sua conta";

export default function PrivacyPage(){return <main className="legal-page"><section><a href="/">← Voltar para a Zonas-App</a><span>ZONAS-APP · DOCUMENTO PÚBLICO</span><h1>Política de Privacidade</h1><p className="legal-updated">Atualizada em 30 de agosto de 2026 · Lei nº 13.709/2018 (LGPD)</p>

<h2>1. Quem trata os seus dados</h2>
<p>O controlador dos dados pessoais tratados na Zonas-App é {CONTROLADOR.nome||naoInformado}{CONTROLADOR.documento?`, inscrito sob ${CONTROLADOR.documento}`:""}. Encarregado pelo tratamento de dados pessoais: {CONTROLADOR.encarregado||naoInformado}. Canal para exercer direitos e tirar dúvidas: {CONTROLADOR.email||"o mesmo contato usado no seu cadastro"}.</p>
<p>O treinador responsável pela sua conta decide quais treinos você recebe e quem tem acesso à sua evolução. A Zonas-App opera a plataforma que torna isso possível.</p>

<h2>2. Quais dados tratamos e por quê</h2>
<p>Cada dado abaixo é tratado com a base legal indicada, conforme o artigo 7º da LGPD.</p>
<ul className="legal-list">
<li><b>Cadastro</b> — nome, e-mail, telefone, data de nascimento, objetivo esportivo e dias disponíveis para treinar. Base legal: execução do contrato entre você e o treinador.</li>
<li><b>Treinos e resultados</b> — treinos planejados e realizados, distância, duração, ritmo, frequência cardíaca e percentual de acerto. Base legal: execução do contrato.</li>
<li><b>Relatos de dor e desconforto</b> — área do corpo, intensidade e impacto no treino. São dados sensíveis de saúde. Base legal: consentimento específico, dado no momento em que você preenche o relato, para tutela da sua saúde durante o treinamento.</li>
<li><b>Testes de desempenho e zonas</b> — resultado do teste, VAM, frequência cardíaca máxima e ritmos individuais. Base legal: execução do contrato.</li>
<li><b>Dados de relógio e aplicativo</b> — atividades importadas de Strava, Garmin, Amazfit/Zepp ou Apple Saúde. Base legal: consentimento, manifestado na autorização que você concede ao serviço.</li>
<li><b>Registros de acesso</b> — data e hora de login, endereço de origem da requisição e eventos de segurança. Base legal: cumprimento de obrigação legal (Marco Civil da Internet, art. 15) e legítimo interesse em proteger a plataforma.</li>
<li><b>Financeiro</b> — valor, vencimento e situação da mensalidade lançada pelo treinador. Base legal: execução do contrato. A Zonas-App não processa pagamento e não armazena dado de cartão.</li>
</ul>

<p>Dados de relógios e aplicativos somente serão acessados depois da autorização expressa do atleta. A Zonas-App solicita apenas as permissões necessárias para importar atividades e, quando permitido pelo serviço, enviar treinos estruturados — e a autorização pode ser revogada a qualquer momento, tanto aqui quanto no próprio serviço.</p>

<h2>3. Cookies</h2>
<p>A Zonas-App usa um único cookie, estritamente necessário: o identificador da sua sessão, que mantém você conectado e é destruído quando você sai ou quando a sessão expira. Não há cookie de publicidade, de rastreamento entre sites ou de medição de audiência.</p>

<h2>4. Com quem compartilhamos</h2>
<p>Seus dados esportivos não são vendidos nem cedidos para fins publicitários. O acesso é restrito a você, ao treinador responsável pela sua conta e aos operadores indispensáveis ao funcionamento:</p>
<ul className="legal-list">
<li><b>Cloudflare, Inc.</b> — hospedagem da aplicação e do banco de dados.</li>
<li><b>Strava, Inc.</b>, <b>Garmin Ltd.</b>, <b>Zepp Health</b> e <b>Apple Inc.</b> — apenas quando você autoriza a integração, e apenas para importar as suas atividades.</li>
</ul>
<p>Podemos ainda compartilhar dados quando houver ordem judicial ou requisição de autoridade competente.</p>

<h2>5. Transferência internacional</h2>
<p>A infraestrutura da Cloudflare e os serviços de integração citados operam servidores fora do Brasil. Ao usar a Zonas-App, seus dados podem ser processados nesses países, com as garantias contratuais e os padrões de proteção adotados por esses fornecedores, conforme o artigo 33 da LGPD.</p>

<h2>6. Por quanto tempo guardamos</h2>
<p>Os dados de cadastro, treinos, testes e provas permanecem enquanto sua conta estiver ativa. Se o treinador inativar seu cadastro, o histórico é preservado para que a sua evolução não se perca, e o acesso é encerrado. Registros de acesso e eventos de segurança são mantidos por seis meses, conforme o Marco Civil da Internet. A qualquer momento você pode pedir a eliminação dos seus dados, ressalvadas as hipóteses de guarda obrigatória previstas no artigo 16 da LGPD.</p>

<h2>7. Seus direitos</h2>
<p>O artigo 18 da LGPD garante a você, a qualquer momento e gratuitamente:</p>
<ul className="legal-list">
<li>confirmação de que tratamos seus dados e acesso a eles;</li>
<li>correção de dados incompletos, inexatos ou desatualizados;</li>
<li>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei;</li>
<li>portabilidade dos seus dados a outro fornecedor;</li>
<li>eliminação dos dados tratados com base no seu consentimento;</li>
<li>informação sobre com quem compartilhamos seus dados;</li>
<li>informação sobre a possibilidade de não consentir e as consequências disso;</li>
<li>revogação do consentimento, a qualquer momento;</li>
<li>oposição a um tratamento feito sem o seu consentimento.</li>
</ul>
<p>Para exercer qualquer um deles, fale com o encarregado pelo canal indicado no item 1. Você também pode desconectar uma integração diretamente na tela &ldquo;Integrações&rdquo; e revogar a autorização no próprio Strava, Garmin, Zepp ou Apple.</p>

<h2>8. Menores de 18 anos</h2>
<p>O cadastro de atleta menor de 18 anos exige o consentimento específico e destacado de pelo menos um dos pais ou do responsável legal, conforme o artigo 14 da LGPD. O treinador responsável deve obter e guardar esse consentimento antes de liberar o acesso.</p>

<h2>9. Segurança</h2>
<p>As senhas são guardadas apenas como resumo criptográfico com sal (PBKDF2), nunca em texto legível. Os tokens das integrações ficam cifrados no servidor. A sessão expira por inatividade e todo acesso administrativo fica registrado. Em caso de incidente de segurança com risco relevante, comunicaremos você e a Autoridade Nacional de Proteção de Dados em prazo razoável, conforme o artigo 48 da LGPD.</p>

<h2>10. Alterações</h2>
<p>Esta política pode ser atualizada para acompanhar novas funcionalidades, exigências legais e regras dos serviços conectados. A data no topo indica a última revisão.</p>

<p className="legal-links"><a href="/terms">Termos de Uso</a></p>
</section></main>}
