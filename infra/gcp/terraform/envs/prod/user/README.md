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
instance inputs does not enable Hub workload/delegation trust; those settings remain closed.

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
