# Followed FX and balanced Market layout

Date: 2026-11-14

## Summary

Market now shows followed exchange rates below the radar. Desktop cards match the quote panel's
height; smaller screens stack them with bounded, independent list scrolling.

## Changes

- Combine retained manual follows with the confirmed USD/default pair, respecting dismissal and
  default-context changes. Store follows through the existing User CAS API; recover uncertain
  writes and rebase conflicts without erasing other-device changes.
- Reuse confirmed account memory across navigation and revalidate expired metadata in the
  background. Keep loading, missing, stale and failed states distinct. Display-only currency
  refresh cannot retry an uncertain setting write.
- Read FX independently of stocks with a small bounded reader and exact daily-reference route
  checks. Send only currency pairs to Market, retaining source dates and attribution. Individual
  stock quotes keep native currency; no private crypto bundle is needed for the public FX view.
- Keep radar controls and FX source footer visible, eliminate nested watchlist scroll, support
  keyboard scrolling and reduced motion, and preserve the existing quick symbol picker.

## Validation

- Synthetic default/dismissal/manual-follow, CAS/lost-ACK/conflict, account transition, background
  revalidation, timeout/cancellation, exact FX route and transport/privacy tests.
- Actual-shell layouts with synthetic hooks/navigation/chart: English/light and Chinese/dark,
  50 watchlist entries,12 FX pairs,320/736/1024/1280 widths, expanded details and keyboard list end.
  Desktop panel heights match and pages have no horizontal overflow. This is local layout QA.
- Production Web build and normal root repository checks before commit. No online/native or
  production performance acceptance, new resource, capacity change or quota increase.
