# Private FX follow preferences

Date: 2026-11-13

## Summary

User can persist ordered manual currency pairs and dismissal of the current default currency
pair without changing existing stock/channel resources or making cross-service writes.

## Changes

- Add authenticated bounded GET/PUT FX preference snapshots and CAS in a distinct key inside
  the existing store. Preserve old watchlist writers and resource versions.
- Validate at most12 unique supported nonidentity pairs, strict JSON and suppression context.
- Reuse shared read-time default composition so manual follows persist, USD adds no automatic
  pair, and unchanged currency saves cannot recreate a dismissed default pair.
- Keep absence distinct from corrupt state, preserve private/no-store responses and existing
  transaction bounds. No feed call, scheduler, migration, resource, capacity or dependency added.

## Validation

- 97 offline User tests including HTTP/auth, namespace/Owner isolation, order, duplicate/body
  limits, semantic suppression, concurrent CAS and unknown commit recovery.

- Root `npm run check` before commit.
- No production preference changes or online/native acceptance.
