# Explicit independent Policy authority bindings

Date: 2026-11-09

## Summary

Prepare the independent Policy deployment to consume reviewed public Owner,
native client and executor identity references without enabling authority by default.

## Changes

- Add optional public-only domain configuration with exact origins/callbacks,
  distinct Root/Policy keys, fixed KMS/witness/snapshot references and a public PKCE client.
- Bind only Policy runtime signing/decrypt, named witness CAS, immutable snapshot
  get/create and exact Firebase user lookup. Grant the reviewed independent
  executor creator Encrypt-only on the recovery key; executor runtime gets no KMS access.
- Keep omitted bindings inert. Issuance, key release and public invocation require
  separate explicit selections. Root bootstrap, attested enrollment, independent
  plan/apply approval and live IAM/recovery acceptance remain separate operations.

## Validation

- Terraform validation and 28 full provider-mocked plans, without cloud credentials or apply.
- Repository `npm run check` through the required pre-commit hook.
