# Persistent content and operation-proof contracts

Date: 2026-11-07

## Summary

Add an opt-in shared contract for Root-approved task/resource deliveries, Agent
reports, exact signed requests and frozen Run inputs, independent of legacy
short-lived task grants. No service or Web consumer is enabled.

## Changes

- Define closed contexts with explicit task output policy, independent resource
  permission epochs and exact Run/result bindings; domain-separate new encrypted
  content while leaving all existing P1 contracts and primitives unchanged.
- Authenticate canonical context and complete ciphertext digest with ES256, using
  standard ECDH-ES+A256KW/A256GCM for Agent and owner recipients.
- Separate current publication/Agent verification from issuance-only owner history,
  and return detached integrity snapshots instead of content/Run capabilities.
- Add fixed method/path/body Agent request proofs and bounded immutable manifest
  validation; replay/CAS, source and current policy enforcement remain consumers' work.
- Add public Node interoperability vectors without private JWKs and synthetic
  cross-language encryption/signature, isolation and tamper regression checks.
- Limit scanner false-positive exceptions to the two exact public wrapped-key
  ciphertext lines in that fixture; all other files, values and rules stay active.

## Validation

- Focused persistent-content and live Python/Node interoperability suites.
- Full root `npm run check` and packaged schema/wheel checks before delivery.
