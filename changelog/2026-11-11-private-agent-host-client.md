# Private Agent host client

Date: 2026-11-11

## Summary

Ship a reviewed Hub-owned client that retains personal Agent credentials locally,
verifies Owner pairing and processes approved ciphertext on the Agent host.

## Changes

- Add fixed, default-off, integrity-pinned standalone client distribution, with
  private local transactional storage and explicit prepare/activate recovery.
- Verify the Owner-encrypted Root anchor, signed lease, current registry/consent,
  frozen task/input and report recipient policy; retain original encrypted report
  bytes across process restarts and unknown write outcomes.
- Make legacy transport test time deterministic under host sleep/CPU contention;
  retain explicit expiry-boundary checks without changing production clocks.
- Bind Muse/ChatGPT plan statements to their preregistered provider while retaining
  the distinction between statements and actual provider scheduling acceptance.

## Validation

- Root `npm run check`.
- Generated host keys with independent Python Owner AES-GCM/JWS and real Hub
  transactions, Owner report decryption, fresh-process exact-ciphertext retry,
  expiry, wrong activation origin/Root/provider/phase, private file loss,
  corruption, permissions, symlink and load-only checks.
- No deployment or real-host/native-schedule acceptance; Node prerequisites and
  provider persistence remain explicit later validation gates.
