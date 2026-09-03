---
sidebar_position: 4
---

# Fees

The pool fee tier is expressed in hundredths of a basis point in the SDK. The
current contract supports four tiers:

| Fee tier | Trading fee | Tick spacing | Protocol fee |
| ---: | ---: | ---: | ---: |
| `0` | 0% | 200 | 0.1 of the trading fee |
| `500` | 0.05% | 10 | 0.1 of the trading fee |
| `3000` | 0.30% | 60 | 0.1 of the trading fee |
| `10000` | 1.00% | 200 | 0.1 of the trading fee |

Tier `0` is the no-trading-fee tier. It still has a tick spacing of 200 and is
not interchangeable with a missing fee value. Omitting `fee` from a quote
asks the backend to compare all available tiers, including `0`.

```typescript
const quote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100');
console.log(`Best tier: ${quote.feeTier}`);

const zeroFeeQuote = await gSwap.quoting.quoteExactInput('GALA', 'GUSDC', '100', 0);
```

Trading fees are included in quote amounts. The protocol fee is currently
fixed at 10% of the trading fee. The v2 contract does not add a separate gSwap
gas charge; network fee policy is outside the quote.

Tick ranges must use the spacing shown above. For example, a `3000` pool must
use lower and upper ticks divisible by 60. See
[Liquidity Concentration](./liquidity-concentration.md).
