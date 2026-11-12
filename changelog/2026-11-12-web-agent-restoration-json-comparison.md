# Restore Agent authorization across JSON property order

Date: 2026-11-12

## Summary

Agent reauthorization can now review the original approved scope when current
descriptors and retained history contain identical JSON fields in different orders.

## Changes

- Compare Owner controller JSON by exact nested values and field sets rather than
  serialized object property order. Keep array order significant.
- Preserve generation, credential, binding, permission and review-change checks;
  changed values, missing fields and additional fields still stop restoration.
- Add regressions for the Hub's directly constructed head versus canonically
  sorted history, and reordered versus changed nested authorization reviews.

## Validation

- Both new regression cases fail before the fix and pass afterward.
- Targeted Web controller, Owner credential and persistent workspace tests.
- Repository `npm run check` and exact-head CI before merge.
