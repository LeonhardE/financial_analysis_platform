# Isolate Terraform planning, approval and apply by target

Date: 2026-10-23

## Summary

Prepare independent service/client execution without adopting any production application resource.
Each activated target receives its own state bucket, plan/apply identities and approved saved-plan
workflow. Current service/client catalog entries remain disabled until separate adoption PRs.

## Changes

- Introduce a schema-2 catalog with explicit activation, canonical roots/backends/identities/triggers
  and exact configuration-controller registration. Validate it before cloud access and bootstrap.
- Add an administrator-only target execution module with private versioned state, per-target plan
  and recovery artifact access, main-only filtered planning and manual approval-required apply.
- Preserve existing repo resource addresses and state while narrowing artifact grants and plan
  filters. Bootstrap refuses inconsistent or premature activation; a local preflight also checks
  active root locks, symlinks and source files.
- Bind manifests to target bucket/prefix and recheck the downloaded saved binary before applying.
  Only the registered built-in controller from the reviewed shared module may be replaced; actual
  service destruction/replacement remains blocked.
- Support an explicitly requested, allowlisted controller repair during plan and bind it to producer
  metadata and the saved manifest. Apply still uses the exact reviewed plan without replanning.
- Document the administrator update, one-target activation and remaining consumer-specific grants.

## Validation

- Root `npm run check`, registry preflight and pinned Terraform contract/localhost suites.
- Python target isolation, cross-target provenance/backend rejection, destructive-plan rejection,
  binary revalidation and explicit controller-repair tests.
- Provider-mocked target execution module and inactive bootstrap contracts.
- No authenticated cloud plan/apply, resource import or business-service mutation performed.
