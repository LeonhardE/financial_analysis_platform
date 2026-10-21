# Add optional Google sign in with verified API identity

Date: 2026-10-20

## Summary

Users can sign in with Google once Firebase is configured, while market browsing stays public.
The fixed seven-stock overview is now labelled as public market data rather than a personal watchlist.
Personal watchlists, stock search, three-index coverage and YouTube features remain future work.

## Changes

- Add Firebase popup sign-in, SDK-managed sessions, verified profile display, sign-out, retry states,
  and protection against stale verification responses after account changes or sign-out.
- Add `GET /api/v1/me`, verifying Google-provider Firebase ID tokens against an explicit project and
  checking revocation and disabled/deleted users. Invalid tokens return 401, unavailable authentication
  returns 503, and identity responses use `Cache-Control: no-store`.
- Keep health and mock market endpoints public and independent of Firebase configuration. Missing
  frontend Firebase configuration preserves browsing and explains that sign-in is unavailable.
- Support the official local Auth emulator with frontend development/loopback restrictions and an
  API guard that refuses emulator configuration on Cloud Run.
- Add four public Firebase build substitutions and Docker arguments. Reject partial Docker build
  configuration and use Node 24 for the current Firebase SDK. Document API runtime identity setup,
  the Firebase Authentication Viewer role, and the absence of any service-account key requirement.
- Add authentication and session race tests to `npm run check`, ignore local API environment files,
  update Next.js and affected transitive dependencies, and pin a patched gRPC override for Firebase's
  otherwise unused Firestore dependency. No user database or paid data subscription is introduced.

## Validation

- `npm run check`: frontend types, three session race tests, sixteen API authentication tests, Ruff,
  and repository formatting pass.
- `npm run build:web`: production build passes with Firebase unset and with complete public config.
- Official local Auth emulator: a synthetic Google session verifies through the API, survives page
  refresh, signs out, and leaves public market browsing available. Temporary QA route removed.
- Production build without Firebase: anonymous stock switching and charts verified in the browser.
  Header fits a 390px viewport without horizontal overflow.
- Dependency audit reports zero vulnerabilities after the patched override.
- The Firebase project and runtime/build settings were configured through Console. Cloud Run image
  builds, new revisions and the real Google popup still need production acceptance. Docker images
  were not built locally.
