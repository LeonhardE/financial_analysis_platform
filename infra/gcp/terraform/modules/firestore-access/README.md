# Firestore database access scope

This module exposes one internally fixed Firestore database IAM condition and,
optionally, additive Datastore User membership for explicitly selected runtime
service accounts. It neither creates nor discovers a database, service account,
API, project or execution identity. No production root instantiates it in this
foundation change.

## Interface

| Input                      | Meaning                                                                              | Default  |
| -------------------------- | ------------------------------------------------------------------------------------ | -------- |
| `project_id`               | The database and runtime accounts' project ID                                        | Required |
| `database_id`              | Exact named database ID or `(default)`                                               | Required |
| `runtime_service_accounts` | At most ten stable logical keys mapped to same-project custom service account emails | `{}`     |

| Output                   | Meaning                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `database_resource_name` | `projects/<project>/databases/<database>`                                                 |
| `condition`              | Internally derived `{title, description, expression}`                                     |
| `grants`                 | Additive membership metadata under the same stable logical keys; empty for scope-only use |

Named database IDs follow the database module's 4–63-character constraint and
reject UUID-like names. Inputs cannot select arbitrary roles, CEL expressions,
resource paths, wildcards, IAM member prefixes, human principals, Google service
agents or cross-project runtime accounts. Role is fixed to `roles/datastore.user`.
The condition requires both:

```text
resource.type == 'firestore.googleapis.com/Database' &&
resource.name == 'projects/<project>/databases/<database>'
```

The default database title is `database-default`; named titles use
`database-named-<id>`, so the named ID `default` never aliases `(default)`.
`google_project_iam_member.runtime` is incremental member IAM, not an
authoritative binding or project policy. It changes no unrelated members.

## Scope-only adoption

Omitting `runtime_service_accounts` creates **no IAM resources** and still
returns the database condition:

```hcl
module "user_database_scope" {
  source = "../../../modules/firestore-access"

  project_id  = var.project_id
  database_id = "(default)"
}
```

A later User/Market/Config infrastructure PR can reference the condition output
from its existing IAM resource address instead of declaring duplicate module IAM.
Preserving a Terraform address does not promise the provider will avoid replacing
the old unconditional membership: inspect that target's complete saved plan,
imports and permission-removal path. Adding a conditional grant does not remove
other unconditional or inherited project/organization grants; those still grant
their combined permissions until explicitly removed in the owning target PR.

For a new target, explicit stable keys permit an email that is computed by a
newly created service account without making IAM resource addresses unknown:

```hcl
runtime_service_accounts = {
  runtime = module.runtime_identity.email
}
```

Use only one owner resource for a given project/role/member/condition membership.
Do not both preserve an existing standalone grant and create the same grant
through this module. There is no service account key or credential payload.

## Authorization and verification boundary

This is a database-level IAM scope. It does not establish collection/document,
owner, tenant or agent authorization and is not a Firestore Security Rules
module. Server SDK consumers still require verified identity, owner partitioning
and current grants/fences in their application. It does not encrypt stored user
content or create content-decryption permissions.

Mock plans verify only the resource shape, exact CEL string and fixed role/member
binding. They cannot prove effective live authorization. Each later target
adoption must inspect all inherited/additive grants and test the actual SDK with
its runtime identity: allowed operations in the selected database and denial in
another database. Test the default and named database paths the consumer uses.
Google documents that the Cloud console does not allow or deny database access
using these per-database IAM conditions; enforcement applies outside the console,
such as REST and client libraries. Console behavior is therefore not proof of SDK
isolation. The module grants no project-wide list/admin role to make a Console
view work. See the [official database-access boundary](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions).

## Local checks

Use repository-pinned Terraform 1.16.7 and Google provider 7.28.0. The committed
lockfile matches the other modules. Backend-disabled initialization, validation
and `terraform test` use mocked providers and require no cloud credentials.
The computed-email fixture demonstrates a plan with a new service account's
unknown email and a known logical IAM key; it does not create an account.
Actual resource provisioning and IAM migration remain separate target PRs.
