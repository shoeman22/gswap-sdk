# gSwap SDK

`@gala-chain/gswap-sdk` is the TypeScript SDK for the current GalaChain DEX
contract. Version 1.0 uses trading symbols for pool operations, signs writes
with the signer supplied by the application, and submits them synchronously
through the Chain Gateway.

## Install

```bash
npm install @gala-chain/gswap-sdk
```

## Quick start

```typescript
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

const signer = new PrivateKeySigner(process.env.GALACHAIN_PRIVATE_KEY!);
const gSwap = new GSwap({ signer, walletAddress: process.env.GALACHAIN_ADDRESS, env: 'stage' });
const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactIn: '100', amountOutMinimum: quote.amountOut,
});
console.log(await tx.confirm());
```

The `env: 'stage'` preset targets the public testnet gateway and staging swap
backend. Use class keys such as `GALA|Unit|none|none` when a symbol is not
available; the SDK resolves registered symbols and orders pool tokens for you.
Every write returns a `SubmittedTransaction` immediately. Its `uniqueKey` is
the durable correlation key, and `confirm()` checks the indexed transaction
or position state. A chain `transactionId` may be empty while indexing catches
up.

## Signers and identity

| Signer | Scheme | Identity resolved by the chain |
| --- | --- | --- |
| `PrivateKeySigner` | GalaChain native signature | Registered `client|...` alias |
| `GalaWalletSigner` | Native `gala_signChainDto`, with personal-sign fallback for older wallets | Native: registered `client|...`; fallback: bare `eth|...` |
| `BrowserWalletSigner` | EIP-1193 `personal_sign` | Bare `eth|...` alias |

Native signing is the default for server keys and current Gala Wallets.
Browser wallet personal-sign includes the SDK's calculated prefix. EIP-712 is
not part of the v2 write protocol.

## Documentation

Read the [gSwap SDK documentation](https://galachain.github.io/gswap-sdk/docs/intro)
for setup, quoting, trading, liquidity, signing, migration, and API reference
guides. Working examples are in [`examples/cli`](./examples/cli) and
[`examples/full_dex`](./examples/full_dex).

## License

This SDK is provided under the Apache License 2.0. Gala™, GalaChain™, and
related marks are trademarks of Blockchain Game Partners Inc. This software is
provided “AS IS” without warranties of any kind.
