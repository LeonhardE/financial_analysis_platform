# Market infrastructure adoption and instance inputs

This root adopts only the explicitly selected existing `market-api` and its keyless runtime
identity. It uses the shared guarded configuration controller; images, release markers and
explicit traffic rollback retain their existing owners. User, Config and Web have independent
roots and execution identities. No identity or execution boundary is provisioned by this migration.

## Private configuration and ownership

The required `deployment` object contains `project_id`, `region`, `artifact_repository`,
`runtime_account_id`, `creation_image`, `existing_service_uid` and `web_origin`. It has no production
default or arbitrary environment map. The creation image must be an immutable `market-api` digest
in the selected project's regional repository; Web must be one canonical lowercase HTTPS origin.
Both declarative imports derive their existing object IDs from these same selected inputs.

Compile a private profile to a new review directory:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile /absolute/private/production.profile.json \
  --target market \
  --output-dir /absolute/private/new-market-review
```

The compiler writes a private `0700` directory and `0600` files.
`terraform-inputs.candidate.json` contains the `deployment` variable object for an explicitly
authorized diagnostic plan's `-var-file`; its filename is deliberately not auto-loaded.
`deployment-config.candidate.json` is the administrator-managed plan/apply trigger projection;
`trigger-substitutions.candidate.json` and `manifest.json` carry its transport inputs and hashes.
Candidates do not approve or activate a deployment. Keep profiles, generated inputs, state, plans
and runtime-bearing evidence outside Git and application images.

The profile `render` command also includes the canonical Market projection string in the
bootstrap `deployment_configs` map. Bootstrap consumes it for Market's existing runtime/IAM
references, artifact repository, image-trigger anchor and build substitutions. It must agree with
the bootstrap's explicit project, region and source repository. Production execution consumes the
reviewed trigger configuration, binding its exact bytes, instance, source and target to the saved
plan. Remote Cloud Build cannot use an operator's ignored local files.

The trusted runner selects the existing isolated state bucket with prefix `prod/market`. Preserve
that backend and lineage, resource addresses, import destinations, runtime identity, toolchain and
provider locks. The two declarative imports stay in place and must remain no-ops. Native service
and runtime resources retain deletion protection and `prevent_destroy`; the native service ignores
updates, so configuration changes use the conditional controller instead of the provider's
full-template update path.

## Preserved runtime, access and release boundaries

Keep one HTTP container on port `8080`, request-billed one-vCPU, `512Mi`, startup CPU boost, timeout
`300s`, concurrency `80`, revision scaling `0..12`, the same seven runtime environment values and
no secret references. The independent service-wide maximum remains `2`. Neither instance maximum
nor process-local request/storage controls promise a whole-project spending cap.

Market retains ingress `INGRESS_TRAFFIC_ALL` and `invokerIamDisabled=true` for public browser
access. Its IAM remains unchanged: `allow_unauthenticated=false` means no new `allUsers` member,
not a private service. `market_boundary` independently checks the inventoried UID, invocation mode
and service-wide maximum during planning; missing/replaced services or altered boundaries fail
before native creation could run. These observed boundaries are not automatically repaired.

The creation-image input is only a digest-pinned creation-time contract. Editing it is not an
image release and cannot roll back the deployed service. The registered controller
`module.market.terraform_data.configuration` reads the current live image and fresh etag, and
preserves release markers and pinned traffic. Historical first-adoption CPU normalization is not
a reason to force another controller replacement or configuration revision.

Market apply retains only download access on the selected existing Artifact Registry repository
when Cloud Run validates a configuration PATCH. The repository is shared, so read access includes
its other images; it is not an image-path isolation boundary. There is no upload, deletion,
repository administration, arbitrary build submission or shared publisher impersonation grant.
Normal Market execution cannot manage its administrator-owned image trigger or IAM.

## Complete no-change plan and acceptance

Review the full existing-state administrator plan and full Market business-root plan, without
`-target` or forced controller replacement. This input migration must create no cloud resources,
change no IAM tuple/database, replace no service/account, and preserve the live image and traffic.
The administrator plan may update only the reviewed metadata on existing Market plan/apply
triggers. The business root must show no managed resource changes. Reject unexpected controller
work or another target's changes and investigate instead of applying repeatedly.

The image-build YAML has empty `_REGION` and `_REPOSITORY` defaults. The existing managed Market
trigger supplies both explicitly from the selected instance; manual build-only runs must do the
same. YAML `_DEPLOY_SERVICE` stays `false`, with the existing reviewed trigger retaining its own
deployment switch and filters. Subsequent image publication uses that existing Market trigger.

The existing [target execution workflow](../../../README.md) still requires source/target review,
state and plan hashes, main-only provenance, saved-plan age checks and native approval before
applying the exact reviewed plan. After authorized execution, verify the same UID/runtime,
invocation/cap, live image, release markers, traffic and `/health`, then require a fresh no-change
plan. This migration does not require another production release/rollback drill; the
[ownership protocol](../../../compatibility/README.md) and local regression tests preserve that
existing behavior.

Offline validation uses the pinned toolchain and mock provider data only:

```sh
terraform -chdir=infra/gcp/terraform/envs/prod/market init -backend=false -lockfile=readonly
terraform -chdir=infra/gcp/terraform/envs/prod/market test
```

Two synthetic instances exercise project/region/repository/runtime selection; existing UID,
invocation and cap failures and invalid inputs are rejected. These tests do not access cloud
state or establish current production acceptance. Full repository checks and the complete actual
no-change plans remain required for integration.

## Existing database scope and historical evidence

`google_project_iam_member.market_cache` remains administrator-owned with its exact condition
limiting the selected runtime's existing Datastore User role to this project's `(default)`
database. The shared scope-only module creates no second grant or database owner; application
storage still selects `(default)`. Preserve the already-correct condition without repeating IAM
replacement. The [database migration runbook](database-iam-migration.md) describes the separate
historical migration and recovery process, outside normal Market execution permissions.

The [first-adoption read-only result](adoption-readonly-results-2026-10-23.json) records its own
historical source hashes, inventory and initial execution-boundary additions. It does not
validate the current private configuration, authorize recreating resources or justify first-build
steps on an already-adopted deployment. Raw historical evidence remains private.
