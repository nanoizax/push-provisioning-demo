[English](provider-mapping.md) · [Español](provider-mapping.es.md) · **Português**

# Mapeamento de fornecedores

Esta demo é deliberadamente **agnóstica ao fornecedor**: a fronteira entre emissor/TSP é uma
costura limpa, pelo que o mesmo código da app e a mesma forma do backend encaixam em qualquer
fornecedor de tokenização que a empresa já utilize. Eis como os conceitos se mapeiam para os
programas e plataformas reais.

## Redes de cartões (Token Service Providers)

| Conceito neste repositório | Visa | Mastercard |
| --- | --- | --- |
| Programa de push provisioning | **VDEP** (Visa Digital Enablement Program) | **MDES** (Mastercard Digital Enablement Service) |
| Token de dispositivo | Visa Token (DPAN) | MDES token (DPAN) |
| Referência de conta | PAR (Payment Account Reference) | PAR |
| API de ativação | VTS (Visa Token Service) | MDES for Merchants / Issuers |
| Constante de TSP do TapAndPay | `TOKEN_PROVIDER_VISA` | `TOKEN_PROVIDER_MASTERCARD` |

## Processadores / plataformas de emissor (com quem integra na realidade)

A maioria das fintechs não fala diretamente com a rede — passam por um processador / patrocinador
de BIN que envolve o VDEP/MDES. A fronteira `/server` mapeia-se para qualquer um deles:

| Plataforma | Como o push provisioning é exposto | Onde encaixa |
| --- | --- | --- |
| **Marqeta** | Digital Wallet Token APIs; provisionamento de payload via `pushTokenize`/PassKit | Substituir `cardNetwork.ts` + construção do payload por chamadas ao SDK da Marqeta |
| **Stripe Issuing** | `ephemeral_keys` + auxiliares de push provisioning nos SDKs iOS/Android | O SDK devolve o payload do wallet; a ligação da app aqui mantém-se inalterada |
| **Galileo / i2c / Thredd (Tribe)** | Endpoints de push provisioning do processador sobre VDEP/MDES | Mesma costura: o backend do emissor devolve o payload encriptado / OPC |
| **Apple Pay In-App Provisioning (direto)** | PassKit + a sua própria relação com o TSP | Exatamente a forma `/provisioning/apple` deste repositório |

## O que permanece igual independentemente do fornecedor

- O caminho de código **iOS**: `PKAddPaymentPassViewController` → certificados/nonce do delegate →
  chamada ao emissor → `PKAddPaymentPassRequest`.
- O caminho de código **Android**: elegibilidade `TapAndPay` → OPC do emissor → `pushTokenize` →
  resultado da atividade → `DataChangedListener`.
- A **app nunca vê o PAN**; encaminha payloads opacos.

## O que muda por fornecedor

- Os bytes exatos de `encryptedPassData` / `activationData` (Apple) e do `OPC` (Google),
  que o SDK ou o serviço certificado do fornecedor produz.
- A gestão de certificados, a cerimónia de chaves e a configuração de ID&V / step-up.

> O objetivo desta estrutura: trocar a Marqeta pela Stripe Issuing por uma integração VDEP
> direta toca apenas nas fronteiras marcadas em [`server/src/lib/crypto.ts`](../server/src/lib/crypto.ts)
> e [`server/src/services/cardNetwork.ts`](../server/src/services/cardNetwork.ts) — nunca no código da app.
