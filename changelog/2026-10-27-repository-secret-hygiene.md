# Required repository secret scanning and local credential hygiene

Date: 2026-10-27

## Summary

Keep operator credentials and local deployment configuration out of source and
Docker inputs, and require a reproducible secret scan before commits and in CI.
This foundation changes repository tooling only; it does not provision cloud
resources or change an application's runtime behavior.

## Changes

- Ignore root/nested environment files, named credential JSON, private key files
  and local deployment profiles while preserving public examples and source JSON.
- Pin Gitleaks 8.30.1 and verify official release archive and executable hashes
  on Linux/macOS x64/arm64, including cached binaries before every execution.
- Scan complete locally reachable history, staged blobs and current source with
  failure on incomplete coverage; expose only rule/location metadata and remove
  temporary redacted reports. Require the scan in `npm run check`, pre-commit and
  CI without a licensed scanner Action.
- Scope public Firebase Web configuration and existing public encrypted test
  vectors to exact rule/path/value or named-line exceptions; keep unknown keys
  and private key detection active in the same files.
- Isolate temporary Git fixtures from inherited hook repository/index/config
  state and verify parent configuration, index and refs remain unchanged.

## Validation

- All 88 CI tooling tests pass, including 16 scanner/integrity/isolation cases
  with the real checksum-verified executable and no skips.
- Actual complete-history/index/worktree scan returns zero findings; changed
  Python tooling passes Ruff lint/format and changed documents/config pass Prettier.
- Scanner integrity and synthetic integration tests cover checksum tampering,
  historical/staged/untracked secrets, forced staged ignored files, inline
  bypass attempts, precise public exceptions and failure/redaction behavior.
- Real Git fixture regression verifies hook environment isolation.
- Required CI runs the pinned scanner and integration cases on full history.
