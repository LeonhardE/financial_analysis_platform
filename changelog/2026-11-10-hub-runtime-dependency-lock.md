# Pin the Hub runtime's reviewed shared dependency

Date: 2026-11-10

## Summary

Allow an additive shared-contract PR to merge independently of the Hub runtime.
The runtime validates its reviewed dependency rather than requiring the newest
repository copy of that dependency on every check.

## Changes

- Save the exact shared manifest during a Hub runtime build and include its hash
  in the runtime distribution manifest.
- Verify the locked manifest and supported contract version alongside every
  distributed file. A subsequent Hub build explicitly adopts a new dependency.
- Preserve runtime behavior, assets, protocol and default activation gates.

## Validation

- Root `npm run check`.
- Runtime distribution hashes and dependency-free isolated import.
