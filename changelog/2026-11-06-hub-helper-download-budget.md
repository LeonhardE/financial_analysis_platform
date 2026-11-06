# Allow bounded slow helper downloads

Date: 2026-11-06

## Summary

The foreground helper's public Worker download now has a sixty-second budget. Real Muse
downloads took about forty-six seconds, exceeding the previous ten-second limit before any
agent keys or authenticated transport could be initialized.

## Changes

- Give only the 1.3.0 public Worker bootstrap download a separate bounded deadline.
- Preserve the fixed origin/path, omitted credentials, two-MiB response limit and pinned SHA256
  verification before creating a Worker. Explicit lock still cancels immediately.
- Keep authenticated API request budgets, grant lifetimes and Worker bytes unchanged.

## Validation

- Actual pinned Worker initialization after a simulated forty-six-second transfer; exact
  deadline cancellation, explicit lock, oversized responses and integrity rejection.
- Reproducible helper build and unchanged Worker fingerprints.
- `npm run check`.
