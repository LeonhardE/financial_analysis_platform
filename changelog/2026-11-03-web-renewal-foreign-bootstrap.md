# Preserve unrelated bootstrap during vault key renewal

Date: 2026-11-03

## Summary

Allow renewal of the current vault when the browser also retains an unfinished bootstrap for a different vault under the same account.

## Changes

- Preserve the unrelated sealed bootstrap without treating it as a current-vault renewal blocker. A server account with an existing vault rejects a different bootstrap.
- Continue blocking matching-vault, registration, identity-mismatched, and other unresolved encrypted operations.

## Validation

- Run the vault key renewal storage tests and the repository check.
