---
sidebar_position: 2
---

# Asset Balances

`getUserAssets` reads the backend's user-assets endpoint. It is public and
does not require a signer.

```typescript
const assets = await gSwap.assets.getUserAssets('client|635f048ab243d7eb7f5ba044');

for (const asset of assets.tokens) {
  console.log(`${asset.symbol}: ${asset.quantity} (${asset.decimals} decimals)`);
}
console.log(`Token count: ${assets.count}`);
```

The `owner` may be a native `client|...` alias or a bare `eth|...` alias. The
method retains pagination options when a wallet has many assets:

```typescript
const firstPage = await gSwap.assets.getUserAssets(owner, 1, 20);
const nextPage = await gSwap.assets.getUserAssets(owner, 2, 20);
```

Balances are useful for choosing a deposit side before calling
`positions.estimateAddLiquidity`. They do not reserve funds; a subsequent
write still has to pass the chain's balance checks.
