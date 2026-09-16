/**
 * Quem fez e mantém o ZonasApp.
 *
 * Fica no rodapé de todas as telas, em letra pequena e apagada: quem usa o
 * sistema todo dia não precisa reler isso, mas quem procura o responsável — um
 * aluno com dúvida, um treinador novo, alguém avaliando a plataforma — encontra
 * sem ter de perguntar.
 *
 * O endereço é o mesmo que a política de privacidade já publica por obrigação
 * legal, então não expõe nada que não estivesse exposto.
 */
export const DESENVOLVEDOR = {
  nome: "Yan Augusto Scholze",
  email: "yanaugustoscholze@gmail.com",
};

export function Assinatura() {
  return (
    <p className="assinatura">
      Desenvolvido e mantido por {DESENVOLVEDOR.nome} ·{" "}
      <a href={`mailto:${DESENVOLVEDOR.email}`}>{DESENVOLVEDOR.email}</a>
    </p>
  );
}
