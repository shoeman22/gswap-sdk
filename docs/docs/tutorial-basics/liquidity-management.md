---
sidebar_position: 5
---

# Liquidity Management

V2 positions are identified by `(token0, token1, fee, owner, tickLower,
tickUpper)`. There is no `positionId`. Tokens may be symbols or class keys;
the SDK resolves and orders them.

## Ticks and price ranges

`addLiquidityByTicks` is the precise API. Ticks must be aligned to the pool's
fee-tier spacing:

```typescript
const tx = await gSwap.positions.addLiquidityByTicks({
  token0: 'GALA',
  token1: 'GUSDC',
  fee: 3000,
  tickLower: -6000,
  tickUpper: 6000,
  amount: '100',
  amountIsToken0: true,
});
await tx.confirm();
```

The spacing is `0 → 200`, `500 → 10`, `3000 → 60`, and `10000 → 200`.
The lower tick must be below the upper tick, both ticks must be within the
contract bounds, and each must be divisible by the pool spacing.

Use `addLiquidityByPrice` when the UI works in token1-per-token0 prices. The
SDK converts the range to ticks and aligns it to the pool spacing:

```typescript
const tx = await gSwap.positions.addLiquidityByPrice({
  token0: 'GALA',
  token1: 'GUSDC',
  fee: 3000,
  minPrice: '0.02',
  maxPrice: '0.04',
  amount: '100',
  amountIsToken0: true,
});
```

Both add APIs require exactly one deposit side. Use
`estimateAddLiquidity` first to calculate the other side for the selected
range and current pool price.

## Remove and collect

`removeLiquidity` accepts an optional withdrawal quantity. Supplying neither
quantity closes the position completely and sweeps its accrued fees:

```typescript
const tx = await gSwap.positions.removeLiquidity({
  token0: 'GALA',
  token1: 'GUSDC',
  fee: 3000,
  tickLower: -6000,
  tickUpper: 6000,
});
await tx.confirm();
```

When withdrawing partially, provide at most one of the SDK's `amount0` or
`amount1` options. The SDK maps it to the contract's
`withdrawalQuantityToken0` or `withdrawalQuantityToken1`. The contract's
`CollectPositionFees` operation always sweeps the complete accrued fee balance;
there are no partial collect amount fields:

```typescript
const tx = await gSwap.positions.collectPositionFees({
  token0: 'GALA',
  token1: 'GUSDC',
  fee: 3000,
  tickLower: -6000,
  tickUpper: 6000,
});
await tx.confirm();
```

## Creating a pool

`CreatePool` is the first place a token's trading symbol may be claimed. Both
symbols must be ASCII alphanumeric, globally available, and consistent with
the class key or its registered `TokenClass.symbol`. `token0Symbol` must be
less than `token1Symbol` using plain string comparison. Supply exactly one
positive `startingPrice` or `startingSqrtPrice`:

```typescript
const tx = await gSwap.positions.createPool({
  token0: 'GALA|Unit|none|none',
  token1: 'GUSDC|Unit|none|none',
  fee: 3000,
  startingPrice: '0.03',
});
console.log(tx.transactionId ?? tx.uniqueKey);
```

CreatePool is not organization-gated. Treat symbols as a global namespace and
choose them carefully; the first successful pool can register them
permanently. CreatePool has no affected position to re-read, so its
`confirm()` result is `null`; use the synchronous result and transaction
metadata above. A duplicate pool is rejected by the gateway or chain.
