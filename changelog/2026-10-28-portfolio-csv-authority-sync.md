# Portfolio authority synchronization for encrypted CSV imports

Date: 2026-10-28

## Summary

An authenticated owner can explicitly synchronize a holdings source's public authority from the
configured Hub before uploading an encrypted snapshot. Requests cannot install their own roots.

## Changes

- Add the closed owner synchronization route and fixed HTTPS Hub client, requiring both runtime
  workload identity and Hub's existing narrow catalogue delegation at the producer.
- Bind the response to the verified owner and exact source, validate signed directory history, and
  preserve root/vault/incarnation, local source epochs, locks, monotonic history and transaction CAS.
- Make identical projections no-ops without rewriting stored ciphertext or original receipts.
- Keep bounded transport, no redirects/proxies/compression, exact response budgets and fixed errors.
  Missing configuration stays closed; no brokerage login, cloud resource, IAM or database change.

## Validation

- All 74 Portfolio tests pass, covering initial history, no-op replication, owner/source/root
  substitution, rollback, locked/fenced sources, invalid writers/recipients and original receipts.
- Exercise fixed two-credential HTTP transport, unsupported configuration, redirects, failures,
  oversized/misbound responses, total deadlines and the owner-only HTTP body boundary.
- Independent review found no remaining material issues. Full root `npm run check` passed on the
  merged Hub producer foundation; actual cloud trust and release activation remain outside this change.
