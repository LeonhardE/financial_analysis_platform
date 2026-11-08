# Remove operator deployment identities from public repository artifacts

Date: 2026-11-08

## Summary

Public infrastructure examples, regression fixtures and historical reports contained identifiers
from a developer deployment. They now use consistent synthetic aliases, while live verification
tools require explicit validated instance selection instead of a developer-project fallback.

## Changes

- Replace project IDs/numbers, instance UUIDs and image digests in repository fixtures; recompute
  the dependent Portfolio trust fixture hashes. Historical reports explicitly disclose their
  pseudonymization and retain regression outcomes and tested source hashes.
- Require explicit project/region selection for isolated ownership verification and bind cleanup
  to that selected target plus the existing UID/account checks. Runtime-account deletion also
  waits for verified service absence, so a refused service cleanup cannot disrupt its identity. The historical read-only Market
  adoption tool requires a closed instance file and rejects unsupported catalogs before auth.
- Remove optional personal package metadata, correct obsolete rollout/runner descriptions and
  archive the obsolete instance-specific Hub image candidate privately. Document private evidence
  handling. Preserve supported legacy protocols, regression helpers,
  repository ownership and third-party license notices.
- Add repository CI checks for synthetic public fixture references and provenance labels. No
  service application, deployed instance input, cloud resource or Git history is changed.

## Validation

- Focused verifier and public fixture regression suites.
- Root `npm run check`, including complete-history/index/worktree credential scanning.
- Pinned Terraform offline validation and provider-mocked ownership tests.

The audit found deployment metadata exposure; the credential scan reported no findings. This
change removes that metadata from the current tree, not earlier Git commits. No live cloud
verification or mutation was performed.
