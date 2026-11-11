# Retire independent Agent deployment selection

## Summary

Stop the deployment compiler from generating the retired Policy/Executor Web selection; personal Agent credentials use the existing Web and Hub settings.

## Changes

- Refuse preparation-only profile v5 and independent Agent environment fields before artifact generation or cloud access.
- Keep v1–v4 profiles and their six-field Web Owner projection unchanged. Retain the old public schemas as frozen historical specifications.
- Remove obsolete projection behavior and its executor-trust fixture dependency; add refusal checks with fresh caller-supplied digests.

## Validation

- Root `npm run check`.
- Existing deployment profile, Web Owner configuration, input pinning and retired-projection tests.
