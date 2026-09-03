# Production dependency audit

`npm audit --omit=dev` was run for the packed SDK dependency graph. Compatible
overrides address the reachable `bn.js`, `validator`, `ws`, and `yaml`
advisories. The native and personal-sign recovery tests, unit suite, and build
are the compatibility checks for these overrides.

The remaining `elliptic` advisory is transitive through `@gala-chain/api`'s
serialization/signature dependency. This SDK does not expose elliptic directly
or parse attacker-controlled elliptic input; native signatures are validated
against the fixed 130-hex-byte contract format before submission. It remains
until GalaChain publishes a compatible dependency update, at which point the
override graph and `npm audit --omit=dev` should be rerun.
