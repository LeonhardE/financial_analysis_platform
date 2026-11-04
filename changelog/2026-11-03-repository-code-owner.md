# Assign a single repository code owner

Date: 2026-11-03

## Summary

Assign LeonhardE as the sole code owner for every path in the repository, including the CODEOWNERS file.

## Changes

- Add `.github/CODEOWNERS` with a single repository-wide ownership rule.
- Required owner approval and administrator bypass remain GitHub branch protection settings.

## Validation

- Reviewed the single ownership rule; `npm run check` passed.
