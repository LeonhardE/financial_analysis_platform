# Read compact public authority history before enabling writes

Date: 2026-11-12

## Summary

Prepare Portfolio readers for canonical UTF-8 registry-history bytes in the same existing
unindexed authority field, retaining legacy array writes until compatible readers are deployed.

## Changes

- Restore exact bounded arrays before existing root, signature, source and fence verification.
- Reject malformed, noncanonical and oversized bytes and byte histories in other collections.
- Preserve APIs, signed history, all budgets and existing cloud configuration/resources.

## Validation

- Actual Firestore SDK/RPC tests cover equivalent metadata reads and encrypted snapshot writes,
  exact history retention, malformed/oversized data, complete document bounds and tampered signatures.
- Run complete repository checks before committing.
