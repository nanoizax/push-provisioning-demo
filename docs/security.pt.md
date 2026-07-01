[English](security.md) · [Español](security.es.md) · **Português**

# Modelo de segurança

O push provisioning é um fluxo de nível de pagamentos. Este documento estabelece o modelo de ameaças, as
garantias e — com honestidade — o que esta demonstração implementa face ao que uma integração de produção
acrescenta.

## Garantias que o design oferece

| Garantia | Como |
| --- | --- |
| O PAN em claro nunca chega ao dispositivo | Apenas é provisionado um **network token (DPAN)**; é encriptado antes de sair do emissor. |
| Confidencialidade do payload | Encriptação de conteúdo **AES-256-GCM**. Apple: chave a partir de **ECDH P-256** efémera + **X9.63 KDF**. Google: chave de conteúdo + OPC assinado com **ECDSA**. |
| Frescura da chave por pedido | O `ECC_V2` da Apple gera um novo par de chaves EC efémero por pedido; o **nonce** do PassKit é vinculado ao `SharedInfo` do KDF, derrotando o replay. |
| Integridade / autenticidade do payload | Etiqueta de autenticação GCM sobre o texto cifrado; assinatura ECDSA sobre o envelope OPC da Google. |
| Desencriptação confinada a hardware seguro | Apenas o **Secure Element** do dispositivo consegue voltar a derivar a chave e abrir o payload. |
| Autenticação do chamador | Bearer token em cada chamada ao emissor (produção: de curta duração, emitido após SCA). |
| Controlo de elegibilidade e risco | O emissor decide a elegibilidade; a rede executa **ID&V** antes da ativação. |

## Ameaças e mitigações

- **PAN roubado adicionado à wallet de um atacante** → o push provisioning elimina a introdução manual; o
  emissor (não um datilógrafo) autoriza, e o step-up de ID&V da rede (por exemplo, OTP) controla a ativação.
- **Replay de um payload capturado** → chaves efémeras de utilização única vinculadas ao nonce; o payload só
  desencripta dentro do Secure Element que participou no handshake.
- **MITM na ligação** → TLS em trânsito *mais* AES-GCM ao nível da aplicação; um observador da rede
  vê texto cifrado, nunca o token.
- **Processo da aplicação comprometido** → a aplicação nunca detém material de chave nem o token em claro; move
  apenas blobs opacos.
- **Abuso do ciclo de vida do token** (dispositivo perdido, cartão suspenso) → os webhooks da rede acionam
  suspend/resume/delete; o ledger do emissor é o registo de auditoria.

## O que esta demonstração implementa face à produção

| Área | Esta demonstração | Produção |
| --- | --- | --- |
| ECDH / KDF / AES-GCM / ECDSA | ✅ real, executável, testado | Mesmas primitivas, formato de comunicação de rede certificado |
| **Verificação** da cadeia de certificados e da assinatura do nonce | Analisada; a verificação está simulada para a demonstração offline | Validação completa da cadeia X.509 + verificação da assinatura |
| Armazenamento de chaves | Em memória, gerado no arranque | **HSM / KMS**, rotação, controlo duplo |
| Token de sessão | Valor estático de ambiente | De curta duração, vinculado ao SCA, por sessão |
| Armazenamento de dados | Mapas em memória | Base de dados + registo de auditoria imutável |
| Tokenização de rede | Mock determinístico (formato VDEP/MDES) | Visa VDEP / Mastercard MDES certificados / SDK do processador |
| Tratamento do PAN | Apenas PANs falsos | Âmbito PCI-DSS, tokenizado em repouso, nunca registado |

## Entitlements e allowlisting (não é código — são aprovações)

- **iOS:** o entitlement `com.apple.developer.payment-pass-provisioning` é concedido pela
  Apple apenas a emissores/parceiros aprovados; o In-App Provisioning exige também a
  ativação por parte da rede. Funciona num dispositivo real com um Apple ID elegível (não no simulador).
- **Android:** o `TapAndPay` é uma API com **allowlisting**. Tem de ser um emissor aprovado e
  registar o nome do seu pacote + o SHA-256 de assinatura junto da Google; as chamadas dão erro até estar em allowlist.

Estes são gates comerciais/de onboarding, não algo que o código possa contornar — e um candidato que
conhece isto à partida é exatamente o que uma equipa de integração de emissores quer ouvir.
