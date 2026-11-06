# Allow cold sources and human review during Muse setup

Date: 2026-11-05

## Summary

A real Portfolio metadata request succeeded after 6.3 seconds while Hub had
already refused it at its four-second read timeout. Human review and remote
helper setup also outlasted the ten-minute pending OAuth request window.

## Changes

- Allow source response reads up to eight seconds within the existing
  twelve-second discovery validation deadline. Keep shorter connection, write,
  pool and credential limits, joined workers and metadata response budgets.
- Give new pending OAuth requests thirty minutes and use that same duration for
  the browser-bound HttpOnly flow cookie and shipped consent bridge. Existing requests keep their expiry;
  authorization-code, access-token, grant and encrypted handoff limits stay intact.
- Emit only the existing closed source refusal diagnostics even when the MCP SDK
  sets the root logging level to CRITICAL. Request bodies and SDK logging remain
  suppressed.

## Validation

- Simulated cold producer response and read/deadline limits; closed diagnostic
  canaries under CRITICAL root logging; pending review expiry and cookie binding;
  actual browser distribution remains usable after fifteen minutes and expires at thirty.
- `npm run check`.
