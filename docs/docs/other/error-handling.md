---
sidebar_position: 1
---

# Error Handling

Gateway rejections are normalized as `GSwapSDKError`. Inspect `code` for
programmatic handling, `message` for the user-facing explanation, and
`chainMessage` for the original chain failure when a dispatch reached the
contract.

| Code                    |   HTTP | Meaning                                                                           | Typical response                                                               |
| ----------------------- | -----: | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `METHOD_NOT_ALLOWED`    |    403 | The gateway does not expose this contract method                                  | Check the v2 method and SDK version                                            |
| `SIGNATURE_INVALID`     |    401 | Signature cannot be verified for the DTO                                          | Check signer scheme and wallet version                                         |
| `SIGNER_MISMATCH`       |    403 | Recovered signer does not match an actor explicitly named by a contract operation | Check the operation's actor identity; this does not apply to v2 DEX operations |
| `DTO_INVALID`           |    400 | DTO shape or field validation failed                                              | Check required fields and exactly-one unions                                   |
| `BOUNDS_VIOLATION`      |    400 | Numeric, tick, symbol, or range bounds failed                                     | Align ticks to the pool spacing                                                |
| `SYMBOL_CONFLICT`       |    409 | A CreatePool symbol is already owned by another class                             | Reuse its registered symbol                                                    |
| `RATE_LIMITED`          |    429 | The recovered signer exceeded the 30-write / 60-second sliding-window limit       | Do not auto-retry; wait for `error.retryAfterMs` when present                  |
| `CHAIN_DISPATCH_FAILED` | varies | The chain rejected a validly shaped request                                       | Read `chainMessage` and fix the business condition                             |

```typescript
import { GSwapSDKError } from '@gala-chain/gswap-sdk';

try {
  await gSwap.swaps.swap('GALA', 'GUSDC', 3000, { exactIn: '100' });
} catch (error) {
  if (error instanceof GSwapSDKError && error.code === 'RATE_LIMITED') {
    console.log(`Retry after ${error.retryAfterMs ?? 60_000} ms`);
  } else if (error instanceof GSwapSDKError) {
    console.error(error.code, error.chainMessage ?? error.message);
  }
}
```

Read failures and local validation failures can also throw `GSwapSDKError`.
Do not retry invalid DTOs or a rejected signature without changing the input.

The write limiter allows 30 writes per recovered signer in a sliding 60-second
window, matching `signer-rate-limiter.ts` in the defi-backend. The SDK does not
automatically retry writes. Honor the server's `Retry-After` header through
`error.retryAfterMs`; if it is absent, wait for the window to pass before trying
again with the same intent.

`SIGNER_MISMATCH` is only relevant to contract operations that explicitly name
an actor, such as a token or fee operation. The v2 DEX operations have no
`signerField`: their identity is the signer recovered from the signature.
`X-Wallet-Address` is an attribution hint, not an identity assertion.
