# Share one owner unlock across workspace documents

Date: 2026-11-07

## Summary

Resources, Tasks, Agent, Inbox and Settings reuse the same owner unlock, including page reloads and additional same-account tabs while the browser retains its memory session.

## Changes

- Run the existing closed crypto protocol in a same-origin SharedWorker across documents. Private keys and Passkey PRF outputs are never persisted or broadcast.
- Resume only after account verification and fresh vault, lifecycle and device checks. Publish only unlock/lock notifications, and retain explicit approval for new device rights.
- Lock all connected private views on locking, sign-out or account change, rejecting late crypto replies.
- Use bounded browser-supported reload lifetime; browsers without SharedWorker retain the dedicated per-document fallback. Closing the browser process ends the memory session.
- Show the shared unlock scope and a global lock action; remove repeat Passkey instructions from already unlocked write-access review.

## Validation

- Real cryptography through native MessageChannels covers page replacement, account isolation, PRF transfer, global locking and late replies.
- Workspace regressions cover initial resume, peer notifications, logout, account switch and explicit lock.
- Production build, isolated Chrome reload/multi-tab acceptance and full repository checks.
