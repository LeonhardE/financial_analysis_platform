# Clear previous connection review inputs on reconnect

Date: 2026-11-06

## Summary

A new request in an already unlocked Agent page now gets fresh consent-card inputs. Previously
pasted helper public keys, copy notices and local discard confirmations cannot remain visible
when the request or its bridge nonce changes.

## Changes

- Give the consent card a request-and-nonce identity. Recreate only that card on a new handoff;
  the shared library workspace, in-memory Worker and encrypted pending records are retained.

## Validation

- Root `npm run check` passes, including the bridge, consent-controller and existing UI tests.
