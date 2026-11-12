# Recover interrupted publications after directory advancement

Date: 2026-11-12

## Summary

An interrupted authorization can resume after another Agent connection advances the signed key directory. The Web client first reconciles the original publication receipt; an unapplied publication tied to an older directory can then be preserved and rebuilt through the existing permission restoration flow.

## Changes

- Require an absent original receipt, a valid current credential, and Worker verification of the original Root-signed publication against its historical directory before retiring a superseded pending publication.
- Bind reconciliation to the exact operation and fingerprint. Unknown receipt outcomes, changed local records, invalid bindings, and current-directory publications retain their original pending records.
- Archive the sealed original and clear its exact pending record in one cancellable transaction. Compare the entire encrypted record so another tab's replacement ciphertext cannot be removed, even when it reuses an operation ID.
- Continue normal restoration from verified current permissions without issuing another credential or relaxing publication freshness and directory checks.

## Validation

- Controller receipt precedence and unknown-outcome tests; real Worker verification of historical publications, credential state, and tampering.
- Browser storage integration covers encrypted archive preservation, same-operation replacement conflicts, account binding, and cancellation rollback.
- Web type checking and repository checks.
