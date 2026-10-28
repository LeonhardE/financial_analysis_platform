# Config infrastructure adoption and instance inputs

This root adopts only the explicitly selected existing `config-api` and its keyless runtime
identity. Other services retain their independent roots and execution identities. The independent
service UID, public invocation mode and service-wide maximum of one are checked at plan time,
before any controller action. No service or runtime account is created or renamed.

## Private instance configuration

The required `deployment` object contains exactly the supported instance fields: `project_id`,
`region`, `artifact_repository`, `runtime_account_id`, `creation_image`, `existing_service_uid`
and `web_origin`. It has no production defaults or arbitrary environment map. The immutable image
must select `config-api` in the same project, region and repository; the Web origin must be one
canonical lowercase HTTPS origin without userinfo, port, path, query or fragment.

Compile the explicitly selected private profile into a new private review directory:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile /absolute/private/production.profile.json \
  --target config \
  --output-dir /absolute/private/new-config-review
```

The new directory uses permissions `0700`; its files use `0600`.
`terraform-inputs.candidate.json` contains the `deployment` variable object for an explicitly
authorized local diagnostic plan's `-var-file`. Its candidate filename is not automatically loaded.
`deployment-config.candidate.json` is the Config projection for the administrator-managed plan/apply
triggers, `trigger-substitutions.candidate.json` carries its transport substitutions, and
`manifest.json` binds the file hashes. These candidates do not approve or activate a deployment.
Keep profiles, projections, state, plans and runtime-bearing evidence outside Git and app images.

The profile `render` command also supplies the canonical projection string in the bootstrap
`deployment_configs` map. Bootstrap uses its Config entry for the runtime/IAM references, existing
image-trigger anchor, repository and build substitutions. That projection must agree with the
bootstrap's explicit project, region and source repository. Production execution consumes the
reviewed trigger configuration and binds its bytes, instance, source and target to the saved plan.
Remote Cloud Build cannot obtain inputs from an operator's ignored local files.

## Preserved service and ownership boundaries

Preserve ingress `INGRESS_TRAFFIC_ALL`, public Cloud Run invocation using
`invokerIamDisabled=true`, and the service-wide maximum of one instance. Private Config routes
continue requiring verified Firebase Google identity, including revoked/disabled-user checks,
owner isolation and private/no-store failures. Keep one request-billed vCPU, `256Mi`, port `8080`,
timeout `60s`, concurrency `8`, revision scaling `0..12`, startup CPU boost and the same four
runtime environment values. No delegation caller or Hub trust setting is introduced.

Native deletion protection and `prevent_destroy` remain enabled. The native service ignores
updates; `module.config.terraform_data.configuration` owns runtime configuration through the
guarded controller. It reads the live image/etag at execution time and preserves unknown template
fields. The creation-image input is digest-pinned and cannot replace a release. Images, release
markers and explicit traffic rollback remain owned by the existing release protocol. Historical
CPU normalization during first adoption is not a reason to force another controller apply.

Administrator `bootstrap/config.tf` keeps ownership of the existing `build-config-api` trigger,
image deployment/runtime attachment grants, scoped Datastore User membership and Firebase Auth
Viewer. It preserves push filters and the existing deployment switch. The database condition
continues restricting `google_project_iam_member.config_store` to this selected project's exact
`(default)` database, with no second owner or database import. The
[database IAM migration runbook](DATABASE_IAM_MIGRATION.md) is a separate historical migration and
recovery procedure; this instance-input migration must preserve an already-correct tuple instead
of repeating IAM replacement. Normal Config execution cannot administer or replace those grants.

Only Config execution identities receive service/runtime read or configuration permissions bound
to this target. Config apply can attach its own runtime and download existing images from its
selected artifact repository, without uploads or administration. The repository is shared, so its
download grant includes other images and is not an image-path isolation boundary. No service,
identity, database, state bucket or permission is provisioned by this configuration migration.

## Complete plan review and verification

Keep the existing isolated state bucket and `prod/config` prefix, state lineage, provider locks,
resource addresses, imports, runtime identity and live configuration. Use the trusted runner for a
complete state-backed Config plan, without `-target` or a forced controller replacement. Require
no managed resource changes for this migration. Stop on a new/replaced service/account, IAM or
database change, altered trigger ownership, unexpected controller work, or image/traffic change.
Input validation, synthetic tests and CI do not replace that state-backed review.

The Config image-build YAML has empty `_REGION` and `_REPOSITORY` defaults; the existing managed
trigger explicitly supplies both from the reviewed instance. A manual build-only run must supply
both. `_DEPLOY_SERVICE` still defaults to `false` in YAML while the existing reviewed trigger keeps
its deployment switch. Subsequent application releases use the same Config image trigger.

Offline checks use the pinned toolchain and synthetic provider data only:

```sh
terraform -chdir=infra/gcp/terraform/envs/prod/config init -backend=false -lockfile=readonly
terraform -chdir=infra/gcp/terraform/envs/prod/config test
```

The tests cover two projects/regions/repositories/runtime accounts, the existing UID/access/cap
guards and malformed/mixed-instance inputs. Existing Config service tests exercise private owner
storage, authentication failures, bounded bodies, conflict handling and emulator refusal. They do
not connect to accounts, production state or cloud services. Full repository checks and review of
a complete unchanged production plan remain required after integration with the shared foundation.
