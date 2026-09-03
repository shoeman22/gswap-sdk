---
sidebar_position: 1
---

# Quoting

Quotes are read-only simulations from the v2 backend. They accept symbols or
class keys, and an omitted fee compares all available pools (`0`, `500`,
`3000`, and `10000`).

```typescript
const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');

console.log(`Tier: ${quote.feeTier}`);
console.log(`Input: ${quote.amountIn}`);
console.log(`Output: ${quote.amountOut}`);
console.log(`Trading fees: ${quote.tradingFees}`);
```

Use exact output when the received amount is fixed:

```typescript
const quote = await gSwap.quoting.quoteExactOutput('GALA', 'GUSDC', '50', 3000);
console.log(`Spend at most ${quote.amountIn} GALA for 50 GUSDC`);
```

The quote includes the selected `fee`, canonical `token0Symbol` and
`token1Symbol`, current and post-trade square-root prices, and the protocol,
trading, and total fee amounts. It also reports `tokenInIsToken0`, which is
useful when building a lower-level Trade DTO. Prices can change between a
quote and a write, so always set a slippage bound on the write and refresh
large or delayed quotes.

```typescript
const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactIn: '100',
  amountOutMinimum: quote.amountOut,
});
```

An exact-input trade uses `amountOutMinimum`; an exact-output trade uses
`amountInMaximum`. Both values are optional, but omitting them removes
slippage protection. A missing pool or insufficient liquidity is reported as
an SDK error.
