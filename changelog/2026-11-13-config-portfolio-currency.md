# Independent portfolio display-currency preferences

Date: 2026-11-13

## Summary

Config adds a separately versioned portfolio display-currency preference while preserving
existing language, appearance and chart settings and their strict v1 request contract.

## Changes

- Add an authenticated v2 currency snapshot and CAS writer in the existing storage namespace.
- Advance the write fence on every save while changing the semantic currency generation only
  when the currency changes. Old v1 saves cannot erase the new preference.
- Keep missing data distinct from corrupt state and resolve USD/en/light/1m at read time
  through shared contracts. Do not save defaults or write another service's FX follows.
- Preserve existing auth, body bounds, private response headers and transaction limits.
  No migration, cloud resource, capacity or dependency change.

## Validation

- Offline Config tests for real HTTP/auth, legacy compatibility, Owner isolation, concurrent
  writers, defaults, semantic generations, corrupt state and unknown commit recovery.
- Root `npm run check` before commit.
- No production preference changes or online/native acceptance.
