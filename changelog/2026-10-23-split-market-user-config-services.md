# Split Market, User, and Config into independently deployable services

Date: 2026-10-23

## Summary

The combined backend now has three service boundaries: public Market data, verified User identity and
stock watchlists, and private Config preferences. The new Market image no longer serves private
routes. A staged migration keeps the existing deployed combined revision running until User, Config,
and frontend routing are configured and verified.

## Changes

- Add independent User and Config apps, requirements, Docker images, health checks, and Cloud Build
  configurations. Keep the established Market service path and public endpoint contracts.
- Extract a small installable shared Python package for Firebase verification, HTTP privacy policy,
  stable UID ownership, bounded Firestore transactions, and public instrument identities. Services
  do not import another service's business modules.
- Move watchlists and preferences with their original Firestore collections, document IDs, schemas,
  local paths, and preference versions. New service-specific storage variables take precedence;
  legacy database variables remain migration fallbacks.
- Validate new saved symbols through a bounded Market HTTP search, with exact instrument matching,
  a four-second total deadline, a response-size limit, and no forwarded Firebase token. Listing,
  removal, and duplicate additions remain independent of Market availability.
- Route browser private requests explicitly to User or Config, validating service/path ownership
  before obtaining tokens. Optional build-time origins preserve legacy routing only when omitted;
  configured failures never reroute to Market.
- Gate all backend image deployments behind `_DEPLOY_SERVICE=false` for the migration. Re-enable
  each trigger only after Console setup and frontend cutover; preserve independent existing-service
  deployment guards and runtime configuration.
- Run backend tests in separate Python processes, extend CI to build/start all three backend images,
  and retain the existing performance benchmark's standalone shared-package imports.
- Document Console bootstrap, IAM, original-data continuity, path filters, phased cutover, rollback,
  and scale-to-zero cost controls. Ignore local environments and package artifacts for every service.

## Validation

- `npm run check`: passed (95 web, 4 shared, 77 Market, 46 User, 28 Config, and 26 deployment tests;
  276 total, plus type checks, Ruff and formatting).
- `npm run build:web`: passed with distinct Market/User/Config origins.
- Shared Python wheel built successfully; three isolated local HTTP services passed health and
  route-ownership/authentication-rejection smoke checks.
- Local production frontend loaded the public chart through the split Market origin; private
  routing/session isolation, actual User-to-Market HTTP transport, deadline and storage behavior are
  covered by regression tests without external credentials or billable upstream calls.
- Three backend Docker image build/start checks are included in PR CI. Live Firebase IAM, existing
  Firestore data, and production URL cutover require the documented Console acceptance steps.
