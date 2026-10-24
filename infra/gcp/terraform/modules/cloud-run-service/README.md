# Cloud Run service module

One HTTP container with an explicit keyless runtime identity, environment/Secret Manager references,
resource limits, network ingress and additive service-level invoker IAM. This is an unused shared
module, not a production root or an import of any existing service.

Configuration uses the [guarded ownership protocol](../../compatibility/README.md). The native
resource creates/imports the service with deletion protection and ignores all later updates; an
apply-time `terraform_data.configuration` controller reads the current service and conditionally
updates owned configuration with its etag. It preserves live image, traffic and release markers.
A read-after-apply data source verifies owned fields and detects external configuration drift.

The controller uses Python 3 and the executor's authenticated `gcloud` identity. Provider-only
impersonation does not implicitly configure that CLI identity. Execute the module from the repository
checkout so the reviewed sibling configuration/release helper files are available. Future target
runners must permit the specific local controller replacement and supply service-scoped IAM;
the current repo-only runner still rejects replacements and does not register service targets.

The [native-provider historical regressions](../../compatibility/native-ownership-findings.md)
remain separate from the current integration/live protocol checks. Production adoption is a later,
single-target PR, with its own no-resource-change import plan and deployment verification.

## Inputs and defaults

| Input                                    | Contract                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `project_id`, `name`                     | Required project ID and one service name                                                              |
| `image`                                  | Creation-only bootstrap image with immutable `@sha256:` digest; later releases use the image pipeline |
| `runtime_service_account`                | Required custom same-project service account email                                                    |
| `region`                                 | Toronto, `northamerica-northeast2`                                                                    |
| `memory`                                 | `512Mi`; initially one vCPU, supporting `256Mi` through `4Gi`                                         |
| `min_instances`, `max_instances`         | `0`, `1`; integer revision-level limits, maximum at least minimum                                     |
| `concurrency`, `timeout_seconds`, `port` | `40`, `60`, `8080`                                                                                    |
| `startup_cpu_boost`                      | `false`; explicit opt-in for additional startup CPU                                                   |
| `environment`                            | Empty non-secret map; excludes Cloud Run reserved names                                               |
| `secret_environment`                     | Empty map of env name → `{ secret = full same-project ID, version = numeric version }`                |
| `ingress`                                | `INGRESS_TRAFFIC_INTERNAL_ONLY`                                                                       |
| `allow_unauthenticated`                  | `false`; requires explicit `INGRESS_TRAFFIC_ALL` for public browser access                            |
| `invoker_service_accounts`               | Empty map; stable caller keys → unique same-project service account emails                            |

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

## Configuration and rollback

Owned settings are runtime identity, environment and secret references, memory/CPU request billing,
scaling, concurrency, timeout, port, startup boost and ingress. A digest input edit on an existing
service is not an image release. Unknown supported template/container fields and port protocol are
preserved, but multiple containers, GPUs and additional compute profiles require a later contract.

Pinned traffic keeps serving the chosen immutable rollback revision. Configuration edits stage on
the current desired template; older serving revisions retain their previous settings until an
explicit release. The configuration helper reports that distinction and never patches traffic.

External changes to owned settings cause the verification data source to fail a plan. Reconcile the
code or review `terraform plan -replace=module.<name>.terraform_data.configuration` to explicitly
repair drift. This replacement has no destroy provisioner and never replaces the service. Desired
configuration is the stable trigger, so successful configuration/release/rollback operations produce
a no-op plan. Unowned image/revision/traffic drift does not trigger configuration repair.

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
