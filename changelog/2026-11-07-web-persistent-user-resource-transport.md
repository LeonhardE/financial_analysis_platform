# Synchronize persistent User resources through the correct transport

Date: 2026-11-07

## Summary

Allow approved watchlist and followed-channel versions to synchronize through the
existing ordinary User owner API. The persistent workspace had supplied an
extra encrypted-service header, which AuthProvider correctly rejected.

## Changes

- Add the encrypted contract header only for Hub and Portfolio requests.
- Preserve User admission rules and all owner/session fencing.
- Exercise both User resource kinds through the actual AuthProvider boundary;
  verify that direct unsupported-header requests still fail before transport.

## Validation

- Focused real AuthProvider / persistent workspace synchronization regression.
- Full repository `npm run check` before commit.
