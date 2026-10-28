# Explicit deployment profile foundation

Date: 2026-10-27

## Summary

Deployment-instance inputs can be validated and rendered into reviewable offline candidates without
selecting the original deployer's production account or changing the existing live pipeline.

## Changes

- Add a closed, bounded deployment profile loader, public schema and synthetic example.
- Cross-check project/region/source/image/state/Firebase/target/adoption bindings and explicit stages.
- Render existing pipeline-v2, bootstrap-variable and Web-substitution shapes with a configuration
  manifest into a new private output directory; never overwrite or auto-activate consumers.
- Document remaining per-target configuration migration and fresh-install work, retaining existing
  source, identity, digest, saved-plan and approval checks.

## Validation

- Offline tests cover two independent synthetic profiles, actual policy-validator compatibility,
  malformed/secret/mixed configuration rejection, immutable outputs, byte hashes and permissions.
- No cloud resources, credentials, Terraform execution, production policy or service configuration
  are changed by this foundation.
