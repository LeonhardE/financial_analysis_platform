# Deterministic encrypted archive rejection check

Date: 2026-11-07

## Summary

Make the archive ciphertext tampering check reliably exercise a modified ciphertext.

## Changes

- Flip an actual decoded ciphertext byte rather than replacing a random encoded suffix with a
  constant that can match its original value.
- Preserve the existing rejection assertion and all production encryption and unlock behavior.

## Validation

- Run the encrypted vault test suite and the repository's required `npm run check`.
