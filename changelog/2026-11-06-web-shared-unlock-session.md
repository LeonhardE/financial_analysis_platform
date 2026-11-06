# Preserve page unlock during automatic sign-in refresh

Date: 2026-11-06

## Summary

Automatic Firebase token refresh for the already verified SDK user keeps the current owner
session. Moving between Resources, Tasks, Agents and Inbox in the persistent workspace no
longer loses the shared vault unlock merely because the login credential rotates.

## Changes

- Continue verifying the refreshed account with the User service while retaining the same
  owner session and its in-flight private requests and consent bridge responses.
- Clear the retained session when verification fails or times out. Explicit account retry,
  a different SDK user, sign-out and observer errors still invalidate the previous identity.
- Keep obtaining current SDK credentials per request. Vault keys remain in the existing
  memory Worker; new tabs, reloads, explicit locking and separate recipient approval retain
  their existing boundaries.

## Validation

- AuthProvider regression tests cover refresh during ordinary requests and consent,
  replacement SDK identity, failed verification, timeout, explicit retry and late success
  after a private API rejection.
- `npm run check`.
- `npm run build:web`.
