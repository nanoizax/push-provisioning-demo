[English](security.md) · **Español** · [Português](security.pt.md)

# Modelo de seguridad

El push provisioning es un flujo de nivel de pagos. Este documento describe el modelo de amenazas, las
garantías y —con honestidad— qué implementa esta demo frente a lo que agrega una integración de
producción.

## Garantías que ofrece el diseño

| Garantía | Cómo |
| --- | --- |
| El PAN en claro nunca llega al dispositivo | Solo se aprovisiona un **token de red (DPAN)**; se cifra antes de salir del emisor. |
| Confidencialidad del payload | Cifrado de contenido con **AES-256-GCM**. Apple: clave a partir de **ECDH P-256** efímero + **X9.63 KDF**. Google: content key + OPC firmada con **ECDSA**. |
| Frescura de clave por solicitud | Apple `ECC_V2` genera un nuevo par de claves EC efímero por solicitud; el **nonce** de PassKit se vincula al `SharedInfo` del KDF, anulando el replay. |
| Integridad / autenticidad del payload | Tag de autenticación GCM sobre el ciphertext; firma ECDSA sobre el envoltorio del OPC de Google. |
| Descifrado confinado a hardware seguro | Solo el **Secure Element** del dispositivo puede volver a derivar la clave y abrir el payload. |
| Autenticación del llamante | Bearer token en cada llamada al emisor (en producción: de vida corta, emitido tras SCA). |
| Control de elegibilidad y riesgo | El emisor decide la elegibilidad; la red ejecuta **ID&V** antes de la activación. |

## Amenazas y mitigaciones

- **PAN robado agregado a la wallet de un atacante** → el push provisioning elimina la entrada manual; el
  emisor (no una persona tecleando) autoriza, y el step-up de ID&V de la red (p. ej. OTP) controla la activación.
- **Replay de un payload capturado** → claves efímeras de un solo uso vinculadas al nonce; el payload solo
  se descifra dentro del Secure Element que participó en el handshake.
- **MITM en el canal** → TLS en tránsito *más* AES-GCM a nivel de aplicación; un observador de la red
  ve ciphertext, nunca el token.
- **Proceso de la app comprometido** → la app nunca guarda material de claves ni el token en claro; solo mueve
  blobs opacos.
- **Abuso del ciclo de vida del token** (dispositivo perdido, tarjeta suspendida) → los webhooks de la red impulsan
  suspend/resume/delete; el ledger del emisor es el registro de auditoría.

## Qué implementa esta demo frente a producción

| Área | Esta demo | Producción |
| --- | --- | --- |
| ECDH / KDF / AES-GCM / ECDSA | ✅ real, ejecutable, probado | Mismas primitivas, formato de red certificado |
| **Verificación** de cadena de certificados y firma del nonce | Parseada; la verificación está simulada (stub) para la demo offline | Validación completa de cadena X.509 + comprobación de firma |
| Almacenamiento de claves | En memoria, generadas al arrancar | **HSM / KMS**, rotación, doble control |
| Token de sesión | Valor estático de entorno | De vida corta, vinculado a SCA, por sesión |
| Almacén de datos | Mapas en memoria | Base de datos + log de auditoría inmutable |
| Tokenización de red | Mock determinista (con forma de VDEP/MDES) | Visa VDEP / Mastercard MDES certificado / SDK del procesador |
| Manejo del PAN | Solo PANs falsos | Alcance PCI-DSS, tokenizado en reposo, nunca registrado en logs |

## Entitlements y allowlisting (no es código — son aprobaciones)

- **iOS:** el entitlement `com.apple.developer.payment-pass-provisioning` lo otorga
  Apple únicamente a emisores/partners aprobados; el In-App Provisioning también requiere habilitación
  por parte de la red. Funciona en un dispositivo real con un Apple ID elegible (no en el simulador).
- **Android:** `TapAndPay` es una API con **allowlisting**. Debes ser un emisor aprobado y
  registrar el nombre de tu paquete + el SHA-256 de firma con Google; las llamadas dan error hasta que se hace el allowlisting.

Estas son barreras comerciales/de onboarding, no algo que el código pueda saltarse — y un candidato que
lo sabe de antemano es exactamente lo que un equipo de integración de emisores quiere escuchar.
