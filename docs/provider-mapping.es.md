[English](provider-mapping.md) · **Español** · [Português](provider-mapping.pt.md)

# Mapeo de proveedores

Esta demo es deliberadamente **agnóstica del proveedor**: la frontera entre el emisor y el TSP es una costura limpia, de modo que el mismo código de la app y la misma forma del backend encajan sobre cualquier proveedor de tokenización que la empresa ya utilice. Así es como los conceptos se corresponden con los programas y plataformas reales.

## Redes de tarjetas (Token Service Providers)

| Concepto en este repositorio | Visa | Mastercard |
| --- | --- | --- |
| Programa de push provisioning | **VDEP** (Visa Digital Enablement Program) | **MDES** (Mastercard Digital Enablement Service) |
| Token de dispositivo | Visa Token (DPAN) | MDES token (DPAN) |
| Referencia de cuenta | PAR (Payment Account Reference) | PAR |
| API de habilitación | VTS (Visa Token Service) | MDES for Merchants / Issuers |
| Constante TSP de TapAndPay | `TOKEN_PROVIDER_VISA` | `TOKEN_PROVIDER_MASTERCARD` |

## Procesadores / plataformas de emisor (con quién te integras realmente)

La mayoría de las fintech no se comunican directamente con la red: lo hacen a través de un procesador / patrocinador de BIN que envuelve VDEP/MDES. La frontera de `/server` se corresponde con cualquiera de ellos:

| Plataforma | Cómo se expone el push provisioning | Dónde encaja |
| --- | --- | --- |
| **Marqeta** | Digital Wallet Token APIs; aprovisionamiento de payload `pushTokenize`/PassKit | Reemplaza `cardNetwork.ts` + la construcción del payload por llamadas al SDK de Marqeta |
| **Stripe Issuing** | `ephemeral_keys` + helpers de push provisioning en los SDK de iOS/Android | El SDK devuelve el payload del wallet; el cableado de la app aquí no cambia |
| **Galileo / i2c / Thredd (Tribe)** | Endpoints de push provisioning del procesador sobre VDEP/MDES | La misma costura: el backend del emisor devuelve el payload cifrado / OPC |
| **Apple Pay In-App Provisioning (directo)** | PassKit + tu propia relación con el TSP | Exactamente la forma de `/provisioning/apple` de este repositorio |

## Qué permanece igual sin importar el proveedor

- La ruta de código de **iOS**: `PKAddPaymentPassViewController` → certificados/nonce del delegate → llamada al emisor → `PKAddPaymentPassRequest`.
- La ruta de código de **Android**: elegibilidad de `TapAndPay` → OPC del emisor → `pushTokenize` → resultado de la activity → `DataChangedListener`.
- La **app nunca ve el PAN**; reenvía payloads opacos.

## Qué cambia según el proveedor

- Los bytes exactos de `encryptedPassData` / `activationData` (Apple) y el `OPC` (Google), que produce el SDK del proveedor o su servicio certificado.
- La gestión de certificados, la ceremonia de claves y la configuración de ID&V / step-up.

> El propósito de esta estructura: cambiar Marqeta por Stripe Issuing o por una integración directa de VDEP toca únicamente las fronteras marcadas en [`server/src/lib/crypto.ts`](../server/src/lib/crypto.ts) y [`server/src/services/cardNetwork.ts`](../server/src/services/cardNetwork.ts), nunca el código de la app.
