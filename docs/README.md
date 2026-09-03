# gSwap SDK

The API reference for `@gala-chain/gswap-sdk`, the TypeScript SDK for the
GalaChain DEX. All SDK reads and writes use the configured swap backend; the
SDK does not call public GalaChain gateway hosts directly.

## Example SDK Usage

```bash
npm install @gala-chain/gswap-sdk
```

```typescript
import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';

const gSwap = new GSwap({
  env: 'stage',
  signer: new PrivateKeySigner('your-private-key'),
});

const USDC_SELLING_AMOUNT = '10';

// Quote how much $GALA you can get for 10 USDC
const quote = await gSwap.quoting.quoteExactInput('GUSDC', 'GALA', USDC_SELLING_AMOUNT);

console.log(`Best rate found on ${quote.feeTier} fee tier pool`);

// Execute a swap using the best fee tier from the quote
const result = await gSwap.swaps.swap('GUSDC', 'GALA', quote.feeTier, {
  exactIn: USDC_SELLING_AMOUNT,
  amountOutMinimum: quote.amountOut,
});
```
