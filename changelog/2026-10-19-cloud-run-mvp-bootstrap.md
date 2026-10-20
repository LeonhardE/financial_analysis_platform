# Prepare the mock MVP for Cloud Run deployment

Date: 2026-10-19

## Summary

Make the existing mock market dashboard deployable as separate Next.js and FastAPI Cloud Run
services, with image builds invoked from Google Cloud Console and publication controlled separately.

## Changes

- Add root-context Dockerfiles with non-root runtime users and Cloud Run-compatible port binding.
- Require the frontend API origin at image build time; exclude local environment files and local
  development material from Docker build contexts.
- Add separate Cloud Build configurations that build and push uniquely tagged API and web images
  to a regional Artifact Registry repository without automatically deploying either service.
- Configure API CORS origins through a comma-separated runtime variable, preserving existing
  localhost defaults when omitted.
- Document deployment prerequisites and exempt changes confined to `local-docs/` from changelog
  requirements in the repository rules and change-record convention. Mixed changes record only
  material changes outside `local-docs/`.

## Validation

- Frontend production build passed with an explicit HTTPS API origin; the generated browser
  bundle contains that origin. Build-argument validation rejected empty, path-bearing,
  trailing-slash, and non-local HTTP origins.
- API smoke checks passed for health, stock lists, candles, unknown symbols, allowed/disallowed
  origins, comma-separated origins, local defaults, and GET preflight behavior.
- `npm run check` and `git diff --check` passed. Dockerfile paths, workspace context, image
  references, Cloud Build substitutions, and configuration consistency were reviewed.
- Docker is unavailable locally, so full Linux container builds and startup must be validated
  by Cloud Build and Cloud Run. No cloud resources, billing changes, or deployment were performed.
