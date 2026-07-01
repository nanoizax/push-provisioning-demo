[English](sequence-diagrams.md) · [Español](sequence-diagrams.es.md) · **Português**

# Diagramas de sequência

Ambas as wallets seguem a mesma estrutura — **a app nunca vê o PAN em claro**; limita-se a transportar
um payload *encriptado e tokenizado na rede* desde o emissor até à wallet do SO. A diferença
está no envelope de encriptação e no ponto de entrada do SO.

## Apple Wallet — PassKit In-App Provisioning (`ECC_V2`)

```mermaid
sequenceDiagram
    autonumber
    participant App as App do emissor
    participant PK as PassKit / Wallet
    participant Iss as Backend do emissor / TSP
    participant Net as Rede do cartão (VDEP/MDES)
    participant SE as Secure Element

    App->>Iss: POST /eligibility (card, device)
    Iss-->>App: elegível + rede + sufixo
    App->>PK: apresentar PKAddPaymentPassViewController
    PK-->>App: delegate: certificates[], nonce, nonceSignature
    App->>Iss: POST /provisioning/apple (certs, nonce, sig)
    Iss->>Net: tokenize(FPAN, deviceId)
    Net-->>Iss: DPAN + tokenRef + PAR
    Note over Iss: par de chaves EC efémero → ECDH →<br/>X9.63 KDF → AES-256-GCM(token)
    Iss-->>App: activationData, encryptedPassData, ephemeralPublicKey
    App->>PK: PKAddPaymentPassRequest(...)
    PK->>SE: instalar pass encriptado
    SE->>SE: ECDH(ephemeralPub) → KDF → desencriptar AES-GCM
    SE-->>PK: token aprovisionado
    PK-->>App: didFinishAdding(pass)
```

## Google Pay — TapAndPay push provisioning (`OPC`)

```mermaid
sequenceDiagram
    autonumber
    participant App as App do emissor
    participant TP as TapAndPay / Google Pay
    participant Iss as Backend do emissor / TSP
    participant Net as Rede do cartão (VDEP/MDES)

    App->>TP: getStableHardwareId(), getActiveWalletId()
    TP-->>App: hardwareId, walletId
    App->>Iss: POST /eligibility (card, device)
    Iss-->>App: elegível + rede + last4
    App->>Iss: POST /provisioning/google/opc (card, device, wallet)
    Iss->>Net: tokenize(FPAN, deviceId)
    Net-->>Iss: DPAN + tokenRef + PAR
    Note over Iss: AES-256-GCM(token) e depois assinar com ECDSA<br/>→ Opaque Payment Card (OPC)
    Iss-->>App: opc, tsp, network, displayName, last4
    App->>TP: pushTokenize(PushTokenizeRequest(opc, ...))
    TP-->>App: onActivityResult(RESULT_OK, tokenId)
    Note over TP: DataChangedListener → atualizações do ciclo de vida do token
```

## Ciclo de vida (ambas as plataformas)

```mermaid
stateDiagram-v2
    [*] --> requested: app inicia o aprovisionamento
    requested --> provisioned: wallet instala o token
    provisioned --> active: rede ativa (ID&V ok)
    requested --> failed: recusado / cancelado
    provisioned --> failed: ativação rejeitada
    active --> [*]
```

O emissor acompanha este processo com o ledger de aprovisionamento (`GET /v1/provisioning/:reference/status`)
e fá-lo avançar a partir do webhook de estado do token da rede (`POST /v1/webhooks/network`).
