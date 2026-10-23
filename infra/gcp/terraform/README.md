# Terraform repository foundation

This is the repository-only foundation for `financial-analysis-512202` in Toronto
(`northamerica-northeast2`). It does not import, change or deploy Market, User, Config or Web.
Merging this PR installs no cloud resources by itself. An existing project administrator performs
bootstrap once after review; subsequent registered execution roots use Cloud Build.

## What this foundation owns

| Root / component                | Ownership                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`                    | Three private GCS buckets, two execution identities, narrowly scoped IAM and two repo-only Cloud Build triggers. Administrator-managed, outside normal apply. |
| `envs/prod/repo/`               | One built-in `terraform_data` execution contract, to exercise remote state and the saved-plan workflow without creating a business service.                   |
| `pipeline.json`                 | Explicit target registry, state prefix, expected identities/triggers and six-hour plan validity. Only `repo` is registered.                                   |
| `toolchain.json`, provider lock | Terraform 1.16.7 archive checksums and Google provider 7.28.0 dependency lock.                                                                                |

Shared modules and individual service/client roots follow in separate PRs. Neither normal execution
identity can access administrative bootstrap state, change its own IAM/trigger, create another build,
approve a build, or modify an existing business service. `fa-build` keeps its existing permissions.

## Execution flow

1. A PR runs formatting, backend-disabled initialization, validation, native mocked Terraform tests
   and Python protocol tests. PR jobs receive no GCP credentials and do not create cloud plans.
2. After relevant changes reach protected `main`, `terraform-plan-repo` runs as `fa-infra-plan`.
   It initializes the registered GCS backend, validates, takes the state generation before and after
   planning, and saves a binary plan plus a human-readable private review file.
3. Review the producing build and private `plan.txt`. Request `terraform-apply-repo` with that plan
   build's ID in `_PLAN_BUILD_ID`, keeping `_TARGET=repo` and the same source commit.
4. Review the pending apply build's substitutions/source, then approve it in Cloud Build. Native
   approval happens **before** the apply build starts. The runner verifies the producer succeeded,
   actual resolved repository/SHA, registered triggers/identities, target, configuration hash, CLI
   version, artifact generation/checksum, plan age and current state generation.
5. Apply runs the saved binary plan, never a newly generated plan. Terraform's backend lock and
   saved-plan lineage/serial checks remain enabled. A stale plan, changed source, replacement/delete,
   missing provenance or failed validation stops the build.

Plan and apply are separate builds because a single approval-required build cannot pause for approval
between its own plan and apply steps. The plan identity cannot queue an apply build or impersonate
its identity. Requesting apply and approving it are deliberate operator actions in this version;
merging does **not** automatically apply infrastructure.

The manual apply trigger reads `main`. If `main` advances before apply, generate a fresh plan for the
current commit, even when the newer commit only changed an application. Both builds must report the
same resolved SHA. Inspect the actual build metadata during first activation; this protocol expects
Cloud Build v2 `sourceProvenance.resolvedConnectedRepository` and fails closed when it is absent.

These checks detect wrong or stale invocations; protected source and restricted cloud IAM remain the
trust boundary. Manual run/admin operators are trusted. A user allowed to submit arbitrary builds and
act as `fa-infra-apply` can bypass repository scripts, so do not grant those powers broadly. Native
approval protects the registered trigger, not arbitrary builds submitted outside that trigger.

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

## Adding the next target

First land `infra(shared)` modules and the Terraform/Cloud Build release-ownership compatibility
checks. Then use one `infra(<service/client>)` PR at a time to add its root, dependency lock, state/IAM
boundary and trigger. The current execution-bucket grants cover only this repo foundation's trust
boundary; introduce per-target isolation and appropriate resource permissions rather than casually
reusing broad access for business state. Never let normal apply manage its own bootstrap/IAM/trigger.

Existing services require deliberate `import` and an initial no-change plan, not recreation. Confirm
that runtime images, revisions, deployment annotations, traffic and Console rollbacks stay owned by
Cloud Build. A future service's Terraform apply must not race application deployment; that shared
release protocol is a later prerequisite, not implemented here.

After each target is adopted, normal configuration changes can flow through code/PR → automatic plan
→ reviewed saved-plan apply. One-time bootstrap, external OAuth/account/domain verification, secret
payload entry and emergency recovery may still require separate actions. Unattended apply is a
separate policy decision, not enabled by this foundation.

## Validation and official references

```bash
npm run check
python3 infra/gcp/terraform_tools.py install --directory /tmp/folioview-terraform-tools
python3 infra/gcp/terraform_tools.py check --terraform /tmp/folioview-terraform-tools/terraform
```

Checks use a disabled backend and mocked Google resources; none runs a cloud `plan`, `import` or
`apply`. Provider downloads are verified by the committed lock file. Version changes require
reviewing official checksums and regenerating provider locks for the developer and Linux CI platforms.

- [GCS backend, locking and versioning](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Cloud Build approvals run before build steps](https://docs.cloud.google.com/build/docs/securing-builds/gate-builds-on-approval)
- [User-managed Cloud Build execution accounts](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts)
- [Saved Terraform plans and sensitive content](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [GCS generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)
- [Cloud Build source provenance](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.builds#SourceProvenance)
- [Remote-state persistence failure and recovery](https://developer.hashicorp.com/terraform/language/state/backends)
