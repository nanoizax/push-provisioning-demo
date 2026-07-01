[English](README.md) · **Español** · [Português](README.pt.md)

<div align="center">

# WalletPush — Card Push Provisioning

**Agrega una tarjeta de pago a Apple Wallet y Google Pay directamente desde la app del emisor — un toque, sin escribir nada.**

Una implementación de referencia con forma de producción de *push provisioning* en **iOS (PassKit)**,
**Android (Google Pay TapAndPay)** y el **backend del emisor / Token Service Provider** que
los une — con una demo interactiva que puedes ejecutar en un navegador.

`PassKit ECC_V2` · `TapAndPay OPC` · `ECDH P-256` · `X9.63 KDF` · `AES-256-GCM` · `Visa VDEP / Mastercard MDES`

</div>

---

## ¿Qué es el push provisioning?

Cuando un titular de tarjeta toca **“Agregar a Apple Wallet”** o **“Agregar a Google Pay”** *dentro de la app
de su banco*, la tarjeta llega al wallet del sistema operativo sin que nadie escriba un número de tarjeta. El emisor — que ya
autentica al usuario — responde por la tarjeta, y la red de tarjetas emite un **token** de dispositivo
para que el PAN real nunca toque el teléfono.

Ese único toque es una integración sorprendentemente profunda: un handshake de PassKit / TapAndPay en el
dispositivo, una llamada de tokenización a Visa VDEP o Mastercard MDES, y un sobre criptográfico
por solicitud construido en los servidores del emisor. **Este repositorio implementa las tres partes, de extremo a extremo.**

## Tres pilares

| Pilar | Ruta | Qué demuestra |
| --- | --- | --- |
| 🍎 **Módulo SDK de iOS** | [`/ios`](ios) | `PKAddPaymentPassViewController` + handshake completo del delegado, elegibilidad vía `PKPassLibrary`, ensamblado de la solicitud `ECC_V2`, botón SwiftUI `Add to Wallet` |
| 🤖 **Módulo SDK de Android** | [`/android`](android) | Google Pay `TapAndPay` — `isTokenized`, `pushTokenize(OPC)`, manejo del resultado de la actividad, ciclo de vida de `DataChangedListener`, botón Compose |
| 🏦 **Backend del emisor / TSP** | [`/server`](server) | Elegibilidad, tokenización de red (VDEP/MDES) y la criptografía real: ECDH → X9.63 KDF → AES-256-GCM (Apple) y OPC firmado (Google) |
| 🎬 **Demo interactiva** | [`/web-demo`](web-demo) | Visualización con capacidad offline de ambos flujos — mockup del teléfono, secuencia animada, inspector de payload en vivo |

Análisis en profundidad: [arquitectura](docs/architecture.es.md) · [diagramas de secuencia](docs/sequence-diagrams.es.md) ·
[modelo de seguridad](docs/security.es.md) · [mapeo de proveedores](docs/provider-mapping.es.md).

## Inicio rápido

**Míralo (sin instalación, funciona offline):**

```bash
# just open the file in a browser
open web-demo/index.html          # macOS
start web-demo/index.html         # Windows
```

**Ejecuta el backend del emisor + verifica la criptografía (Node ≥ 22.6, sin dependencias):**

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

Luego cambia la demo web a **“Live API”** para verla impulsar el backend real.

## Cómo funciona (versión de 30 segundos)

```
 Issuer App  ──►  Issuer/TSP backend  ──►  Card Network (VDEP/MDES)
     │                    │  tokenize FPAN → DPAN + PAR
     │                    ▼
     │            encrypt token  (Apple: ECDH+KDF+AES-GCM · Google: signed OPC)
     ▼                    │
 OS Wallet  ◄─────────────┘   Secure Element decrypts · token provisioned · PAN never on device
```

La **app nunca ve el PAN en claro** — solo reenvía un payload cifrado y tokenizado por la red
desde el emisor hacia el wallet del sistema operativo. El flujo completo de mensajes está en los
[diagramas de secuencia](docs/sequence-diagrams.es.md).

## Aspectos destacados de seguridad

- **Criptografía real, probada:** ECDH P-256, ANSI X9.63 KDF, AES-256-GCM, ECDSA — el smoke
  test descifra el payload de Apple para probar su correctitud ([`server/src/lib/crypto.ts`](server/src/lib/crypto.ts)).
- **Claves efímeras por solicitud**, con el nonce de PassKit vinculado al KDF para frustrar el replay.
- **Aislamiento del PAN:** solo se provisiona un token de dispositivo (DPAN); el PAN de fondeo permanece
  dentro del límite del emisor.
- Un [modelo de amenazas + tabla de demo-vs-producción](docs/security.es.md) honesto, que incluye las compuertas
  del entitlement de Apple y del allowlisting de Google, que son aprobaciones comerciales, no código.

## Independiente del proveedor por diseño

El límite emisor/TSP es una costura limpia, de modo que el mismo código de la app y la misma forma del backend encajan sobre
**Marqeta, Stripe Issuing, Galileo, Thredd**, o una integración directa de **Visa VDEP / Mastercard MDES** —
solo cambian los límites marcados. Consulta el [mapeo de proveedores](docs/provider-mapping.es.md).

## Tecnología

| Capa | Stack |
| --- | --- |
| iOS | Swift 5.9+, PassKit, async/await, SwiftUI, SwiftPM |
| Android | Kotlin 2.0, Google Play Services `TapAndPay`, Coroutines, Jetpack Compose, Retrofit |
| Backend | TypeScript en Node ≥ 22.6, `node:crypto`, `node:http` — sin dependencias en runtime |
| Demo | Un único archivo HTML/CSS/JS autocontenido, sin build |

## Estructura del repositorio

```
push-provisioning-demo/
├── ios/         Swift SDK module + sample screen + README
├── android/     Kotlin :pushprovisioning library + :app sample + README
├── server/      Issuer + TSP backend (crypto, tokenization, REST) + smoke test
├── web-demo/    Interactive visualization (index.html)
├── docs/        Architecture, sequence diagrams, security, provider mapping
└── .github/     CI (runs the backend smoke test)
```

## Estado y alcance

Esta es una **implementación de referencia y demo**, diseñada para ser correcta donde importa (la
criptografía y los handshakes de plataforma son reales) y honesta donde un despliegue real necesita
onboarding comercial (entitlement de Apple, allowlisting de Google, formatos de red certificados del TSP,
HSM/KMS, alcance PCI). Cada límite está marcado en el código y documentado en
[security.md](docs/security.es.md).

## Autor

**Leandro Perez** — ingeniero full-stack, [SonhoLab](https://sonholab.com) ·
contacto@sonholab.com · GitHub [@nanoizax](https://github.com/nanoizax)

## Licencia

[MIT](LICENSE) © Leandro Perez
