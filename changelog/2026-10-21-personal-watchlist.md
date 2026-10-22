# Private personal watchlists

Date: 2026-10-21

## Summary

Signed-in users can save stocks to a personal watchlist and return to them across sessions and
devices. Anonymous stock browsing, search, and the default indices and Magnificent Seven remain
available.

## Changes

- Add authenticated list, add, and remove endpoints with server-verified Firebase user ownership,
  idempotent updates, a transactional 50-item limit, and private responses marked `no-store`.
- Store one bounded document per user in the existing Firestore database in Cloud Run, with SQLite
  persistence for local development. Saving a stock does not fetch prices or start polling.
- Add watchlist rows, chart selection, save/remove actions, and loading, empty, limit, and retry
  states. Hide private data immediately during logout or account changes, and reject stale requests.
- Keep authentication credentials in the Firebase SDK and send fresh tokens only to the permitted
  private API paths.

## Validation

- `npm run check`: web, backend, and infrastructure tests, types, lint, and formatting pass.
- `npm run build:web`: production frontend build passes.
- Local browser checks with Firebase Auth Emulator and two synthetic accounts cover adding,
  removing, refresh persistence, logout visibility, and account isolation. A 390-pixel viewport has
  no horizontal overflow.
- Production Firestore and Google sign-in acceptance remain deployment checks after the PR merges.
