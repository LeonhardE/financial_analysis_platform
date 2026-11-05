# Restore native Chrome requests in Muse consent and helper pages

Date: 2026-11-04

## Summary

Real Muse OAuth reached FolioView, but checking its request failed before sending HTTP.
Chrome rejects a native `fetch` call whose receiver is a consent bridge or controller instance.

## Changes

- Invoke injected/default fetch through a detached callback in consent and both supported
  controller releases, preserving fixed routes, headers, credentials and request bounds.
- Rebuild the shipped browser assets and integrity manifests without changing either Worker
  digest or the independently reviewed Web release pins.
- Make consent and complete controller HTTP regressions enforce the native receiver contract.

## Validation

- Actual Chrome synthetic loopback probe: member invocation throws `Illegal invocation`,
  detached invocation returns 200. No account data or credentials are used by the probe.
- Regression fails against the old shipped consent bundle and passes after rebuilding.
- Actual built 1.2.0/1.3.0 controllers fetch and verify pinned Worker bytes in Chrome;
  the synthetic probe stops before Worker creation or private-key operations.
- Full root `npm run check`, helper build and unchanged legacy/current Worker digests.
- Real Muse task/resource consent and encrypted analysis acceptance remain separate.
