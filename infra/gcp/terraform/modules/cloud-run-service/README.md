# Cloud Run service module

One HTTP container with an explicit keyless runtime identity, environment/Secret Manager references,
resource limits, network ingress and additive service-level invoker IAM. This is an unused shared
module, not a production root or an import of any existing service.

**Release compatibility gate:** this initial module manages the entire template, image and latest
traffic. It deliberately has no `ignore_changes` escape hatch. Do not use it with the current
`deploy_existing_service.py`, point it at production, or enable image-release triggers until the
separate shared release-compatibility PR proves revision, configuration, rollback and concurrency
behavior. A mocked plan cannot prove those live behaviors. See the [module adoption gates](../README.md).

The [provider-level compatibility checks](../../compatibility/README.md) reproduce concrete blockers
with Google provider 7.28.0: stale full-template/traffic writes have no etag condition, while ignoring
an explicit revision name makes configuration updates reuse that immutable revision. The adoption
gate remains closed; passing these regression tests confirms the blockers, not release safety.

## Inputs and defaults

| Input                                    | Contract                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `project_id`, `name`                     | Required project ID and one service name                                               |
| `image`                                  | Required reviewed registry image with immutable `@sha256:` digest                      |
| `runtime_service_account`                | Required custom same-project service account email                                     |
| `region`                                 | Toronto, `northamerica-northeast2`                                                     |
| `memory`                                 | `512Mi`; initially one vCPU, supporting `256Mi` through `4Gi`                          |
| `min_instances`, `max_instances`         | `0`, `1`; integer revision-level limits, maximum at least minimum                      |
| `concurrency`, `timeout_seconds`, `port` | `40`, `60`, `8080`                                                                     |
| `startup_cpu_boost`                      | `false`; explicit opt-in for additional startup CPU                                    |
| `environment`                            | Empty non-secret map; excludes Cloud Run reserved names                                |
| `secret_environment`                     | Empty map of env name → `{ secret = full same-project ID, version = numeric version }` |
| `ingress`                                | `INGRESS_TRAFFIC_INTERNAL_ONLY`                                                        |
| `allow_unauthenticated`                  | `false`; requires explicit `INGRESS_TRAFFIC_ALL` for public browser access             |
| `invoker_service_accounts`               | Empty map; stable caller keys → unique same-project service account emails             |

CPU is explicitly request-billed (`cpu_idle = true`). Deletion protection and `prevent_destroy` are
enabled. Scale-to-zero avoids an always-warm allocation; revisions can overlap during deployments,
and the revision-level instance limit is not a billing cap. Extra CPU/memory, probes, private network
connectors, volumes and multiple containers are intentionally outside this first contract.

Invoker map keys must be known during planning, for example `{ worker = module.worker.email }`.
Values can come from newly-created identities. Stable logical keys avoid using computed emails as
resource instance addresses. Keep each email under only one key to avoid duplicate IAM ownership.

For a private Tasks worker, the consuming root must choose both reachable ingress and the named OIDC
invoker identity. Internal ingress alone does not make arbitrary Cloud Run callers or external queues
reachable. A browser-facing Firebase API needs the explicit public choices and must still verify
Firebase tokens in application code.

Secret values are never read or created here. Pass only references; supply accessor grants through
`service-identity` or service-specific resource IAM. A consuming root must order the service after
those grants (for example, `depends_on = [module.runtime_identity]`), and enable required APIs before
creating resources. Plain environment values remain visible in Terraform state and plans.

## Outputs and adoption

`id`, `name`, and `uri` expose the full resource ID, short service name and HTTPS URI. No IAM policy
or complete role binding is replaced. Existing external grants are not revoked by this module, so a
private default does not certify that an imported service has no pre-existing public access.

After the release gate is complete, adopt one target per infrastructure PR and match its actual
configuration first. Its service address is `module.<module_name>.google_cloud_run_v2_service.service`;
the full import ID is `projects/<project>/locations/<region>/services/<name>`. IAM members have their
own import addresses and must be inventoried separately. Never recreate a live service to adopt it.

## Validation

The repository Terraform check automatically finds `versions.tf`, initializes without a backend
using the committed Google provider lock and runs `tests/service.tftest.hcl` with a mocked provider.
No credentials or cloud plan/apply are needed.

- [Pinned provider service schema](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/cloud_run_v2_service.html.markdown)
- [Cloud Run CPU and billing configuration](https://docs.cloud.google.com/run/docs/configuring/services/cpu)
- [Cloud Run ingress](https://docs.cloud.google.com/run/docs/securing/ingress)
