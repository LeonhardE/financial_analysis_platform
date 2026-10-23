# Service identity module

Creates one enabled, keyless runtime service account. It grants no permissions by default.
The consuming root supplies the Google provider and owns the backend, project APIs,
imports, and its application-specific IAM. This module does not configure a provider,
create keys, read secret values, or create secret containers or versions.

Optional grants are deliberately narrow:

- `secret_ids` gives this identity `roles/secretmanager.secretAccessor` on each named
  secret in the same project.
- `deployer_service_accounts` gives the named same-project service accounts
  `roles/iam.serviceAccountUser` on this runtime identity, so a deployer can attach it
  to a Cloud Run revision. It does not grant token creation or project-wide access.

Both use additive IAM member resources. Do not manage the same role/member tuple in
another state or combine it with an authoritative IAM policy/binding for that role.
Removing an optional entry plans deletion of only the member grant owned by this
module. The repository runner currently rejects all delete actions, including IAM
grant revocation. Each consuming target must establish a separately reviewed
removal path before revoking a grant; the module alone does not authorize it.

## Interface

| Input                       | Type          | Default  | Purpose                                                                                                          |
| --------------------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `project_id`                | `string`      | Required | Owning project ID.                                                                                               |
| `account_id`                | `string`      | Required | Stable 6-30 character service account ID.                                                                        |
| `display_name`              | `string`      | Required | Nonempty service account display name.                                                                           |
| `description`               | `string`      | `""`     | Service account description.                                                                                     |
| `secret_ids`                | `map(string)` | `{}`     | Stable keys mapped to full `projects/PROJECT_ID/secrets/SECRET_ID` metadata references; no versions or payloads. |
| `deployer_service_accounts` | `map(string)` | `{}`     | Stable keys mapped to custom service account emails in the owning project, without `serviceAccount:` prefixes.   |

Choose logical map keys such as `token` and `build` that are known at plan time.
Values may reference a secret or service account created in the same apply.
Do not derive keys from computed resource IDs or emails: Terraform must know each
grant's address before applying the referenced resources. Keep keys stable during
adoption and imports to avoid replacing otherwise unchanged IAM member resources.
Each secret ID or deployer email must appear under exactly one key; duplicate
aliases would incorrectly give multiple resource addresses ownership of one IAM tuple.

Outputs are only `id`, `email`, and `member`. Pass `email` to the Cloud Run module.
Use `member` when the consuming root grants Firestore, Firebase, or other
application-specific resource access in its own later, single-target PR. Such
project/resource grants are intentionally outside this shared module.

The account has `prevent_destroy = true`. Renaming `account_id` or `project_id`
requires replacement and is blocked. Deletion also needs a separately reviewed
configuration change. This protection does not replace state access controls or
prevent deletion by an administrator outside Terraform.

## Adoption example

This is an illustrative consumer declaration, not a deployed resource instance:

```hcl
module "identity" {
  source = "../../../modules/service-identity"

  project_id   = "financial-analysis-512202"
  account_id   = "fa-example"
  display_name = "Example runtime"
  description  = "Runtime identity for one service"

  secret_ids = {
    token = "projects/financial-analysis-512202/secrets/example-token"
  }
  deployer_service_accounts = {
    build = "fa-build@financial-analysis-512202.iam.gserviceaccount.com"
  }
}
```

For an existing account, import the exact account instead of attempting to create
another identity with the same name. Match its current display name, description,
and enabled status; this module models enabled runtime accounts. Add imports for
existing member grants only when this consumer root is taking ownership of them:

```hcl
import {
  to = module.identity.google_service_account.this
  id = "projects/financial-analysis-512202/serviceAccounts/fa-example@financial-analysis-512202.iam.gserviceaccount.com"
}

import {
  to = module.identity.google_secret_manager_secret_iam_member.accessor["token"]
  id = "projects/financial-analysis-512202/secrets/example-token roles/secretmanager.secretAccessor serviceAccount:fa-example@financial-analysis-512202.iam.gserviceaccount.com"
}

import {
  to = module.identity.google_service_account_iam_member.deployer["build"]
  id = "projects/financial-analysis-512202/serviceAccounts/fa-example@financial-analysis-512202.iam.gserviceaccount.com roles/iam.serviceAccountUser serviceAccount:fa-build@financial-analysis-512202.iam.gserviceaccount.com"
}
```

Inventory existing ownership and conditional grants before writing import blocks.
These examples cover unconditional grants only. Do not import a conditional grant
as an unconditional one or take ownership of a binding managed by another root.
Review the saved consumer plan before apply; import is not permission to change
unrelated resources. This foundation PR does not import or change live accounts.

Import formats follow the pinned Google provider's
[service account](https://registry.terraform.io/providers/hashicorp/google/7.28.0/docs/resources/google_service_account),
[service account IAM](https://registry.terraform.io/providers/hashicorp/google/7.28.0/docs/resources/google_service_account_iam),
and [secret IAM](https://registry.terraform.io/providers/hashicorp/google/7.28.0/docs/resources/secret_manager_secret_iam)
references.

## Verification

Use the repository-pinned Terraform and provider lock file:

```bash
terraform -chdir=infra/gcp/terraform/modules/service-identity init -backend=false -lockfile=readonly
terraform -chdir=infra/gcp/terraform/modules/service-identity validate
terraform -chdir=infra/gcp/terraform/modules/service-identity test
```

The native tests use a mocked Google provider, require no cloud credentials, and
create no GCP resources. They check empty default grants, exact resource and role
boundaries, and invalid/cross-project inputs. Live adoption is verified separately
in each consuming service's infrastructure PR.
