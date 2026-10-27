# Adopt the existing Config service

This target adopts only `config-api` in Toronto and its existing keyless
`fa-config-runtime` identity. User, Market and Web retain independent roots and
execution identities. Shared modules and application behavior are unchanged.

## Existing boundaries

- Service UID: `e4f50b70-600b-4aac-9530-4caa9de99944`.
- Runtime account unique ID: `115909004860419228588`.
- Preserve ingress `INGRESS_TRAFFIC_ALL`, `invokerIamDisabled=true` and the
  service-wide maximum of one instance. Config's own private endpoints continue
  to require Firebase authentication; public Cloud Run invocation is intentional.
- Preserve one request-billed vCPU, `256Mi`, port `8080`, timeout `60s`,
  concurrency `8`, revision minimum `0` / maximum `12`, startup CPU boost and all
  four existing environment values. These are adopted values, not cost tuning.
- The first controller apply normalizes equivalent CPU `1000m` to `1`; this may
  create a configuration revision while retaining the service UID, live image,
  release markers and traffic. The shared controller preserves unknown template
  fields, including the existing execution environment and startup probe.

The production root declaratively imports the existing service and runtime
account. Planning independently checks the service UID, invocation mode and
service-wide cap before any controller action. Native resources have deletion
protection / `prevent_destroy`; the service resource ignores later provider
updates. Desired configuration uses the guarded controller at
`module.config.terraform_data.configuration`, which reads the live image and
etag at execution time. The immutable image input is creation-only; editing it
is not a release. Image publishing and explicit revision traffic rollback retain
ownership through the existing pipeline.

Administrator `bootstrap/config.tf` adopts the existing `build-config-api`
trigger (`67b14a77-dd90-42d3-b61d-0f8993a41060`) and its `fa-build` deployment
and runtime attachment grants, preserving push filters and substitutions. It also
owns Config runtime's existing `roles/datastore.user` and
`roles/firebaseauth.viewer` grants without importing the shared database or user
data. Datastore User now uses the shared scope-only database condition and is
restricted to `projects/financial-analysis-512202/databases/(default)` at the
existing `google_project_iam_member.config_store` address. Firebase Auth Viewer
and every other Config permission remain unchanged. Additive IAM members never
replace a complete policy or binding.

The condition changes the provider's IAM membership identity and requires a
separate administrator migration, even though the Terraform address stays the
same. Follow [the database IAM migration runbook](DATABASE_IAM_MIGRATION.md)
before considering isolation active. Normal Config plan/apply execution neither
owns this IAM nor permits its replacement; do not widen that execution boundary.
No database, service or runtime identity is created by this change.

Only Config plan/apply execution accounts receive service and identity read /
configuration permissions bound to this service and runtime. They cannot create,
delete or administer IAM, submit image builds or impersonate `fa-build`. Config
apply alone may attach the Config runtime. Cloud Run validates existing images
on a configuration PATCH, so Config apply also receives only
`artifactregistry.repositories.downloadArtifacts` on the existing Toronto
`financial-analysis` repository. This repository is shared; the read grant is not
an image-path isolation boundary. It grants no writes or administration.

## State, approval and minimal acceptance

The isolated backend is `financial-analysis-512202-tfstate-config`, prefix
`prod/config`. The registered runner supplies backend settings and uses the
repository's pinned Terraform/provider lock. Keep raw state, plans, environment
inventory and credentials private.

After merging this target's own infrastructure PR:

1. Complete the administrator database IAM migration runbook first. Historical
   adoption imports retain their original boundaries, but the Config Datastore
   User member is now conditional: its old unconditional state requires the
   narrowly reviewed replacement described there. Reject unrelated bootstrap
   changes, service/account/database creation or replacement, and trigger changes.
2. Run `terraform-plan-config` from merged `main`. Review the exact saved plan:
   two native imports must be no-ops; only the local controller and its ordered
   verification read are new. Stop on service or account creation/replacement.
3. Request `terraform-apply-config` with the producer build ID and provide native
   approval for that exact reviewed source and saved plan.
4. Verify unchanged service UID, runtime unique ID, live image, release markers,
   traffic, public invocation and capacity boundaries. Verify `/health`, a `401`
   for an unauthenticated preferences request, and a fresh no-change plan.

This adoption reuses the already verified shared image-release/rollback ownership
protocol and existing trigger without another extended production rollback drill.
Local mock tests require no cloud access. A successful plan alone does not claim
that a production apply or authenticated application flow has been tested.
