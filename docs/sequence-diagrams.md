# Sequence diagrams

Both wallets follow the same shape — **the app never sees the clear PAN**; it only shuttles
an *encrypted, network-tokenized* payload from the issuer to the OS wallet. The difference
is the encryption envelope and the OS entry point.

## Apple Wallet — PassKit In-App Provisioning (`ECC_V2`)

```mermaid
sequenceDiagram
    autonumber
    participant App as Issuer App
    participant PK as PassKit / Wallet
    participant Iss as Issuer / TSP backend
    participant Net as Card Network (VDEP/MDES)
    participant SE as Secure Element

    App->>Iss: POST /eligibility (card, device)
    Iss-->>App: eligible + network + suffix
    App->>PK: present PKAddPaymentPassViewController
    PK-->>App: delegate: certificates[], nonce, nonceSignature
    App->>Iss: POST /provisioning/apple (certs, nonce, sig)
    Iss->>Net: tokenize(FPAN, deviceId)
    Net-->>Iss: DPAN + tokenRef + PAR
    Note over Iss: ephemeral EC keypair → ECDH →<br/>X9.63 KDF → AES-256-GCM(token)
    Iss-->>App: activationData, encryptedPassData, ephemeralPublicKey
    App->>PK: PKAddPaymentPassRequest(...)
    PK->>SE: install encrypted pass
    SE->>SE: ECDH(ephemeralPub) → KDF → AES-GCM decrypt
    SE-->>PK: token provisioned
    PK-->>App: didFinishAdding(pass)
```

## Google Pay — TapAndPay push provisioning (`OPC`)

```mermaid
sequenceDiagram
    autonumber
    participant App as Issuer App
    participant TP as TapAndPay / Google Pay
    participant Iss as Issuer / TSP backend
    participant Net as Card Network (VDEP/MDES)

    App->>TP: getStableHardwareId(), getActiveWalletId()
    TP-->>App: hardwareId, walletId
    App->>Iss: POST /eligibility (card, device)
    Iss-->>App: eligible + network + last4
    App->>Iss: POST /provisioning/google/opc (card, device, wallet)
    Iss->>Net: tokenize(FPAN, deviceId)
    Net-->>Iss: DPAN + tokenRef + PAR
    Note over Iss: AES-256-GCM(token) then ECDSA sign<br/>→ Opaque Payment Card (OPC)
    Iss-->>App: opc, tsp, network, displayName, last4
    App->>TP: pushTokenize(PushTokenizeRequest(opc, ...))
    TP-->>App: onActivityResult(RESULT_OK, tokenId)
    Note over TP: DataChangedListener → token lifecycle updates
```

## Lifecycle (both platforms)

```mermaid
stateDiagram-v2
    [*] --> requested: app starts provisioning
    requested --> provisioned: wallet installs token
    provisioned --> active: network activates (ID&V ok)
    requested --> failed: declined / cancelled
    provisioned --> failed: activation rejected
    active --> [*]
```

The issuer tracks this with the provisioning ledger (`GET /v1/provisioning/:reference/status`)
and advances it from the network's token-status webhook (`POST /v1/webhooks/network`).
