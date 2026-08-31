"use client";

/**
 * Redução do comprovante antes de subir.
 *
 * O comprovante fica no próprio banco, porque o projeto não tem bucket de
 * arquivos. Uma foto de tela sai do celular com 2 a 5 MB, o que não cabe numa
 * linha do D1 nem faz sentido trafegar: aqui ela vira um JPEG de uns 150 KB,
 * ainda legível para conferir valor, data e destinatário, que é para o que o
 * comprovante serve.
 *
 * A redução acontece no navegador, como a leitura do arquivo de atividade: o
 * original nunca sai do aparelho.
 */

export class ComprovanteInvalido extends Error {}

const LADO_MAXIMO = 1000;
/** Teto do que o servidor aceita gravar, com folga para a base64. */
const BYTES_MAXIMOS = 400_000;

function carregaImagem(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const endereco = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => { URL.revokeObjectURL(endereco); resolve(imagem); };
    imagem.onerror = () => { URL.revokeObjectURL(endereco); reject(new ComprovanteInvalido("Não foi possível abrir esta imagem.")); };
    imagem.src = endereco;
  });
}

/**
 * Devolve o comprovante como data URL de JPEG.
 *
 * A qualidade cai em degraus até caber. Insistir numa única tentativa faria a
 * foto grande falhar sem explicação; assim ela chega menor, mas chega.
 */
export async function reduzComprovante(arquivo: File): Promise<{ imagem: string; kb: number }> {
  if (!arquivo.type.startsWith("image/")) {
    throw new ComprovanteInvalido("Envie uma imagem do comprovante. PDF ainda não é aceito.");
  }
  if (arquivo.size > 20 * 1024 * 1024) {
    throw new ComprovanteInvalido("A imagem passa de 20 MB. Tire um print da tela em vez de enviar o arquivo original.");
  }

  const imagem = await carregaImagem(arquivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
  const tela = document.createElement("canvas");
  tela.width = Math.max(1, Math.round(imagem.width * escala));
  tela.height = Math.max(1, Math.round(imagem.height * escala));
  const contexto = tela.getContext("2d");
  if (!contexto) throw new ComprovanteInvalido("Este navegador não conseguiu preparar a imagem.");
  /* Fundo branco: comprovante com transparência viraria preto no JPEG. */
  contexto.fillStyle = "#fff";
  contexto.fillRect(0, 0, tela.width, tela.height);
  contexto.drawImage(imagem, 0, 0, tela.width, tela.height);

  for (const qualidade of [0.72, 0.6, 0.48, 0.36]) {
    const dados = tela.toDataURL("image/jpeg", qualidade);
    if (dados.length <= BYTES_MAXIMOS) {
      return { imagem: dados, kb: Math.round(dados.length / 1024) };
    }
  }
  throw new ComprovanteInvalido("A imagem continua grande demais depois de reduzida. Recorte só a parte do comprovante e envie de novo.");
}
