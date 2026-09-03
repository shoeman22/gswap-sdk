---
sidebar_position: 2
---

# Signing and Identity

The v2 contract has one signature scheme per signer type. The SDK signs the
unsigned DTO exactly as it will be posted to the Chain Gateway.

| Signer | Signature | Account/address input |
| --- | --- | --- |
| `PrivateKeySigner` | GalaChain native `signatures.getSignature` | Recovered from the private key |
| `GalaWalletSigner` on current wallets | `gala_signChainDto` with `native` | Selected `0x&lt;40-hex&gt;` account (`eth|0x...` accepted) |
| `GalaWalletSigner` on older supported wallets | Personal-sign fallback | The same selected Ethereum account |
| `BrowserWalletSigner` | EIP-1193 `personal_sign` with the SDK prefix | Selected `0x&lt;40-hex&gt;` account |

Native signatures have no prefix, EIP-712 domain, or typed-data envelope.
Personal-sign signatures cover the serialized DTO with the calculated
`prefix` field. EIP-712 is gone from v2 because the chain cannot recover the
signer reliably for the current tick-carrying DTOs.

## Native private-key signing

```typescript
const gSwap = new GSwap({
  env: 'stage',
  signer: new PrivateKeySigner(process.env.GALACHAIN_PRIVATE_KEY!),
  walletAddress: '0x0123456789012345678901234567890123456789',
});
```

The native signature identifies the key to the chain. `walletAddress`, when
provided, is the selected Ethereum account used for gateway attribution; the
SDK does not add `signerAddress` or `signerPublicKey` hints to the DTO.

## Gala Wallet version note

Current Gala Wallet builds support the four-parameter call:

```text
gala_signChainDto([serialize(dto), address, methodName, 'native'])
```

The SDK falls back for older wallet builds to the three-parameter
`gala_signChainDto` contract without the final `native` scheme parameter. The
selected Ethereum account remains the same in both calls.

## Browser wallets

Pass an EIP-1193 provider and the selected `0x` Ethereum account to
`BrowserWalletSigner`. The signer requests `personal_sign` and sends
`{ ...dto, prefix, signature }` to the gateway.

Never mix a personal-sign signature with a native alias, or a native signature
with an `eth|...` identity. A mismatch is reported as `SIGNER_MISMATCH` or
`SIGNATURE_INVALID`.
