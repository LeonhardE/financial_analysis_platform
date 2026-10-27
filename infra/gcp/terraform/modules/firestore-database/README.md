# Named Firestore database

This module owns one new regional, Standard edition, Native mode database and optional TTL
fields/composite indexes in that database. It rejects `(default)`; existing database access belongs
to the separate access module and the root that owns those permissions. Adding this module's
source files creates no resources until a separately reviewed target root calls it.

The consuming root supplies the provider, enabled Firestore API, state and permissions. This module
creates no IAM grants, service accounts, keys, project APIs, secrets, security rules or service
instances. Server SDK access still requires database-scoped IAM; application user/agent isolation
must be enforced independently by the consuming service.

```hcl
module "private_database" {
  source = "../../modules/firestore-database"

  project_id  = var.project_id
  database_id = "example-private"

  ttl_fields = {
    authorization_expiry = {
      collection_group = "authorizations"
      field            = "expires_at"
    }
  }

  composite_indexes = {
    owner_created = {
      collection_group = "encrypted_results"
      fields = [
        { field_path = "owner_id", order = "ASCENDING" },
        { field_path = "created_at", order = "DESCENDING" },
      ]
    }
  }
}
```

## Contract and ownership

`project_id` is an explicit Google Cloud project ID. `database_id` accepts non-UUID named IDs of
4-63 lowercase letters, digits and hyphens, beginning with a letter and ending with a letter or
digit. Paths, wildcards and `(default)` are rejected. `location_id` defaults to Toronto
(`northamerica-northeast2`) and accepts regional location names; multi-regions are outside this
module's contract. Google validates whether a regional location actually supports Firestore.

Database settings are fixed: Native/Standard, pessimistic concurrency, App Engine integration and
point-in-time recovery disabled, API delete protection enabled, `deletion_policy = "ABANDON"` and
Terraform `prevent_destroy`. No caller switch disables these protections. Changing a database ID
or location requires a separate reviewed migration; this module does not replace an existing
database. `ABANDON` is an additional provider safeguard and does not replace `prevent_destroy`.

`ttl_fields` and `composite_indexes` default to empty maps. Stable lowercase logical map keys form
resource addresses; changing a key is an ownership migration, not a harmless display rename.
Every field/index explicitly uses this database and project, never the provider's `(default)`
fallback. Outputs expose the database ID, exact database resource name, location and schema names.

TTL entries contain `collection_group`, `field` and optional `disable_indexes` (default `true`).
One collection group may have only one TTL field. The same `google_firestore_field` resource
enables TTL and, by default, disables single-field indexes with an empty `index_config` block.
Setting `disable_indexes = false` omits that block and preserves inherited indexing; it does not
declare a competing field resource. Do not manage that same field in another module/root.
Google provider 7.28.0 enables TTL using `ttl_config {}`; expiration offsets are not supported by
this module/provider version. TTL cleanup is asynchronous and does not delete subcollections;
authorization and expiry checks must reject expired records before physical cleanup finishes.

Composite entries contain `collection_group`, optional `query_scope` (`COLLECTION` by default or
`COLLECTION_GROUP`) and 2-100 distinct `fields`. Each field specifies a simple dotted `field_path`
and exactly one of `order` (`ASCENDING`/`DESCENDING`) or `array_config` (`CONTAINS`); at most one
array field is allowed. Duplicate definitions are rejected even under different logical keys.
Indexes use `deletion_policy = "PREVENT"`; removal requires a separate reviewed change to that
guard before deletion. Vector, enterprise and arbitrary provider settings are outside this module.

Collection IDs and field paths use a deliberately simple ASCII subset: no slashes, wildcards,
quoted/escaped field paths or reserved `__...__` segments. These restrictions narrow this module's
supported input; they do not describe every identifier accepted by the Firestore API.

## Offline verification

Use the repository-pinned Terraform 1.16.7 and Google provider 7.28.0. Run `terraform fmt -check`,
backend-disabled readonly `terraform init`, `terraform validate` and `terraform test` in this
directory, or use the repository Terraform checker. Native tests use `mock_provider` and plan
only: they prove settings, scope and rejected inputs, without credentials or cloud resources.
Actual SDK/REST allow/deny smoke tests belong to the consuming target; mocked tests do not prove
live IAM enforcement.

References:

- [Firestore database IDs and database-level IAM](https://firebase.google.com/docs/firestore/manage-databases)
- [TTL behavior and field indexing](https://firebase.google.com/docs/firestore/ttl)
- [Pinned 7.28.0 database resource](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/firestore_database.html.markdown)
- [Pinned 7.28.0 field resource](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/firestore_field.html.markdown)
- [Pinned 7.28.0 composite index resource](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/firestore_index.html.markdown)
