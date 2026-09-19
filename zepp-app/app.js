/**
 * Entrada do mini-app no relógio.
 *
 * `BaseApp` vem do @zeppos/zml e é o que liga o canal com o celular. Sem ele,
 * `this.request` na página e `this.call` no Side Service não têm por onde
 * trafegar — o canal cru (`messaging.peerSocket`) existe, mas não fatia mensagem
 * grande, e um treino com várias etapas passa do tamanho de um pacote.
 */
import { BaseApp } from "@zeppos/zml/base-app";

App(
  BaseApp({
    globalData: {},
    onCreate() {},
    onDestroy() {},
  }),
);
