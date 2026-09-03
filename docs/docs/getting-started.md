---
sidebar_position: 2
---

# Getting Started

## Install

```bash
npm install @gala-chain/gswap-sdk
```

The v2 SDK supports Node.js and browser bundlers. For a server application,
use `PrivateKeySigner`; for Gala Wallet use `GalaWalletSigner`; for an
EIP-1193 provider such as MetaMask use `BrowserWalletSigner`.

## Configure an environment

`env: 'stage'` selects the staging swap backend and `env: 'prod'` selects the
production swap backend. The SDK sends every read and write through that
backend. `dexBackendBaseUrl` overrides the preset, which is useful for tests and
private deployments.

| Preset  | Backend                                        |
| ------- | ---------------------------------------------- |
| `stage` | `https://swap-backend.stage.defi.ovh.gala.com` |
| `prod`  | `https://dex-backend-prod1.defi.gala.com`      |

These are the only hosts used by the SDK; it does not call public GalaChain
gateway hosts directly.

```typescript
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

const gSwap = new GSwap({
  env: 'stage',
  signer: new PrivateKeySigner(process.env.GALACHAIN_PRIVATE_KEY!),
  walletAddress: process.env.GALACHAIN_ADDRESS,
});
```

Keep private keys in environment variables or a secret manager. Never commit a
key or use a production key in a test.

## Read, quote, and write

Tokens may be a registered trading symbol (`GALA`) or a full class key
(`GALA|Unit|none|none`). The SDK resolves symbols and canonicalizes token
ordering for the caller. Quotes are read-only and run against the backend's
offline v2 engine:

```typescript
const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');
console.log(quote.feeTier, quote.amountOut);

const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactIn: '100',
  amountOutMinimum: quote.amountOut,
});
console.log(tx.uniqueKey, tx.transactionId);
```

The write response is synchronous: it contains the executed result, not a
queued bundle. `transactionId` can be `null` or an empty string when the
indexer has not assigned one yet. `await tx.confirm()` polls the durable
`uniqueKey` correlation record for trades, and re-reads the position for
liquidity operations. See [Transaction Status](./tutorial-basics/transaction-status.md).

## Browser setup

```typescript
import { BrowserWalletSigner, GSwap } from '@gala-chain/gswap-sdk';

const provider = window.ethereum;
const [address] = await provider.request({ method: 'eth_requestAccounts' });
const gSwap = new GSwap({
  env: 'stage',
  signer: new BrowserWalletSigner(provider, address),
  walletAddress: address,
});
```

`BrowserWalletSigner` uses `personal_sign`. Gala Wallet integrations should
use `GalaWalletSigner`; current wallets use native `gala_signChainDto`, while
older supported wallets fall back to personal-sign. See
[Signing and Identity](./other/signing-and-identity.md).

## Next steps

- [Quoting](./tutorial-basics/quoting.md)
- [Trading](./tutorial-basics/trading.md)
- [Liquidity Management](./tutorial-basics/liquidity-management.md)
- [Migration from 0.x](./other/migration-from-0.x.md)
