---
sidebar_position: 2
---

# Signing and Identity

The v2 contract has one signature scheme per signer type. The SDK signs the
unsigned DTO exactly as it will be posted to the Chain Gateway.

| Signer | Signature | Alias resolved by the chain |
| --- | --- | --- |
| `PrivateKeySigner` | GalaChain native `signatures.getSignature` | `client|&lt;24-hex&gt;` |
| `GalaWalletSigner` on current wallets | `gala_signChainDto` with `native` | Registered `client|...` |
| `GalaWalletSigner` on older supported wallets | Personal-sign fallback | Bare `eth|&lt;40-hex&gt;` |
| `BrowserWalletSigner` | EIP-1193 `personal_sign` with the SDK prefix | Bare `eth|&lt;40-hex&gt;` |

Native signatures have no prefix, EIP-712 domain, or typed-data envelope.
Personal-sign signatures cover the serialized DTO with the calculated
`prefix` field. EIP-712 is gone from v2 because the chain cannot recover the
signer reliably for the current tick-carrying DTOs.

## Native private-key signing

```typescript
const gSwap = new GSwap({
  env: 'stage',
  signer: new PrivateKeySigner(process.env.GALACHAIN_PRIVATE_KEY!),
  walletAddress: 'client|635f048ab243d7eb7f5ba044',
});
```

The key must be registered for the native `client|...` alias used by the
application. The SDK does not add `signerAddress` or `signerPublicKey` hints to
the DTO.

## Gala Wallet version note

Current Gala Wallet builds support the four-parameter call:

```text
gala_signChainDto([serialize(dto), address, methodName, 'native'])
```

The SDK falls back for older wallet builds to the two-parameter personal-sign
contract. That fallback is intentionally different from native signing: it
recovers the wallet's bare `eth|...` identity. Upgrade the wallet when a
native `client|...` identity is required.

## Browser wallets

Pass an EIP-1193 provider and the selected address to `BrowserWalletSigner`.
The signer requests `personal_sign` and sends `{ ...dto, prefix, signature }`
to the gateway. The address must be the corresponding bare `eth|...` alias.

Never mix a personal-sign signature with a native alias, or a native signature
with an `eth|...` identity. A mismatch is reported as `SIGNER_MISMATCH` or
`SIGNATURE_INVALID`.
