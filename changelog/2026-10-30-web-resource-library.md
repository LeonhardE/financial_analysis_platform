# Unified owner resource library

Date: 2026-10-30

## Summary

Resources now groups encrypted CSV holdings, the existing Market watchlist and manual YouTube
creator lists in one Web view, with current source discovery and clear unavailable states.

## Changes

- Add three resource types, filters, source versions and read-only watchlist details with a Market
  management link. Preserve the shared holdings Passkey session and existing import controls.
- Add manual creator add/edit/remove through User's existing revision-checked list endpoint;
  validate locators and UTF-8 sizes before requesting tokens and require reload after uncertain
  writes or conflicts. List text remains in User's existing plaintext domain, with explicit UI copy.
- Reuse the fixed Hub owner catalogue without claiming discovery grants agent authority or prepares
  encrypted evidence. Expose an optional metadata-only, owner-fenced task-editor callback.
- Bound reads and refresh them on return, hide stale rows on account changes/logout, isolate drafts,
  and retain existing historical evidence. No backend, cloud configuration or resource changes.

## Validation

- Synthetic contract, owner/session/body-race, CAS/conflict, route-budget and bilingual rendering
  tests, plus existing CSV/Passkey and Inbox regression coverage.
- Root `npm run check` and Web production build (results recorded before commit).
