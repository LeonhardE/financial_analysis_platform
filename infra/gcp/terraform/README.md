# Terraform target execution

The repository provides one reusable plan → review → native Cloud Build approval → exact saved-plan
apply workflow per service/client. Market now has a dedicated [adoption root](envs/prod/market/README.md); User, Config and Web remain
disabled. Merging code does not apply infrastructure automatically.

| Target                  | Execution status in this PR                                                      | State boundary                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `repo`                  | Enabled; existing identities, triggers, bucket and resource addresses retained   | `financial-analysis-512202-tfstate`, prefix `prod/repo`                                            |
| `market`                | Enabled in source for reviewed adoption; run administrator bootstrap after merge | `financial-analysis-512202-tfstate-market`, prefix `prod/market`                                   |
| `user`, `config`, `web` | Disabled catalog entries; no placeholder roots or new cloud resources            | One `${project_id}-tfstate-${target}` bucket and `prod/${target}` prefix after separate activation |

`bootstrap/` is administrator-managed. Market-specific image-trigger and IAM adoption also lives in
`bootstrap/market.tf`; the Market runtime identity and service live only in the Market root. It retains
the existing three foundation buckets and repo
execution resources; [target-execution](modules/target-execution/README.md) supplies per-target
accounts, state buckets and triggers only when that target is explicitly activated. The normal
runner cannot provision its own execution IAM, accounts, buckets or approval trigger.

`pipeline.json` schema 2 is the reviewed catalog. The runner validates canonical target roots,
backend names, phase-specific identities and triggers, explicit activation and globally isolated
boundaries. Disabled targets are rejected before Terraform or cloud access. Bootstrap has a blocking
precondition for catalog identity/conventions and enabled root/lockfile presence. Before an
administrator bootstrap plan, run this credential-free source preflight as well:

```bash
python3 infra/gcp/terraform_pipeline.py check-registry
```

It checks all active roots, locks, source fingerprints, symlinks and disallowed ad-hoc variable files.
Current output must list only `repo, market`. This is source activation; the Market accounts, bucket
and execution triggers are created only by the separately reviewed administrator bootstrap apply.

## Target execution and approval

1. PR CI validates code without cloud credentials. No PR build creates an authenticated cloud plan.
2. For an activated target, `terraform-plan-<target>` runs on protected `main` as its own plan
   identity. A target-root change selects only that target; shared modules, registry and executor
   changes select affected active targets. Documentation-only changes are ignored.
3. Review the producing build and private `gs://financial-analysis-512202-tfplans/plans/<target>/<build-id>/plan.txt`.
   Keep the exact producing build ID and resolved commit. Plan artifacts are append-only and bound
   to the target, bucket/prefix, source hash, Terraform version and state generation.
4. In **Cloud Build → Triggers**, choose the matching `terraform-apply-<target>` in Toronto, run it
   with that build ID in `_PLAN_BUILD_ID`, then review and approve the pending build in Cloud Build.
   Keep `_TARGET` fixed. Apply never queues or approves itself.
5. The runner verifies actual output-only repository/SHA provenance, successful producer, expected
   accounts/triggers, native approval, backend identity, six-hour age, artifact generation/checksum
   and current state. It rechecks the downloaded binary plan's action safety, then applies that
   exact plan without replanning. Backend locking and saved-plan lineage/serial protections remain.

Approval occurs before an apply build starts, so plan and apply are separate builds. The manual
trigger reads `main`; if main advances, generate a fresh plan for the new commit. Overridable
substitutions and requested source fields cannot replace actual resolved source provenance. Both
connected-repository and exact pinned Git URL provenance are supported; missing/mixed sources fail.

Operators who can submit arbitrary builds as an apply identity remain trusted. Native approval
protects registered triggers, not arbitrary custom builds; do not broadly grant submit/actAs powers.

## Runtime configuration controller repair

The [verified ownership protocol](compatibility/README.md) preserves image release state and pinned
rollback traffic. Ordinary desired-configuration edits replace only its local controller, not the
service. `configuration_controllers` registers at most one exact
`module.<name>.terraform_data.configuration` address per service/client; repo has none.

The runner allows `delete,create` only for that exact managed built-in resource from the reviewed
local `cloud-run-service` module. Other resources, destroy-only actions, create-before-destroy,
look-alike providers/modules and Cloud Run replacement remain rejected, including during apply.

For externally changed owned configuration, the module deliberately fails a normal plan. After
reviewing the drift, manually run the target's **plan** trigger with `_REPAIR_CONTROLLER` set to its
exact registered address. The shared YAML passes only this allowlisted `-replace` option. Review that
saved plan and approve its matching apply as usual. The repair request is bound to producer metadata
and the manifest; apply takes no repair override and never generates a new plan. The repo target
rejects controller repair. IAM revocation and actual resource destruction need a separate reviewed
workflow; this exception does not enable them.

## Isolation, retention and cost

New targets use separate versioned state buckets because GCS bucket IAM cannot restrict object
listing by an object-name prefix. Their plan account can read state and initialize missing objects,
but can delete only its exact backend lock. Apply can update only that target's bucket. Neither
account receives access to bootstrap state or another target's bucket from these modules.

Plans and recovery files share the existing private artifact bucket with target-specific conditional
grants: append-only `plans/<target>/`, read-only exact plan objects for that target, and append-only
`recovery/<target>/` writes. The executor never lists artifact objects. Existing repo bucket-wide
artifact grants are replaced with `plans/repo/` conditions during the administrator update.

State retains current data and version history with bounded noncurrent cleanup. Saved plans and
recovery diagnostics expire after seven days; execution validity is only six hours. Storage,
operations, builds and logs can incur costs. No scheduler, warm service, VPC, model call or hosted
Terraform subscription is added. Disabled catalog entries allocate nothing.

## One-time administrator bootstrap

Use the existing project administrator in the browser's **Cloud Shell** after this PR is merged.
No local service-account key is needed. Existing prerequisites are the Cloud Build/IAM APIs and the
already authorized Toronto Cloud Build v2 repository connection. Keep the existing Cloud Build
service agent permissions. The administrator needs permission to create the listed buckets/accounts,
custom roles, incremental IAM grants and triggers, and to act as the two execution accounts; use the
existing administrator rather than elevating `fa-build`.

1. Open the merged repository in Cloud Shell and select the GCP project:

   ```bash
   gcloud config set project financial-analysis-512202
   git clone https://github.com/LeonhardE/financial_analysis_platform.git
   cd financial_analysis_platform
   umask 077
   python3 infra/gcp/terraform_tools.py install --directory "$HOME/folioview-terraform-tools"
   export PATH="$HOME/folioview-terraform-tools:$PATH"
   ```

   Reuse an existing checkout instead of cloning again if appropriate. Cloud Shell provides the
   administrator's Google credentials; local use requires ADC. The installer verifies the committed
   archive checksum. The Git-ignored state/plan files still contain sensitive infrastructure data.

2. In **Cloud Build → Repositories → 2nd gen**, open the existing connected repository and copy its
   full resource name. Copy `bootstrap/terraform.tfvars.example` to
   `bootstrap/terraform.tfvars`, replacing the connection/repository placeholders. This is a GCP
   repository resource name, not a GitHub URL. Do not create another connection or copy a GitHub token.

3. Initialize locally and review bootstrap. Initial state uses the local backend because its remote
   bucket does not exist yet:

   ```bash
   terraform -chdir=infra/gcp/terraform/bootstrap init -lockfile=readonly
   terraform -chdir=infra/gcp/terraform/bootstrap plan -out=bootstrap.tfplan
   terraform -chdir=infra/gcp/terraform/bootstrap apply bootstrap.tfplan
   ```

   Expected changes are only the repository infrastructure listed above. Stop if existing services,
   databases, Firebase settings or existing application triggers appear. Buckets are globally named;
   a collision or existing identity must be inspected, not silently imported or recreated.

4. Immediately migrate the administrative state to its separate private bucket:

   ```bash
   cp infra/gcp/terraform/bootstrap/backend.tf.example infra/gcp/terraform/bootstrap/backend.tf
   terraform -chdir=infra/gcp/terraform/bootstrap init -migrate-state \
     -backend-config=bucket=financial-analysis-512202-tf-bootstrap \
     -backend-config=prefix=bootstrap
   terraform -chdir=infra/gcp/terraform/bootstrap plan
   ```

   Confirm the migration prompt, verify the remote `bootstrap/default.tfstate` exists, and expect a
   no-change plan. Keep the initial local backup private until remote recovery has been verified;
   never commit it. `backend.tf` is ignored because CI and first bootstrap must remain backend-free.
   On later administrator checkouts, copy the same template and run `init` with those backend values;
   do not repeat the initial local-state apply.

5. In Cloud Build, confirm the new triggers' execution accounts, `main` source, file filters and apply
   approval requirement. An operator needs Cloud Build run access and Service Account User on the
   corresponding identity; a reviewer needs Cloud Build Approver and private plan-object read
   access. Existing project administrators may already have the needed permissions. Delegate these
   narrowly; the bootstrap deliberately does not assign arbitrary human access or change recovery
   administrators.

6. Run `terraform-plan-repo` once against `main`. Open the build's private GCS review link and verify
   that the only creation is `terraform_data.execution_contract`. Request the manual apply trigger
   with its producing build ID; verify source/substitutions and approve. Run plan again and expect no
   resource changes. This is the first live acceptance test; offline PR validation does not prove GCP
   IAM, source provenance or backend behavior in the project's actual environment.

## State, recovery and cost

- `financial-analysis-512202-tf-bootstrap`: administrator state only.
- `financial-analysis-512202-tfstate`: execution state; currently only `prod/repo/default.tfstate`.
- `financial-analysis-512202-tfplans`: private `plans/repo/<build-id>/` and
  `recovery/repo/<build-id>/` artifacts, deleted by a seven-day lifecycle.

Both state buckets have versioning and bounded cleanup of old **noncurrent** versions. They never
age-delete the current state. No retention policy/object hold prevents lock deletion. All buckets
have uniform access, public-access prevention, `force_destroy=false` and `prevent_destroy`; there is
no paid KMS key or hosted Terraform subscription.

The plan account can read execution state, create an initial backend state, and create/delete only
its lock. It cannot overwrite or delete existing state. Plans are created with generation-match-zero
and the plan writer cannot replace them. Apply can update execution state, read saved plans and
create recovery objects only in its dedicated prefix. Backend locks serialize Terraform execution;
they do not coordinate with the existing application release helper.

On a Terraform apply failure, the runner attempts to save private diagnostics and `errored.tfstate`
when Terraform produced one. The build remains failed. If recovery upload also fails, it reports that
failure; do not retry blindly. Cancellation or a hard build termination can also prevent recovery capture.
Reconcile resources/state as administrator first. Diagnostics and
emergency state expire after seven days, so secure a private recovery copy promptly.

For recovery, pause affected executions, identify a known state-object generation in GCS object
version history and copy it to a protected local file. Verify project, prefix, lineage and serial;
use a reviewed state recovery operation as administrator. Never automatically copy an old state over
current state, use force-unlock while another operation owns the lock, or assume restoring state rolls
back cloud resources. Test the recovery procedure on a temporary **repo-only** execution prefix after
activation before using it for business resources. No live recovery drill has been performed by this
PR.

GCS storage/operations and Cloud Build/logging still cost money. No scheduler, warm instance, VPC,
load balancer or business service is added. Plan artifacts have a six-hour execution limit independent
of their seven-day storage lifecycle; remove unused builds/artifacts through reviewed operations.

## Administrator update after this PR merges

Use the existing administrator bootstrap checkout with its existing remote backend and variables.
Do not initialize an empty local state against already-created foundation resources.

1. Quiesce repo plan/apply executions, sync the merged main and run `check-registry` above.
2. Initialize the existing bootstrap backend with the pinned Terraform/provider, then save and
   inspect an administrator bootstrap plan. Expected cloud changes are the two repo artifact IAM
   grants becoming prefix-conditioned and the existing repo plan trigger's filters/substitution
   updating. The new default-activation output is empty. No service accounts, triggers, state buckets
   or production services should be recreated; stop and inspect unexpected changes.
3. Apply that reviewed administrator plan, then resume repo executions. Schema-1/old-source saved
   plans are intentionally invalid; run a fresh schema-2 `terraform-plan-repo`, review it and approve
   the matching apply to verify the updated workflow.

This PR itself performs no authenticated bootstrap apply, so new conditional grants/triggers are not
claimed as live-verified. Offline mocked tests and protocol fixtures verify the supplied contracts.

## Market adoption and later service/client activation

Follow the [Market rollout](envs/prod/market/README.md) for its exact imports, initial CPU
normalization, scoped permissions, review gates and post-merge checks. The existing image trigger
remains administrator-owned because Cloud Build trigger write access also allows submitting builds;
normal Market execution receives neither that permission nor access to the shared build identity.
The source enables only Market in addition to repo. Do not enable User, Config or Web as part of
this rollout.

## Activate another service/client later

Use one `infra(<target>)` PR to add that target's actual root and provider lock, inventory/imports,
owned-resource permissions and exact configuration-controller address, then enable its catalog entry.
Do not add empty roots merely to enable execution. Existing services require deliberate imports and
an initial no-change or explicitly reviewed safe plan, never recreation.

An administrator bootstrap update creates only that activated target's execution boundary. Its own
business-resource read/write and runtime actAs permissions must also be supplied by that target's
reviewed administrative configuration; normal execution must not grant itself permissions. Run its
first plan only after those grants exist, review the private artifacts, approve its exact saved apply
and verify ordinary image publication/rollback separately. Other targets stay disabled until their
own PR. Shared resource ownership is designed in its separate foundation PR.

Once activated and adopted, normal configuration changes use code/PR → target plan → human approval
→ exact apply. External OAuth/account/domain verification, secret payload entry and emergency
recovery remain separate operations. Unattended apply is not enabled.

## Validation and references

```bash
npm run check
python3 infra/gcp/terraform_pipeline.py check-registry
python3 infra/gcp/terraform_tools.py check --terraform /path/to/pinned/terraform
```

The pinned toolchain is Terraform 1.16.7 / Google 7.28.0. Checks initialize with backends disabled,
exercise provider-mocked module contracts, and run actual-provider localhost ownership regressions.
They need no cloud credentials. Per-target IAM/trigger behavior requires an authenticated activation
check in each later target PR; these are not claims of live migration.

- [GCS backend locking and versioning](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Cloud Storage IAM conditions and listing](https://docs.cloud.google.com/storage/docs/access-control/iam#conditions)
- [Cloud Build native approval timing](https://docs.cloud.google.com/build/docs/securing-builds/gate-builds-on-approval)
- [Saved Terraform plans and sensitive content](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Cloud Build output source provenance](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.builds#SourceProvenance)
- [State persistence failure and recovery](https://developer.hashicorp.com/terraform/language/state/backends)
