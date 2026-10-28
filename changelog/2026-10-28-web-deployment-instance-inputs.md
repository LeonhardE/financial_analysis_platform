# Explicit Web deployment instance inputs

Date: 2026-10-28

## Summary

Move Web's deployment-specific project, region, runtime identity, existing UID,
creation image and public browser build settings into the selected private
target-instance projection. This is a Web-only configuration consumer, without
new resources, UI changes, Firebase behavior changes or deployment execution.

## Changes

- Require exactly six validated Web Terraform deployment fields and derive
  imports, runtime identity and creation-only image from them. Keep the existing
  UID/public-mode/service-cap guards, native ignore/destroy protections, revision
  cap 12 and image/traffic ownership.
- Read all nine public Firebase/API build substitutions, runtime account,
  artifact repository and image-trigger UUID from the Web projection. Reject
  inconsistent context, extra public build keys and changed adopted trigger IDs.
- Opt only the Web catalog entry into the trigger-managed contract. Remove
  author region/repository YAML defaults while preserving existing trigger
  filters, source, public values and normal Web image deployment behavior.
- Document explicit private compilation and paired reviewed trigger migration.
  Frontend audit found only localhost development and existing API migration
  routing defaults, so application/UI source remains unchanged.

## Validation

- Native Terraform plan-only mock tests cover two synthetic projects/regions,
  the three retained identity/access/cost guards and six invalid-input cases.
- Source-only bootstrap composition exercises Web's actual build bindings and
  rejects unexpected substitution keys or a mixed build region. Shared/Repo
  prerequisites are composed privately rather than bundled into this PR.
- All 11 Web root cases and all 23 composed foundation-file cases passed with
  native Terraform mock providers; formatting and local documentation links pass.
- No credentials, remote backend, GCP API calls, resources or database migration.
