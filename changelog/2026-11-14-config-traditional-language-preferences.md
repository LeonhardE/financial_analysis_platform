# Add an independent account language preference

Date: 2026-11-14

## Summary

Provide account-persisted Traditional Chinese selection without changing the frozen v1 UI
preference contract or allowing older complete-document saves to erase a newer language choice.

## Changes

- Add authenticated GET/PUT `/api/v2/preferences/language` for English, Simplified Chinese
  and Traditional Chinese (`en`, `zh`, `zh-Hant`).
- Use an independent version-fenced namespace in the existing preference storage; absence is
  read-only and inherits the legacy language in supporting consumers.
- Preserve strict body bounds, ownership, no-store responses, bounded Firestore operations,
  conflict handling and fail-closed treatment of malformed data.
- Keep the original UI/currency contracts and saved records unchanged; no migration or
  infrastructure is introduced. The Web consumer follows in its own release.

## Validation

- Config service: 44 tests passed, including language persistence/isolation, concurrent CAS,
  legacy and currency compatibility, malformed records, actual auth/private HTTP, request bounds
  and unknown-commit recovery.
- Full root `npm run check` is enforced by the pre-commit gate.
