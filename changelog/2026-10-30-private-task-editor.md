# Private task editor

Date: 2026-10-30

## Summary

Add an encrypted task editor using the existing owner resource catalogue, Passkey library and
Hub task contracts. Markets remains the default workspace view.

## Changes

- Edit and preview brief/custom tasks, resources, output sections and private delivery expectations.
- Seal incomplete local drafts with cross-tab CAS; retain exact ciphertext operations for explicit recovery.
- Confirm rule, source scope, key epoch and recipient changes; verify immutable history and current
  heads, with explicit conflict rebase and signed pause/resume/archive.
- Preserve lock/logout/account isolation. Resource handoff carries only an owner-scoped reference;
  task handoff copies only a task ID and creates no external schedule.
- Keep unreviewed drafts during transitions and original-operation replay; deletion requires a
  reviewed save association or explicit revision-checked discard.
- Keep all changes within the Web target; no cloud or service configuration changes.

## Validation

Targeted real WebCrypto, Node/Python interoperability, IndexedDB transaction, controller/session,
UI escaping/localization and navigation checks; production build and root checks before commit.
