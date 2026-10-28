# Portfolio source lifecycle and metadata producer

Date: 2026-10-28

## Summary

Owner-signed source controls now persist a local revocation fence before accepting subsequent
uploads. Pending mutations survive restart and can be recovered without pretending Hub revocation
has completed. Portfolio also provides explicitly authenticated metadata-only source projections.

## Changes

- Reuse closed shared owner controls for fence, disconnect and logical deletion, with immutable
  operation identity, version CAS, monotonic source epochs and bounded retained mutation records.
- Keep ACK finalization behind an internal trusted adapter seam without any installed runtime
  caller; real Hub fence transport remains unimplemented. Authority replicas cannot reactivate a
  pending or terminal source. Disconnect retains authorized owner history; logical deletion hides
  history and retains a tombstone rather than claiming physical storage/backup purge.
- Preserve vault locks and current key/revocation checks. Bind retained ciphertext and receipts to
  their original owner/vault/resource/incarnation/version/epoch and distinguish historical head
  epochs from current eligible metadata. Old-epoch pointers are refused until a fresh upload.
- Add bounded Portfolio metadata endpoints using both Google workload identity and owner catalogue
  delegation, default-closed trust configuration, exact source references and formal private
  errors. Responses contain no ciphertext or keys and do not replace grants, manifests or agent
  content delivery. No broker collector, worker, shared contract, infrastructure or cloud changes.

## Validation

- Portfolio tests use fresh synthetic JOSE/RSA credentials, real SQLite transactions/restarts and
  actual Firestore SDK encoding/transaction retries against an in-memory RPC boundary.
- Cover owner/source isolation, signed controls, concurrent upload/fence ordering, retry/conflict,
  pending recovery, internal ACK matching, terminal capacity, vault lock, key rotation, historical
  binding corruption, dual-token metadata authorization and old-epoch projection refusal.
- Root `npm run check` passed on the completed security foundation, including all 62 Portfolio
  tests, secret scanning, repository lint/tests and formatting. This source delivery leaves
  Portfolio build-only and does not claim deployed broker connectivity, actual Hub ACK or agent
  decryption.
