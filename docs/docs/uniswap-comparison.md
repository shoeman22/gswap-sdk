---
sidebar_position: 8
---

# gSwap for Uniswap Users

gSwap uses familiar concentrated-liquidity ideas, but its contract and
transaction model are different from Uniswap V3.

| Concept | Uniswap V3 | gSwap SDK v2 |
| --- | --- | --- |
| Pool identity | Token addresses plus fee | Registered trading symbols plus fee |
| Token input | ERC-20 address | Symbol or GalaChain class key |
| Amounts | Raw integer units | Human-readable decimal strings |
| Quote | Quoter contract call | Backend offline quote engine |
| Write path | Router transaction | Signed DTO through Chain Gateway |
| Confirmation | Transaction receipt | `SubmittedTransaction.confirm()` |
| Position identity | NFT `tokenId` | Pool, owner, and tick range; no `positionId` |
| Fee tiers | Deployment-specific | `0`, `500`, `3000`, `10000` |

## Quotes

Uniswap's `quoteExactInputSingle` is replaced by a read-only SDK method. An
omitted fee compares every available v2 tier:

```typescript
const quote = await gSwap.quoting.quoteExactInput('GWETH', 'GUSDC', '0.1');
console.log(quote.feeTier, quote.amountOut, quote.totalFees);

const exactOutput = await gSwap.quoting.quoteExactOutput('GWETH', 'GUSDC', '3000', 3000);
```

## Swaps

The v2 SDK accepts the same exact-input/exact-output intent, but the slippage
fields are explicit and the signer is configured on the client:

```typescript
const tx = await gSwap.swaps.swap('GWETH', 'GUSDC', quote.feeTier, {
  exactIn: '0.1',
  amountOutMinimum: quote.amountOut,
});
const indexed = await tx.confirm();
```

The Chain Gateway receives the signed DTO at
`/v1/chain/asset/dex-contract/Trade`. There is no router ABI, bundler, or
socket event subscription. Persist `tx.uniqueKey`; `transactionId` may be
empty while the explorer index catches up.

## Liquidity

Uniswap's NFT mint is a gSwap AddLiquidity write. The position is merged by
pool, owner, and tick range, and an add operation supplies exactly one deposit
side:

```typescript
const tx = await gSwap.positions.addLiquidityByTicks({
  token0: 'GUSDC',
  token1: 'GWETH',
  fee: 3000,
  tickLower: -6000,
  tickUpper: 6000,
  amount: '3000',
  amountIsToken0: true,
});
await tx.confirm();
```

Use `addLiquidityByPrice` when a UI collects token1-per-token0 prices. The SDK
converts prices to spacing-aligned ticks. Spacing is `200` for fee `0`, `10`
for `500`, `60` for `3000`, and `200` for `10000`.

`removeLiquidity` takes an optional token withdrawal quantity. Omitting both
quantities closes the position and sweeps fees. `collectPositionFees` always
sweeps the complete accrued balance; there is no partial collect amount.

## Identity and signing

Uniswap users often think in terms of an EVM address. GalaChain has two alias
families: native keys resolve registered `client|&lt;24-hex&gt;` identities, while
personal-sign browser wallets resolve bare `eth|&lt;40-hex&gt;` identities.
`PrivateKeySigner` is native, `GalaWalletSigner` is native with an older-wallet
personal-sign fallback, and `BrowserWalletSigner` uses EIP-1193 personal-sign.
EIP-712 is not used by v2.

See [Signing and Identity](./other/signing-and-identity.md) and
[Migration from 0.x](./other/migration-from-0.x.md) for the complete mapping.
