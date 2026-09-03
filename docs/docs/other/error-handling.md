---
sidebar_position: 1
---

# Error Handling

Gateway rejections are normalized as `GSwapSDKError`. Inspect `code` for
programmatic handling, `message` for the user-facing explanation, and
`chainMessage` for the original chain failure when a dispatch reached the
contract.

| Code | HTTP | Meaning | Typical response |
| --- | ---: | --- | --- |
| `METHOD_NOT_ALLOWED` | 403 | The gateway does not expose this contract method | Check the v2 method and SDK version |
| `SIGNATURE_INVALID` | 401 | Signature cannot be verified for the DTO | Check signer scheme and wallet version |
| `SIGNER_MISMATCH` | 403 | Recovered signer does not match the request identity | Use the signer’s matching `walletAddress` |
| `DTO_INVALID` | 400 | DTO shape or field validation failed | Check required fields and exactly-one unions |
| `BOUNDS_VIOLATION` | 400 | Numeric, tick, symbol, or range bounds failed | Align ticks to the pool spacing |
| `SYMBOL_CONFLICT` | 409 | A CreatePool symbol is already owned by another class | Reuse its registered symbol |
| `RATE_LIMITED` | 429 | The signer exceeded the gateway limit | Retry after 30 seconds; max 60 seconds |
| `CHAIN_DISPATCH_FAILED` | varies | The chain rejected a validly shaped request | Read `chainMessage` and fix the business condition |

```typescript
import { GSwapSDKError } from '@gala-chain/gswap-sdk';

try {
  await gSwap.swaps.swap('GALA', 'GUSDC', 3000, { exactIn: '100' });
} catch (error) {
  if (error instanceof GSwapSDKError && error.code === 'RATE_LIMITED') {
    console.log('Retry after the gateway cooldown');
  } else if (error instanceof GSwapSDKError) {
    console.error(error.code, error.chainMessage ?? error.message);
  }
}
```

Read failures and local validation failures can also throw `GSwapSDKError`.
Do not retry invalid DTOs or a rejected signature without changing the input.
