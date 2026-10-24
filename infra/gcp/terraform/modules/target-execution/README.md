# Target Terraform execution boundary

Administrative bootstrap module for one service, independently deployed worker, or client. It creates execution infrastructure only: a private state bucket, separate keyless plan/apply identities, narrow state/artifact grants, and two Cloud Build triggers. Application resources and their permissions belong in the selected target's separate infrastructure PR.

The bootstrap instantiates this module only for an explicitly enabled non-`repo` registry entry. Adding a disabled target to the registry creates no cloud resources. Existing `repo` execution resources retain their original addresses and identifiers.

## Isolation

- State uses `${project_id}-tfstate-${target}` and prefix `prod/${target}`. Separate buckets keep GCS backend listing permissions from exposing another target's state.
- The plan identity can read state and create missing objects. Its delete-only custom role is conditioned on the exact `prod/${target}/default.tflock` name. It cannot overwrite or delete state.
- The apply identity can manage objects only in its own state bucket.
- The shared saved-plan bucket grants append-only writes to `plans/${target}/`, exact-object reads in that same prefix, and append-only recovery writes to `recovery/${target}/`. The runner fetches known object names without listing the bucket.
- Project-wide grants are limited to log writing and the bootstrap's build metadata reader. There are no application permissions, service account keys, impersonation grants, owner/editor roles, or IAM administration roles.
- State is private, versioned, protected from destruction, and keeps at least two newer recovery versions before expiring noncurrent versions older than 30 days.

Target slugs are limited to 15 characters so both `fa-infra-${target}-plan` and `fa-infra-${target}-apply` fit Google service account ID limits. Reserved administrative names are rejected.

## Execution

The plan trigger runs on `main` only when this target's Terraform root, shared modules, registry, toolchain, or common pipeline tooling changes. Documentation-only changes are ignored. Other targets' roots do not trigger this target.

Apply has no push event. It must be manually requested with a producing plan build ID, then explicitly approved in Cloud Build. The fixed `_TARGET` metadata and runtime provenance checks bind the producing plan, apply request, state, identities, and artifact prefix to the same target.

Only the administrative bootstrap owns this module's resource instances. Normal target execution roots must not manage execution buckets, execution identities, execution IAM grants, or Terraform plan/apply triggers. A target's business-resource permissions must be added separately before its first meaningful plan/apply.

## Inputs and outputs

Required inputs are `project_id`, `region`, `repository_id`, `target`, `plan_bucket`, `build_metadata_role`, and `lock_delete_role`. Pass the existing bootstrap custom roles; this module does not recreate or broaden them. Outputs expose the state bucket/prefix, execution emails, and plan/apply trigger names for registry verification and operations.

Run the module's provider-mocked tests with the repository's pinned Terraform version:

```bash
terraform -chdir=infra/gcp/terraform/modules/target-execution init -backend=false -lockfile=readonly
terraform -chdir=infra/gcp/terraform/modules/target-execution test
```
