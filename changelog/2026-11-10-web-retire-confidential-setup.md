# Remove unused confidential-executor owner ceremonies

Date: 2026-11-10

## Summary

Remove the unused standalone Policy and Confidential VM setup from the Web UI.
Users retain the existing Passkey unlock, Hub connections and encrypted reports.

## Changes

- Remove administrator key/certificate setup panels, public configuration route,
  Policy request forwarding and their unused Worker operations/controllers.
- Remove the Web dependency on the obsolete executor-trust distribution and the
  retired setup's tests/fixtures and configuration examples.
- Preserve Owner vault recovery, persistent consent/publication and historical
  Inbox decryption. Archive the old operator route in Git history.

## Validation

- Root `npm run check`.
- Web type checks and behavior suites for shared unlock, persistent publication,
  request boundaries and historical report decryption.
