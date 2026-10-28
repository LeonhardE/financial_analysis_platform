# Instance-neutral infrastructure catalog

Date: 2026-10-28

## Summary

Finish the repository configuration cleanup after the separate target migrations. The checked-in
execution catalog registers protocol policy without selecting the original deployer's cloud
project, region, repository, buckets or identities.

## Changes

- Remove global instance defaults from `pipeline.json`; all six existing consumers require their
  explicit trigger-managed target projections, including disabled Portfolio.
- Mark uncreated Agent Hub as disabled `inactive-v1` static metadata. Reject normal execution and
  non-Hub or enabled use of this marker before credentials; retain its existing administrator-only
  preparation stages without requiring fictional adoption identities.
- Bind bootstrap catalog validation to neutral source registration and explicit configuration;
  keep the source preflight offline and retain legacy parser compatibility without production
  defaults or a downgrade path from the neutral catalog.
- Update general operator documentation and label bootstrap fixtures as offline test values.
  No service resource configuration, activation, IAM grant, database or cloud resource is changed.

## Validation

- 110 targeted Python projection, saved-plan and target-execution tests passed, including neutral
  production preflight, two synthetic project/region selections, inactive-target refusal and
  legacy downgrade refusal without cloud or Terraform calls.
- A source-only temporary copy passed pinned Terraform initialization with its backend disabled,
  validation and all 34 provider-mocked bootstrap runs. These cover Hub's unchanged
  `none`/`execution`/`service` preparation and disabled Portfolio's missing/cross-project
  configuration refusal. No live plan, apply or GCP API operation was performed by these checks.
- Credential-free registry preflight, scoped Ruff checks, Terraform/Markdown/JSON formatting and
  whitespace checks passed.
