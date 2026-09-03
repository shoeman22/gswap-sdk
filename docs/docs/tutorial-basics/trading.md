---
sidebar_position: 4
---

# Trading

Trading uses the `Trade` DTO through the swap backend's chain-gateway route.
The SDK resolves the input tokens, chooses the canonical symbols, creates a
`uniqueKey`, signs the DTO, and submits it synchronously.

## Exact input

Sell exactly `100` GALA and protect the minimum output with
`amountOutMinimum`:

```typescript
const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactIn: '100',
  amountOutMinimum: quote.amountOut,
});
console.log(tx.uniqueKey, tx.result);
```

## Exact output

Buy exactly `50` GUSDC and cap the amount of GALA spent:

```typescript
const quote = await gSwap.quoting.quoteExactOutput('GALA', 'GUSDC', '50');
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', quote.feeTier, {
  exactOut: '50',
  amountInMaximum: quote.amountIn,
});
await tx.confirm();
```

`exactIn` and `exactOut` are mutually exclusive. Their corresponding
slippage fields are also directional: `amountOutMinimum` protects an
exact-input trade, while `amountInMaximum` protects an exact-output trade.
The SDK rejects a trade that supplies both sides.

## What happens after submit

The returned `SubmittedTransaction` contains the gateway result immediately.
The `uniqueKey` is stable even when `transactionId` is `null` or `''`; use
`confirm()` to wait for indexer visibility. See
[Transaction Status](./transaction-status.md).

Never send `Trade` through the retired bundler/socket path. The current backend
route is method-specific and the body is the signed DTO itself.
