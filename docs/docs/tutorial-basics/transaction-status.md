---
sidebar_position: 6
---

# Transaction Status

V2 writes are synchronous. Each write returns a `SubmittedTransaction` with
the executed gateway result, a `uniqueKey`, and usually a `transactionId`.
There is no `PendingTransaction`, event socket, bundle ID, or `.wait()` API.

```typescript
const tx = await gSwap.swaps.swap('GALA', 'GUSDC', 3000, { exactIn: '10' });

console.log('Correlation key:', tx.uniqueKey);
console.log('Transaction ID:', tx.transactionId ?? '(not indexed yet)');
const indexed = await tx.confirm();
console.log('Indexed record:', indexed);
```

For a `Trade`, `confirm()` polls:

```text
GET {dexBackend}/explore/transaction?uniqueKey={uniqueKey}
```

While the data-sync indexer is catching up, this endpoint can return `404`.
That means “not indexed yet”, not that the synchronous chain write failed.
`confirm()` keeps polling according to the SDK's confirmation policy and
returns the indexed transaction when it appears.

Liquidity writes use the same `SubmittedTransaction` abstraction, but confirm
by re-reading the affected position because non-Trade chain responses may not
have a transaction index row. Use the canonical position identity:
`token0`, `token1`, `fee`, `owner`, `tickLower`, and `tickUpper`.

The chain response can legitimately contain an empty `transactionId`: the
gateway has accepted and executed the write, but the upstream response did not
yet provide an explorer ID. The DTO `uniqueKey` is the durable correlation
key, so applications should persist it rather than treating an empty ID as a
failure.
