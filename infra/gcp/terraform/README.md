# Terraform target execution

Each service/client has a separate plan → review → native Cloud Build approval → exact saved-plan
apply workflow. Merging source does not automatically apply infrastructure. The
[operator deployment profile](../deployment-profiles/README.md) selects an explicit instance;
`pipeline.json` contains only static protocol registration, toolchain version and plan-age policy.
It contains no global project, region, source repository, state bucket or plan bucket defaults.

| Target                            | Normal execution                                           | Administrator preparation                                                                                                 |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `repo`                            | Enabled, `trigger-v1`                                      | Existing foundation and execution identities                                                                              |
| `market`, `user`, `config`, `web` | Enabled, `trigger-v1`                                      | Existing adopted service/client boundaries                                                                                |
| `portfolio`                       | Disabled, `trigger-v1`; image publication stays build-only | Existing `service` stage must be preserved in operator inputs                                                             |
| `agent-hub`                       | Disabled, `inactive-v1`; not runnable                      | Uncreated; `none` creates nothing; existing `execution`/`service` preparation remains separately administrator-controlled |

All six `trigger-v1` entries require an explicit canonical projection in
`deployment_configs[target]`, including disabled Portfolio. Missing configuration fails closed.
The `inactive-v1` marker is reserved for disabled Agent Hub and carries static metadata only. It
requires no invented service/trigger UUIDs for uncreated Hub, provides no instance fallback, and
does not enable normal execution. Later Hub activation requires its own migration to `trigger-v1`
with valid configuration.

`bootstrap/` is administrator-managed and retains the existing resource addresses. Normal target
execution cannot provision its own execution IAM, accounts, buckets or approval trigger. The
[target-execution module](modules/target-execution/README.md) provides isolated execution boundaries;
target-specific administrative files retain ownership of image triggers and scoped grants.

Before an administrator plan, run this credential-free source preflight:

```bash
python3 infra/gcp/terraform_pipeline.py check-registry
```

It validates all catalog metadata and active roots, locks, source fingerprints, symlinks and
disallowed ad-hoc variable files. Current enabled targets are `repo, market, user, config, web`.
Disabled targets are rejected before credentials, Terraform or cloud access. Preflight verifies
source policy; it does not fetch a deployment instance or attest to live IAM/resource state.

<a id="one-time-administrator-bootstrap"></a>

## Instance selection and existing administrator updates

Use the existing administrator checkout, its correct remote backend and an explicit private
profile. Never initialize empty local state against already-created resources. Actual profiles,
generated candidates, backend files, state and plans belong in ignored operator storage.

```bash
python3 infra/gcp/deployment_profile.py validate --profile .deployment/profile.json
python3 infra/gcp/deployment_profile.py render \
  --profile .deployment/profile.json --output-dir .deployment/bootstrap-review
python3 infra/gcp/deployment_profile.py compile \
  --profile .deployment/profile.json --target market --output-dir .deployment/market-review
```

The output directory must be new. `render` produces bootstrap inputs with the explicitly selected
stages and adopted-target projections; `compile` produces one target projection, typed Terraform
inputs, trigger substitutions and a digest manifest. Files are private review candidates, never
automatic activation, approval or live inventory evidence. The legacy `pipeline.candidate.json`
is an offline compatibility view; do not copy it over the static production catalog.

Review the complete selected bootstrap input, including every existing target's configuration and
the current Portfolio/Hub stages. Preserve applied stages, backend lineage, resource identity and
trigger UUIDs. A target migration must change only that target's owned metadata; do not regenerate
unrelated identities or make up adoption anchors. A valid hash proves byte equality, not ownership.

With the existing backend already initialized, an explicit candidate can be reviewed with:

```bash
terraform -chdir=infra/gcp/terraform/bootstrap plan \
  -var-file=/absolute/private/bootstrap-review/bootstrap-inputs.candidate.json \
  -out=/absolute/private/bootstrap-review/bootstrap.tfplan
```

Review the full binary/text plan before a separate administrator apply. This catalog cleanup
requires no resource creation, deletion, IAM change, database migration, stage change or normal
target activation. Stop on any unexpected instance change. Do not use targeted plans or an ignored
local profile as proof that Cloud Build received the right instance.

Remote execution obtains `_DEPLOYMENT_CONFIG` and `_DEPLOYMENT_SHA256` from the existing managed
target trigger. The runner reads the actual Build and Trigger using built-in project/region only
as locators, verifies byte equality and digest, then binds project, region, source, trigger UUID,
execution account and output-only main provenance. It privately generates exactly one typed
`deployment` var-file for plan. Apply verifies the same projection/input hashes and consumes only
the saved binary plan. Arbitrary `TF_*`, auto-loaded variables and extra var-files remain forbidden.

This existing-instance workflow is not a complete fresh-account installer. Initial APIs, source
connection, authenticated inventory, first resources, Firebase setup and recovery acceptance require
their separate installation work; do not run a historical local-state bootstrap over existing state.

## Target execution and approval

1. PR CI validates code without cloud credentials. No PR build creates an authenticated cloud plan.
2. For an enabled target, `terraform-plan-<target>` runs on protected `main` as its own plan identity.
   Target-root changes select that target; shared policy/executor changes select affected targets.
   Documentation-only changes are ignored.
3. Review the producer build and its private
   `gs://<project_id>-tfplans/plans/<target>/<build-id>/plan.txt`. Keep the exact build ID and resolved
   commit. Append-only artifacts bind target, backend, source, Terraform version, state generation,
   deployment projection and typed inputs.
4. In **Cloud Build → Triggers**, use the matching `terraform-apply-<target>` in the selected region.
   Pass the producer build ID as `_PLAN_BUILD_ID`, keep `_TARGET` fixed, then review and approve the
   pending build through native Cloud Build approval. Apply never queues or approves itself.
5. The runner verifies actual repository/SHA provenance, successful producer, expected identities
   and triggers, approval, backend, six-hour age, artifact generation/checksum and current state.
   It checks the downloaded plan's action safety, then applies that exact plan without replanning.
   Backend locking and saved-plan lineage/serial protections remain.

Approval occurs before an apply build starts. The manual trigger reads `main`; if main advances,
generate a fresh plan for the new commit. Requested source fields and overridable substitutions
cannot replace output-only provenance. Connected-repository and exact pinned Git URL provenance
are supported; missing/mixed sources fail.

Operators who can submit arbitrary builds as an apply identity remain trusted. Native approval
protects registered triggers, not arbitrary custom builds; narrowly grant submit/actAs powers.

## Runtime configuration controller repair

The [verified ownership protocol](compatibility/README.md) preserves image release state and pinned
rollback traffic. Desired-configuration edits replace only the local controller, not the service.
`configuration_controllers` registers at most one exact
`module.<name>.terraform_data.configuration` address per service/client; repo has none.

The runner allows `delete,create` only for that exact managed built-in resource from the reviewed
local `cloud-run-service` module. Other resources, destroy-only actions, create-before-destroy,
look-alike providers/modules and Cloud Run replacement remain rejected, including during apply.

For external changes to owned configuration, the module fails a normal plan. After reviewing drift,
manually run the target's **plan** trigger with `_REPAIR_CONTROLLER` set to its exact registered
address. YAML permits only this allowlisted `-replace`. Review and approve the saved plan as usual.
The repair request binds producer metadata and manifest; apply takes no repair override and never
replans. Repo rejects repair. IAM revocation and actual destruction require a separate workflow.

## State isolation, recovery and cost

Bucket names derive from the selected project under the validated naming contract:

- `${project_id}-tf-bootstrap`: administrator state, prefix `bootstrap`.
- `${project_id}-tfstate`: repo execution state, prefix `prod/repo`.
- `${project_id}-tfstate-${target}`: separate service/client state, prefix `prod/${target}`.
- `${project_id}-tfplans`: private `plans/<target>/<build-id>/` and
  `recovery/<target>/<build-id>/` artifacts.

Separate state buckets prevent cross-target object listing; prefix-only IAM cannot restrict GCS
listing. Plan can read state, initialize missing state, and delete only its exact backend lock.
Apply can update only its target state bucket. Execution accounts receive no administrator state
access or another target's bucket access from these modules. Artifact grants restrict each target
to its own append-only plans, exact plan reads and append-only recovery writes; the runner never
lists artifacts.

State buckets have versioning, bounded noncurrent cleanup, uniform access, public-access prevention,
`force_destroy=false` and `prevent_destroy`. Current state is not age-deleted; retention policies or
object holds do not block lock deletion. Plan/recovery objects expire after seven days while a plan
is executable for only six hours. Storage, operations, builds and logs can incur costs. No scheduler,
warm service, VPC, model call, paid KMS key or Terraform subscription is introduced by this workflow.

On apply failure, the runner attempts to save private diagnostics and `errored.tfstate` if produced.
The build remains failed. Upload failure is reported; cancellation can prevent capture. Reconcile
resources/state as administrator before retrying. Secure required recovery evidence before expiry.

For recovery, pause affected executions, copy a known state-object generation privately, and verify
project, prefix, lineage and serial. Use a separately reviewed administrator recovery operation.
Never blindly overwrite current state, force-unlock another running operation, or assume a state
restore rolls back cloud resources. An offline test is not a live recovery drill.

## Later target activation

Use one `infra(<target>)` PR for that target's actual root/provider lock, inventory/imports, owned
permissions, configuration-controller address and explicit projection contract. Existing services
require deliberate imports and a no-change or explicitly reviewed safe plan, never recreation.
Do not enable empty roots. Hub's disabled `inactive-v1` marker must become `trigger-v1` with valid
adoption configuration before ordinary execution; changing `enabled` alone is invalid.

An administrator update provisions only the separately approved execution boundary and owned grants.
Normal execution cannot grant itself permissions. First provisioning, image deployment, external
OAuth/domain verification, secret payloads and emergency recovery retain their separate review.
Portfolio's build-only mode and current service stage are not changed by this cleanup.

## Validation and references

```bash
npm run check
python3 infra/gcp/terraform_pipeline.py check-registry
python3 infra/gcp/terraform_tools.py check --terraform /path/to/pinned/terraform
```

The pinned toolchain is Terraform 1.16.7 / Google 7.28.0. Offline checks initialize with backends
disabled, exercise provider-mocked contracts and actual-provider localhost ownership regressions.
They need no cloud credentials. Live IAM, trigger provenance, backend state and recovery behavior
require authenticated evidence from the corresponding administrator workflow.

- [GCS backend locking and versioning](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Cloud Storage IAM conditions and listing](https://docs.cloud.google.com/storage/docs/access-control/iam#conditions)
- [Cloud Build native approval timing](https://docs.cloud.google.com/build/docs/securing-builds/gate-builds-on-approval)
- [Saved Terraform plans and sensitive content](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Cloud Build output source provenance](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.builds#SourceProvenance)
- [State persistence failure and recovery](https://developer.hashicorp.com/terraform/language/state/backends)
