[English](README.md) · [Español](README.es.md) · **Português**

<div align="center">

# WalletPush — Provisionamento de Cartões por Push

**Adicione um cartão de pagamento à Apple Wallet e ao Google Pay diretamente a partir da app do emissor — um toque, sem escrever nada.**

Uma implementação de referência com forma de produção de *push provisioning* em **iOS (PassKit)**,
**Android (Google Pay TapAndPay)** e no **backend do emissor / Token Service Provider** que
os liga a todos — com uma demonstração interativa que pode executar num browser.

`PassKit ECC_V2` · `TapAndPay OPC` · `ECDH P-256` · `X9.63 KDF` · `AES-256-GCM` · `Visa VDEP / Mastercard MDES`

</div>

---

## O que é o push provisioning?

Quando um titular do cartão toca em **“Adicionar à Apple Wallet”** ou **“Adicionar ao Google Pay”** *dentro da
app do seu banco*, o cartão aparece na wallet do sistema operativo sem que ninguém escreva um número de cartão. O emissor — que já
autentica o utilizador — dá garantia do cartão, e a rede do cartão emite um **token** de dispositivo
para que o PAN real nunca chegue ao telemóvel.

Esse único toque é uma integração surpreendentemente profunda: um handshake PassKit / TapAndPay no
dispositivo, uma chamada de tokenização à Visa VDEP ou à Mastercard MDES, e um envelope criptográfico
por pedido construído nos servidores do emissor. **Este repositório implementa os três, de ponta a ponta.**

## Três pilares

| Pilar | Caminho | O que demonstra |
| --- | --- | --- |
| 🍎 **Módulo SDK iOS** | [`/ios`](ios) | `PKAddPaymentPassViewController` + handshake completo do delegate, elegibilidade via `PKPassLibrary`, montagem do pedido `ECC_V2`, botão SwiftUI `Add to Wallet` |
| 🤖 **Módulo SDK Android** | [`/android`](android) | Google Pay `TapAndPay` — `isTokenized`, `pushTokenize(OPC)`, tratamento de resultado da activity, ciclo de vida `DataChangedListener`, botão Compose |
| 🏦 **Backend do emissor / TSP** | [`/server`](server) | Elegibilidade, tokenização de rede (VDEP/MDES) e a encriptação real: ECDH → X9.63 KDF → AES-256-GCM (Apple) e OPC assinado (Google) |
| 🎬 **Demonstração interativa** | [`/web-demo`](web-demo) | Visualização de ambos os fluxos com capacidade offline — mockup de telemóvel, sequência animada, inspetor de payload em direto |

Análises aprofundadas: [arquitetura](docs/architecture.pt.md) · [diagramas de sequência](docs/sequence-diagrams.pt.md) ·
[modelo de segurança](docs/security.pt.md) · [mapeamento de fornecedores](docs/provider-mapping.pt.md).

## Início rápido

**Ver a demonstração (sem instalação, funciona offline):**

```bash
# just open the file in a browser
open web-demo/index.html          # macOS
start web-demo/index.html         # Windows
```

**Executar o backend do emissor + verificar a encriptação (Node ≥ 22.6, zero dependências):**

```bash
cd server
npm start          # -> http://localhost:8787
npm run smoke      # end-to-end test — proves the encrypted payload decrypts
```

```
✅  blocked card cannot be provisioned (403)
✅  apple encryptedPassData DECRYPTS to the network token
✅  clear funding PAN is NOT present anywhere in the apple payload
✅  google OPC signature verifies against the TSP key
✅  webhook advances lifecycle to active
All checks passed (0 failed)
```

Depois, mude a demonstração web para **“Live API”** para vê-la a operar o backend real.

## Como funciona (versão de 30 segundos)

```
 Issuer App  ──►  Issuer/TSP backend  ──►  Card Network (VDEP/MDES)
     │                    │  tokenize FPAN → DPAN + PAR
     │                    ▼
     │            encrypt token  (Apple: ECDH+KDF+AES-GCM · Google: signed OPC)
     ▼                    │
 OS Wallet  ◄─────────────┘   Secure Element decrypts · token provisioned · PAN never on device
```

A **app nunca vê o PAN em claro** — apenas reencaminha um payload encriptado e tokenizado pela rede,
do emissor para a wallet do sistema operativo. Fluxo completo de mensagens nos
[diagramas de sequência](docs/sequence-diagrams.pt.md).

## Destaques de segurança

- **Criptografia real, testada:** ECDH P-256, ANSI X9.63 KDF, AES-256-GCM, ECDSA — o smoke
  test desencripta o payload da Apple para provar que está correto ([`server/src/lib/crypto.ts`](server/src/lib/crypto.ts)).
- **Chaves efémeras por pedido**, com o nonce do PassKit incorporado no KDF para anular ataques de repetição.
- **Isolamento do PAN:** apenas um token de dispositivo (DPAN) é alguma vez provisionado; o PAN de financiamento permanece
  dentro da fronteira do emissor.
- Um [modelo de ameaças + tabela demo-vs-produção](docs/security.pt.md) honesto, incluindo os gates do
  entitlement da Apple e do allowlisting da Google, que são aprovações comerciais, não código.

## Agnóstico de fornecedor por conceção

A fronteira emissor/TSP é uma junção limpa, por isso o mesmo código de app e a mesma forma de backend
encaixam na **Marqeta, Stripe Issuing, Galileo, Thredd** ou numa integração direta com **Visa VDEP / Mastercard MDES** —
só as fronteiras assinaladas mudam. Ver [mapeamento de fornecedores](docs/provider-mapping.pt.md).

## Tecnologia

| Camada | Stack |
| --- | --- |
| iOS | Swift 5.9+, PassKit, async/await, SwiftUI, SwiftPM |
| Android | Kotlin 2.0, Google Play Services `TapAndPay`, Coroutines, Jetpack Compose, Retrofit |
| Backend | TypeScript em Node ≥ 22.6, `node:crypto`, `node:http` — zero dependências em tempo de execução |
| Demo | Um único ficheiro HTML/CSS/JS autocontido, sem build |

## Organização do repositório

```
push-provisioning-demo/
├── ios/         Swift SDK module + sample screen + README
├── android/     Kotlin :pushprovisioning library + :app sample + README
├── server/      Issuer + TSP backend (crypto, tokenization, REST) + smoke test
├── web-demo/    Interactive visualization (index.html)
├── docs/        Architecture, sequence diagrams, security, provider mapping
└── .github/     CI (runs the backend smoke test)
```

## Estado e âmbito

Isto é uma **implementação de referência e demonstração**, projetada para ser correta onde importa (a
encriptação e os handshakes de plataforma são reais) e honesta onde uma implementação real necessita de
onboarding comercial (entitlement da Apple, allowlisting da Google, formatos de fio TSP certificados,
HSM/KMS, âmbito PCI). Cada fronteira está assinalada no código e documentada em
[security.md](docs/security.pt.md).

## Autor

**Leandro Perez** — engenheiro full-stack, [SonhoLab](https://sonholab.com) ·
contacto@sonholab.com · GitHub [@nanoizax](https://github.com/nanoizax)

## Licença

[MIT](LICENSE) © Leandro Perez
