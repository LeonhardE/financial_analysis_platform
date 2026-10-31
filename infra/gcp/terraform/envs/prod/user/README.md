# User infrastructure adoption and instance inputs

This root adopts one explicitly selected existing `user-api` and its existing keyless runtime
identity. It never creates or renames either identity. The independent service UID, public-invoker
mode and service-wide maximum of one are checked during planning, before any controller work.
The isolated backend keeps prefix `prod/user`; the trusted target configuration selects its
existing state bucket and execution identities.

## Private configuration

The required `deployment` object contains only `project_id`, `region`, `artifact_repository`,
`runtime_account_id`, `creation_image`, `existing_service_uid`, `web_origin` and `market_origin`.
There is no default production instance or arbitrary environment map. The image must be an
immutable `user-api` digest in the selected project's regional repository. Both origins must be
distinct canonical HTTPS origins without credentials, ports, paths, queries or fragments.

Compile the explicitly selected private profile to a new private review directory:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile /absolute/private/production.profile.json \
  --target user \
  --output-dir /absolute/private/new-user-review
```

The directory is created with `0700` permissions and files with `0600` permissions.
`terraform-inputs.candidate.json` contains `{"deployment": {...}}` for an explicitly authorized
local diagnostic plan's `-var-file`; its filename is deliberately not auto-loaded.
`deployment-config.candidate.json` is the administrator-managed plan/apply trigger projection,
`trigger-substitutions.candidate.json` contains its transport substitutions, and `manifest.json`
binds their hashes. These are review candidates, not approval or activation. Keep all profiles,
projections, plans and runtime-bearing evidence outside Git and application images.

The profile `render` command also supplies the canonical User projection string in the bootstrap
`deployment_configs` map. Bootstrap consumes that User entry for the runtime account, existing
build-trigger import, artifact repository and image-build substitutions. The selected projection
must match the bootstrap's explicit project, region and source repository. Production plan/apply
uses the reviewed trigger configuration and binds its exact bytes, instance, source and target to
the saved plan; remote Cloud Build cannot read a developer's ignored local input file.

## Ownership and unchanged deployment boundaries

Keep the existing backend, state lineage, lockfiles, resource addresses, import destinations,
runtime identity and current deployment configuration. Review a complete state-backed User plan,
without `-target` or a forced controller replacement. A configuration-only migration must show no
managed resource changes. Any identity replacement, new resource, IAM change, database change or
unexpected controller replacement is a stop condition. The historical CPU normalization performed
during first adoption is not a reason to repeat a configuration apply.

The service and account retain deletion protection. The native Run resource cannot update the
service; the guarded configuration controller owns runtime configuration while image releases,
release markers and traffic remain release-owned. Preserve revision scaling `0..12`, service-wide
maximum `1`, existing concurrency/timeout/memory, the same `(default)` database, exact database IAM
condition, private-route authentication, revoked-token checks and no-store responses. Changing the
instance inputs alone does not enable Hub workload/delegation trust; the optional reviewed
trust contract below is separately selected.

The existing image publisher and runtime Firestore/Firebase metadata grants remain owned by
`bootstrap/user.tf`. User's Datastore User grant is restricted to `(default)` using the shared
Firestore module's scope-only condition. The [administrator IAM migration](database-iam-migration.md)
is a separate, historical migration/recovery procedure; this configuration migration must preserve
an already-correct conditional tuple and Firebase Auth Viewer. Only User apply can configure this
service, maintain/attach its runtime identity and download existing images from its selected
repository. The repository is shared, so download access includes its other images; deployment
remains User-only. No service creation/deletion, IAM administration, image upload, build execution,
new database, new bucket or new identity permission is introduced.

The User image-build YAML has empty `_REGION` and `_REPOSITORY` defaults; its existing managed
trigger supplies them from the reviewed instance. Manual build-only runs must supply both.
`_DEPLOY_SERVICE` still defaults to `false` in YAML; the existing reviewed trigger keeps its own
deployment switch. Subsequent image releases use that existing User trigger and unchanged filters.

## Offline verification

Initialize the pinned provider with the backend disabled, then run the synthetic plans:

```sh
terraform -chdir=infra/gcp/terraform/envs/prod/user init -backend=false -lockfile=readonly
terraform -chdir=infra/gcp/terraform/envs/prod/user test
```

The tests use two synthetic projects, regions, repositories, runtime identities and origin pairs.
They reject changed UID/access/cap, mixed-instance images and invalid deployment origins. They do
not access a real account, state backend or cloud service. Runtime tests separately preserve strict
Firebase authentication, owner isolation, the bounded credential-free Market client, emulator
rejection and disabled Hub trust. Full repository checks and a complete production no-change plan
remain required when integrating the target with the shared execution foundation.

## INF-007 explicit User/Hub trust consumer

This User-only root now opts into `user-hub-trust.v1` through the closed
`user-hub-trust.consumer.json` marker. The optional `hub_trust` variable is a fixed four-key string
map. Null (the legacy default) and four empty values produce the exact prior environment, with no
Hub settings or permissions added. Partial settings, unknown keys, wrong issuer/audiences, an
unbounded/noncanonical caller map, multiple callers, a self/foreign-project runtime or noncanonical
numeric caller subject fail validation.

For an explicitly selected adopted User and Hub, use the repo foundation's opt-in command:

```sh
python3 infra/gcp/deployment_profile.py compile-user-hub-trust \
  --profile /absolute/private/production.profile.json \
  --output-dir /absolute/private/user-hub-trust-review
```

The reviewed v3 profile pins the actual Hub service-account numeric unique ID. The compiler
derives the fixed User/Hub numbered Run audiences/issuer and the selected same-project Hub runtime
email. The managed `deployment-config.candidate.json` carries the self-contained trust extension;
its `terraform-inputs.candidate.json` supplies `deployment` plus `hub_trust`. The usual independent
managed-trigger hash, selected instance/source and saved-plan gates bind both. Candidate generation
is not authorization to update either trigger or runtime. Keep operator inputs and plans local.

The four consumed variables are `USER_SERVICE_AUDIENCE`, `USER_DELEGATION_AUDIENCE`,
`USER_DELEGATION_ISSUER` and `USER_TRUSTED_HUB_CALLERS`. This contract uses one caller and canonical
numbered Run origins; JWKS stays fixed at the issuer's `/.well-known/jwks.json`. It adds no arbitrary
environment/JWKS endpoint, content-decryption permission, database grant, runtime identity or IAM
policy. Existing Firebase owner verification, public invocation mode, `(default)` storage, resource
addresses, UID guard and cost limits remain unchanged.

A trust-enabling plan may replace only the existing guarded configuration controller to set these
four nonsecret environment values. Review its complete source/state-backed plan independently of
image release; native service replacement, IAM/database changes or an unrelated diff is a stop
condition. Bootstrap's User-only trigger metadata migration is also reviewed separately before the
User plan uses the new projection. Old saved plans cannot be reused after source/input changes.

The producer already implements workload-plus-delegation verification and remains unavailable when
trust is absent/invalid. Synthetic mock plans prove configuration behavior; actual positive and
negative caller/delegation smoke requires the Hub issuer/JWKS to be reachable and its sources
configured through separate Hub work. This source change alone does not complete INF-007 live
acceptance or enable OAuth/agents.
