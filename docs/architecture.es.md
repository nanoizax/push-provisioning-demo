[English](architecture.md) · **Español** · [Português](architecture.pt.md)

# Arquitectura

## Los actores

| Actor | Rol |
| --- | --- |
| **App del emisor** (iOS / Android) | La app del banco/fintech en la que el titular de la tarjeta ya confía. Inicia el aprovisionamiento y traslada cargas útiles opacas — nunca maneja el PAN en claro. |
| **Backend del emisor / TSP** | Confirma la elegibilidad, solicita un token de red y produce la carga útil cifrada específica de cada plataforma. Modelado por [`/server`](../server). |
| **Red de tarjetas** (Visa **VDEP** / Mastercard **MDES**) | El Token Service Provider. Convierte un Funding PAN (FPAN) en un token de dispositivo (DPAN) + PAR y ejecuta la decisión de riesgo de ID&V. |
| **Wallet del SO** (Apple Wallet / Google Pay) | Presenta la interfaz del sistema para agregar tarjetas e instala el token en el Secure Element del dispositivo. |

## Por qué aprovisionamiento "push"

- **Aprovisionamiento pull / manual:** el usuario abre la app de la wallet y escribe el número de tarjeta.
  Alta fricción, alto fraude (cualquiera con el PAN puede agregarla), baja conversión.
- **Push provisioning:** el usuario toca **“Add to Apple Wallet / Google Pay”** *dentro de la
  app del emisor*, ya autenticado. Un solo toque, sin escribir nada, y el emisor — no quien
  teclea — respalda la tarjeta. Este es el flujo que piden los bancos y neobancos.

## Estructura del repositorio

```
push-provisioning-demo/
├── ios/         Swift SDK module — PassKit PKAddPaymentPassViewController + delegate
├── android/     Kotlin SDK module — Google Pay TapAndPay pushTokenize
├── server/      Issuer + TSP backend — ECDH/AES-GCM crypto, tokenization, REST API
├── web-demo/    Interactive, offline-capable visualization of both flows
└── docs/        This documentation set
```

## Invariantes del flujo de datos

1. **El PAN en claro nunca llega al dispositivo.** La app solo mantiene una carga útil cifrada
   (Apple) o un blob opaco (Google) que transporta un *token*, no el número de financiación.
2. **Las claves son efímeras y ligadas a la solicitud.** El `ECC_V2` de Apple deriva una clave AES
   nueva por solicitud a partir de un par de claves EC efímeras + el nonce de PassKit; la clave
   existe solo el tiempo suficiente para cifrar una carga útil.
3. **El descifrado ocurre en el Secure Element.** Solo el hardware seguro del dispositivo puede
   volver a derivar la clave y abrir la carga útil — el proceso de la app no puede.
4. **El emisor es la fuente de verdad.** La elegibilidad, la tokenización y el ciclo de vida
   pasan todos por el emisor/TSP, donde residen el riesgo (ID&V), la autenticación reforzada
   (step-up) y la auditoría.

## Cómo encajan las piezas con el código

| Concepto | iOS | Android | Backend |
| --- | --- | --- | --- |
| Elegibilidad | `WalletProvisioningManager.canAddCard` + `/eligibility` | `PushProvisioningManager.isCardTokenized` + `/eligibility` | `POST /v1/cards/:id/eligibility` |
| Transferencia al SO | `PKAddPaymentPassViewController` | `TapAndPay.pushTokenize` | — |
| Carga útil cifrada | delegate → `/provisioning/apple` | `/provisioning/google/opc` | `crypto.ts` (`buildApplePayload` / `buildOpaquePaymentCard`) |
| Tokenización | — | — | `cardNetwork.ts` (`tokenize`) |
| Ciclo de vida | `didFinishAdding` | `handleActivityResult` + `DataChangedListener` | `/provisioning/:ref/status`, `/webhooks/network` |

Consulta [sequence-diagrams.es.md](sequence-diagrams.es.md) para el flujo de mensajes completo y
[security.es.md](security.es.md) para el modelo de amenazas.
