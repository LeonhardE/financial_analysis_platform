# Retire Hub browser and executor bridges

## Summary

Use the personal host-owned credential route as the Hub's only active Agent execution path, with historical Owner reads and narrowing controls retained.

## Changes

- Remove the fixed browser Agent runtime, key worker, IndexedDB profile, setup producer, identity recovery API and executor-specific ciphertext adapter. Old flags cannot reactivate these entry points.
- Distribute only the narrow first-party native account-link window and the private Agent client. Remove legacy helper/runtime assets from the production image; keep required historical format fixtures and notices in source.
- Stop mounting legacy financial OAuth/MCP, preparation and Run/report writing transports. Preserve authenticated Owner history and revocation controls.
- Require managed, current credentials at every production execution, native-plan and result writer factory. Keep original signed formats readable.
- Move an uncommitted legacy browser slot to a fresh logical connection on explicit Owner reauthorization; validate its historical pending locator and retire its parent atomically with the new credential, without inventing prior resource scope.
- Consolidate current runtime, transport and activation documentation around the existing Hub and personal host client.

## Validation

- Root `npm run check`.
- Real private-host/Hub crypto and immutable retry, native OAuth/MCP, SQLite and Firestore lifecycle/history, legacy-format interop, strict route closure and health independence tests.
- Interrupted legacy pairing, corrupt pending locator, current endpoint legacy-identity refusal, account bridge and timezone/policy boundary checks.
