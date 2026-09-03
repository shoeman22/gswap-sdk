---
sidebar_position: 3
---

# Migration from 0.x

Version 1.0.0-rc.1 is a breaking migration to the current GalaChain DEX
contract. Legacy names are removed; do not add compatibility fields to v2
DTOs.

## API replacements

| 0.x | v2 replacement |
| --- | --- |
| `Bundler` | `Chain Gateway` writes through `GSwap` |
| `Events` / `EventSocketClient` | No socket; call `SubmittedTransaction.confirm()` |
| `PendingTransaction` | `SubmittedTransaction` |
| `TxWaiter` | `SubmittedTransaction.confirm()` |
| `PendingTransaction.wait()` | `SubmittedTransaction.confirm()` |
| `TransactionPendingResponse` | `IndexedTransaction` returned by `confirm()` |
| `stringsInstructions` | Removed; the gateway derives chain references |
| bundle IDs | `uniqueKey` |
| `transactionId` as the only correlation key | `uniqueKey`; `transactionId` may be empty |
| `GSwap.events.connectEventSocket()` | Removed |
| `GSwap.swap(...)` | `gSwap.swaps.swap(tokenIn, tokenOut, fee, params)` |
| `pools.getPoolData(...)` | `pools.getPool(...)` |
| `positions.getPositionById(...)` | `positions.getPosition({ t0, t1, fee, owner, tickLower, tickUpper })` |

## DTO field replacements

| Removed field or shape | v2 shape |
| --- | --- |
| Class-key object `token0` / `token1` in writes | Trading-symbol `token0` / `token1`; SDK accepts a symbol or class key as input |
| `amount` | One of `sell0Qty`, `sell1Qty`, `buy0Qty`, `buy1Qty` |
| `zeroForOne` | Derived from token ordering and exact-in/exact-out side |
| `sqrtPriceLimit` | Removed; use quote slippage fields |
| `positionId` | Position identity: symbols, fee, owner, and tick range |
| `amount0Desired`, `amount1Desired` | Exactly one `depositQuantityToken0` or `depositQuantityToken1` |
| `amount0Min`, `amount1Min` | `amountOutMinimum` for trades, or estimate before a liquidity write |
| Partial collect amounts | Removed; `collectPositionFees` sweeps everything |
| Partial remove percentage | Optional `withdrawalQuantityToken0` or `withdrawalQuantityToken1`; omit both to close |
| CreatePool class-key `token0` / `token1` | `token0Key` / `token1Key` plus `token0Symbol` / `token1Symbol` |
| `FEE_TIER` without zero | Fee tiers `0`, `500`, `3000`, `10000` |

## Transaction flow

Build a quote, choose the fee and slippage bound, submit through the SDK, then
persist `uniqueKey` and confirm. A successful synchronous response may have an
empty `transactionId` until explorer indexing completes.

```typescript
const quote = await gSwap.quoting.quoteExactOutput('GALA', 'GUSDC', '50');
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactOut: '50',
  amountInMaximum: quote.amountIn,
});
await tx.confirm();
```

## Signing migration

`PrivateKeySigner` remains native. `GalaWalletSigner` no longer signs EIP-712;
it uses native `gala_signChainDto` and an older-wallet personal-sign fallback.
Use `BrowserWalletSigner` for generic EIP-1193 wallets. See
[Signing and Identity](./signing-and-identity.md).
