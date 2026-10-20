# Default Cloud Run image builds to Toronto

Date: 2026-10-19

## Summary

Match the image build defaults to the Toronto Artifact Registry repository selected for the MVP.

## Changes

- Set `_REGION` to `northamerica-northeast2` in both Cloud Build configurations so API and web
  images default to the Toronto registry endpoint.
- Update the repository deployment instructions to name Toronto as the default region.

## Validation

- Both build configurations parse and use the same Toronto default.
- Deployment configuration and instructions were checked for stale Montreal defaults.
- `npm run check` and `git diff --check` passed.
- No cloud resources or runtime settings are changed by this repository update.
