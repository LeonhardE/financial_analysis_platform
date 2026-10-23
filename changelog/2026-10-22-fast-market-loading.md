# Serve available market snapshots before refreshing upstream data

Date: 2026-10-22

## Summary

Expired public snapshots previously waited for a Yahoo refresh before returning usable prices.
The workspace now shows genuine dated cached prices while an ordinary request refreshes them.
Reduce API startup work and frontend deployment files without adding always-on resources.

## Changes

- Add read-only `cached=true` probes for overview and every chart range: a bounded-age snapshot
  with `refreshRequired`, or bodyless 204. Probes never download, resolve symbols, write data,
  or reserve upstream budget; original source timestamps and stale labels are preserved.
- Start both cache probes together. Coordinate the overlapping default 1M refresh with the
  overview, then re-probe once to reuse its work. Keep existing leases/rate limits and use an
  ordinary browser request for refresh, not post-response server background work.
- Retain useful prices during refresh failures, show recoverable warnings, and protect symbol,
  range, retry, and response-body ownership. Search and private data use separate request paths.
- Load yfinance only for downloads/search. Run the web container from Next.js standalone output
  instead of copying all dependencies and build files.
- Add an offline mechanism benchmark and opt-in local first-chart timing. Validate stacked PRs
  with the existing CI checks; production triggers and cloud scaling settings remain unchanged.

## Validation

- Root `npm run check`, production frontend build, and isolated standalone server smoke test.
- Regression tests cover fresh/stale/missing snapshots, range isolation, no upstream cache-probe
  calls, both late-response phases, retry ownership, and chart visibility during overview refresh.
- Repeatable local benchmark: API startup median 634 ms versus a simulated eager-yfinance
  baseline of 875 ms (three fresh processes each). A simulated 2-second upstream refresh took
  2,017 ms; stale overview/chart probes took 0.194/0.174 ms with zero upstream calls.
- Local production browser timing: first populated chart painted at 257 ms from navigation
  while a synthetic eight-second upstream refresh was still pending. This is localhost with
  seeded cached data, not an empty-cache or Cloud Run cold-start measurement.
- Standalone runtime plus static assets occupied about 51 MiB locally; the original full
  dependency tree alone occupied about 569 MiB. This is file size, not a measured Docker image.
- No Docker daemon is available locally. The isolated traced server served the page and assets;
  Cloud Build remains the container-build verification after merge. Cloud scale-to-zero and
  first-ever empty-cache latency require post-deployment measurement; no 1–2 second SLA claimed.
