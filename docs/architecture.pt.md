[English](architecture.md) · [Español](architecture.es.md) · **Português**

# Arquitetura

## Os intervenientes

| Interveniente | Papel |
| --- | --- |
| **App do emissor** (iOS / Android) | A app do banco/fintech em que o titular do cartão já confia. Inicia o provisioning e faz circular payloads opacos — nunca manipula o PAN em claro. |
| **Backend do emissor / TSP** | Confirma a elegibilidade, pede um token de rede e produz o payload cifrado específico da plataforma. Modelado por [`/server`](../server). |
| **Rede de cartões** (Visa **VDEP** / Mastercard **MDES**) | O Token Service Provider. Transforma um Funding PAN (FPAN) num token de dispositivo (DPAN) + PAR e executa a decisão de risco de ID&V. |
| **Wallet do SO** (Apple Wallet / Google Pay) | Apresenta a interface do sistema para adicionar cartão e instala o token no Secure Element do dispositivo. |

## Porquê o provisioning "push"

- **Provisioning pull / manual:** o utilizador abre a app da wallet e introduz o número do cartão.
  Muito atrito, muita fraude (qualquer pessoa com o PAN o pode adicionar), fraca conversão.
- **Push provisioning:** o utilizador toca em **“Adicionar à Apple Wallet / Google Pay”** *dentro da
  app do emissor*, já autenticado. Um toque, sem introduzir dados, e é o emissor — não quem digita —
  que responde pelo cartão. É este o fluxo que os bancos e neobancos pedem.

## Estrutura do repositório

```
push-provisioning-demo/
├── ios/         Swift SDK module — PassKit PKAddPaymentPassViewController + delegate
├── android/     Kotlin SDK module — Google Pay TapAndPay pushTokenize
├── server/      Issuer + TSP backend — ECDH/AES-GCM crypto, tokenization, REST API
├── web-demo/    Interactive, offline-capable visualization of both flows
└── docs/        This documentation set
```

## Invariantes do fluxo de dados

1. **O PAN em claro nunca chega ao dispositivo.** A app apenas detém em qualquer momento um payload
   cifrado (Apple) ou um blob opaco (Google) que transporta um *token*, não o número de financiamento.
2. **As chaves são efémeras e associadas ao pedido.** O `ECC_V2` da Apple deriva uma chave AES nova por
   pedido a partir de um par de chaves EC efémero + o nonce do PassKit; a chave existe apenas o tempo
   suficiente para cifrar um payload.
3. **A desencriptação acontece no Secure Element.** Só o hardware seguro do dispositivo pode
   voltar a derivar a chave e abrir o payload — o processo da app não o consegue fazer.
4. **O emissor é a fonte de verdade.** A elegibilidade, a tokenization e o ciclo de vida passam todos
   pelo emissor/TSP, que é onde residem o risco (ID&V), a autenticação reforçada (step-up) e a auditoria.

## Como as peças se alinham com o código

| Conceito | iOS | Android | Backend |
| --- | --- | --- | --- |
| Elegibilidade | `WalletProvisioningManager.canAddCard` + `/eligibility` | `PushProvisioningManager.isCardTokenized` + `/eligibility` | `POST /v1/cards/:id/eligibility` |
| Passagem para o SO | `PKAddPaymentPassViewController` | `TapAndPay.pushTokenize` | — |
| Payload cifrado | delegate → `/provisioning/apple` | `/provisioning/google/opc` | `crypto.ts` (`buildApplePayload` / `buildOpaquePaymentCard`) |
| Tokenization | — | — | `cardNetwork.ts` (`tokenize`) |
| Ciclo de vida | `didFinishAdding` | `handleActivityResult` + `DataChangedListener` | `/provisioning/:ref/status`, `/webhooks/network` |

Consulte [sequence-diagrams.pt.md](sequence-diagrams.pt.md) para o fluxo de mensagens completo e
[security.pt.md](security.pt.md) para o modelo de ameaças.
