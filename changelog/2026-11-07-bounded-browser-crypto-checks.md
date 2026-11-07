# Bound browser cross-language checks and deterministic tampering

Date: 2026-11-07

## Summary

Keep frontend cryptographic validation reliable during parallel checks. One local
full-suite run stopped indefinitely in an old synchronous Python stdin exchange;
the same independent validator passed immediately on an isolated retry.

## Changes

- Pass synthetic cross-language test vectors through a private temporary file,
  close stdin explicitly, bound subprocess time/output and remove each file afterward.
- Flip actual signature/ciphertext bytes in task rejection tests, so a random original
  suffix can never turn a supposed mutation into an unchanged valid object.
- Preserve the actual independent Python grant/preparation validators and existing
  browser rejection assertions. Product behavior, crypto and check coverage are unchanged.

## Validation

- Focused agent-consent and task cryptographic suites.
- Full repository `npm run check` before commit.
