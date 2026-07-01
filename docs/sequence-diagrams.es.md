[English](sequence-diagrams.md) · **Español** · [Português](sequence-diagrams.pt.md)

# Diagramas de secuencia

Ambos wallets siguen la misma forma: **la app nunca ve el PAN en claro**; solo transporta
una carga *cifrada y tokenizada por la red* desde el emisor hacia el wallet del sistema operativo. La diferencia
está en el sobre de cifrado y en el punto de entrada del sistema operativo.

## Apple Wallet — PassKit In-App Provisioning (`ECC_V2`)

```mermaid
sequenceDiagram
    autonumber
    participant App as App del emisor
    participant PK as PassKit / Wallet
    participant Iss as Backend del emisor / TSP
    participant Net as Red de tarjetas (VDEP/MDES)
    participant SE as Secure Element

    App->>Iss: POST /eligibility (card, device)
    Iss-->>App: elegible + red + sufijo
    App->>PK: presenta PKAddPaymentPassViewController
    PK-->>App: delegate: certificates[], nonce, nonceSignature
    App->>Iss: POST /provisioning/apple (certs, nonce, sig)
    Iss->>Net: tokenize(FPAN, deviceId)
    Net-->>Iss: DPAN + tokenRef + PAR
    Note over Iss: par de claves EC efímero → ECDH →<br/>X9.63 KDF → AES-256-GCM(token)
    Iss-->>App: activationData, encryptedPassData, ephemeralPublicKey
    App->>PK: PKAddPaymentPassRequest(...)
    PK->>SE: instala el pass cifrado
    SE->>SE: ECDH(ephemeralPub) → KDF → descifra AES-GCM
    SE-->>PK: token aprovisionado
    PK-->>App: didFinishAdding(pass)
```

## Google Pay — TapAndPay push provisioning (`OPC`)

```mermaid
sequenceDiagram
    autonumber
    participant App as App del emisor
    participant TP as TapAndPay / Google Pay
    participant Iss as Backend del emisor / TSP
    participant Net as Red de tarjetas (VDEP/MDES)

    App->>TP: getStableHardwareId(), getActiveWalletId()
    TP-->>App: hardwareId, walletId
    App->>Iss: POST /eligibility (card, device)
    Iss-->>App: elegible + red + last4
    App->>Iss: POST /provisioning/google/opc (card, device, wallet)
    Iss->>Net: tokenize(FPAN, deviceId)
    Net-->>Iss: DPAN + tokenRef + PAR
    Note over Iss: AES-256-GCM(token) y luego firma ECDSA<br/>→ Opaque Payment Card (OPC)
    Iss-->>App: opc, tsp, network, displayName, last4
    App->>TP: pushTokenize(PushTokenizeRequest(opc, ...))
    TP-->>App: onActivityResult(RESULT_OK, tokenId)
    Note over TP: DataChangedListener → actualizaciones del ciclo de vida del token
```

## Ciclo de vida (ambas plataformas)

```mermaid
stateDiagram-v2
    [*] --> requested: la app inicia el aprovisionamiento
    requested --> provisioned: el wallet instala el token
    provisioned --> active: la red activa (ID&V correcto)
    requested --> failed: rechazado / cancelado
    provisioned --> failed: activación rechazada
    active --> [*]
```

El emisor lo rastrea con el libro mayor de aprovisionamiento (`GET /v1/provisioning/:reference/status`)
y lo hace avanzar a partir del webhook de estado del token de la red (`POST /v1/webhooks/network`).
