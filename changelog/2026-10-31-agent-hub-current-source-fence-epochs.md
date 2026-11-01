# Project current source fence epochs in owner vault authority

Date: 2026-10-31

## Summary

Owner source responses and Portfolio authority now report the current Hub fence epoch after a
source invalidation. A successful source mutation no longer leaves the next authority read at
the immutable source-creation epoch.

## Changes

- Read validated source fences in the same transaction as the vault and signed registry for
  current, bootstrap/registry responses, source creation/replay and Portfolio authority.
- Preserve immutable creation anchors, vault/registry counters, existing response shapes and
  current owner authorization. Disconnected/deleted sources retain owner vault access while
  downstream source lifecycle restrictions remain in force.
- Reject corrupt fence state rather than publishing an initial-epoch fallback.
- Cover real FenceService mutations, persistent restart and immutable old acknowledgements,
  terminal/multiple sources, owner isolation and Firestore transaction retries.

## Validation

- Hub vault/fence/Firestore focused regression tests passed.
- Repository `npm run check` passed through the required pre-commit hook.
