---
sidebar_position: 1
---

# gSwap SDK v2

gSwap SDK v2 is a typed client for the current `GalaChainDex` contract. It
uses trading symbols as the pool identity, resolves class keys through the
symbol registry, and orders `token0` and `token1` with plain string ordering.

The public surface is grouped by responsibility:

- `gSwap.quoting` runs read-only exact-input and exact-output simulations.
- `gSwap.swaps` submits `Trade` DTOs.
- `gSwap.pools` reads pools, slot0, and composite pool snapshots.
- `gSwap.positions` reads positions and submits liquidity operations.
- `gSwap.assets` reads user balances; `gSwap.symbols` resolves symbols.

All writes go directly through the Chain Gateway. The SDK signs the DTO,
posts it to the method-specific gateway route, and returns a
`SubmittedTransaction` after the synchronous chain response. There is no
bundler, socket waiter, or EIP-712 write path.

```typescript
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

const gSwap = new GSwap({
  env: 'stage',
  signer: new PrivateKeySigner(process.env.GALACHAIN_PRIVATE_KEY!),
  walletAddress: process.env.GALACHAIN_ADDRESS,
});

const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactIn: '100',
  amountOutMinimum: quote.amountOut,
});
await tx.confirm();
```

Start with [Getting Started](./getting-started.md), then follow the tutorials
for [quoting](./tutorial-basics/quoting.md), [trading](./tutorial-basics/trading.md),
and [liquidity management](./tutorial-basics/liquidity-management.md).
