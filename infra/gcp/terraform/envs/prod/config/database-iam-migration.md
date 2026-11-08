# Config database IAM administrator migration

INF-004 limits only the existing `fa-config-runtime` account's Datastore User
membership to the existing `(default)` database. The application still uses
`FIRESTORE_DATABASE=(default)`; this change creates no database, service, account,
key, API, trigger or state bucket. Firebase Auth Viewer, runtime attachment and
all other permissions remain unchanged. It does not establish collection-level
or user-level authorization; Config's authenticated owner checks remain required.

The IAM owner stays `google_project_iam_member.config_store` in the
administrator `bootstrap/` state. The `config_database_scope` module has an empty
runtime map and creates no duplicate grant. Its fixed condition is:

```text
title: database-default
expression: resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/financial-analysis-512202/databases/(default)'
description: Datastore User access limited to the exact Firestore database projects/financial-analysis-512202/databases/(default).
```

## Prepare and inspect before changing access

Use the existing administrator, the fixed merge commit of the Config-only
INF-004 PR, and the already initialized remote bootstrap backend, bucket `financial-analysis-512202-tf-bootstrap`, prefix
`bootstrap`. Follow the [administrator bootstrap setup](../../../README.md#one-time-administrator-bootstrap)
for the pinned toolchain and private variables. Do not repeat the initial
local-state bootstrap apply, create a new backend, or use the Config execution
account. Pause concurrent administrator runs while reconciling this state.

First complete and accept the earlier Market INF-002 and User INF-003
administrator migrations at their own fixed merge commits. Because these PRs can
merge before any cloud apply, the latest bootstrap source can contain three
pending runtime IAM replacements. Do not apply that accumulated plan as one
operation. After those two migrations are accepted, check out the fixed Config
merge commit, initialize its existing administrator backend, and generate a new
full saved plan. Its only changed IAM tuple must be Config's. Do not use
`-target` to conceal pending changes or drift. If the earlier migrations remain
pending, this Config migration is not ready for a target-only live apply.

Keep evidence outside Git, with private filesystem permissions. Before planning,
record the existing remote state and policy and the Config service inventory:

```bash
umask 077
INF004_EVIDENCE=$(mktemp -d)
terraform -chdir=infra/gcp/terraform/bootstrap state pull > "$INF004_EVIDENCE/state-before.json"
gcloud projects get-iam-policy financial-analysis-512202 --format=json > "$INF004_EVIDENCE/iam-before.json"
gcloud run services describe config-api --project=financial-analysis-512202 --region=northamerica-northeast2 --format=json > "$INF004_EVIDENCE/config-before.json"
terraform -chdir=infra/gcp/terraform/bootstrap state show google_project_iam_member.config_store
```

Confirm the backend identity before any state command. The evidence can contain
private infrastructure metadata; do not commit it or attach raw state/policies to
a public PR. Preserve backend versions according to the existing recovery policy.

Inspect the exact runtime member
`serviceAccount:fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com`
in the live project policy and any applicable inherited/group grants. Record all
roles that can read or write Firestore, including custom/basic roles and other
conditional or unconditional bindings. A new condition cannot cancel permissions
from another grant. A residual broad grant owned elsewhere must be reconciled by
its administrator before claiming isolation; do not alter another target here.
Stop if the service's runtime account, `(default)` configuration, expected IAM
owner or existing binding differs from this inventory.

## Reconcile the one membership's state

The Google provider 7.28.0 treats a condition change as replacement. The resource
address stays stable, but the import identity changes. The conditional import ID
includes a fourth, space-delimited field, the condition title. These facts are
specified by the pinned provider's [member schema and importer](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/tpgiamresource/resource_iam_member.go).

Choose the branch matching the inspected live binding and existing remote state:

- If the address already tracks the old unconditional member, retain it and go
  to the saved replacement plan. Do not remove the address from state.
- If that old unconditional member exists but the address is absent from state,
  first adopt exactly that old membership into the same address:

  ```bash
  terraform -chdir=infra/gcp/terraform/bootstrap import google_project_iam_member.config_store 'financial-analysis-512202 roles/datastore.user serviceAccount:fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com'
  ```

  This administrator import writes state and reads IAM; it does not narrow the
  live grant. The source's declarative import describes the final conditional
  membership and does not replace this explicit adoption of an existing old one.

- If the intended conditional member already exists and the address is absent,
  verify all three condition fields exactly, then import its conditional ID:

  ```bash
  terraform -chdir=infra/gcp/terraform/bootstrap import google_project_iam_member.config_store 'financial-analysis-512202 roles/datastore.user serviceAccount:fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com database-default'
  ```

  The declarative import supports the same final membership. A same-title
  binding with a different expression is not acceptable. If state still tracks
  the old member, retain it and review the replacement instead of overwriting
  state. If neither membership exists or ownership is ambiguous, stop and
  reconcile the inventory before an administrator authorizes any new grant.

Never rewrite state IDs, force-push an old snapshot, or use `state rm` merely to
hide the old membership. The final conditional import can succeed while a second
unconditional binding remains; imports do not remove that residual access.

## Review and apply only the administrator saved plan

```bash
terraform -chdir=infra/gcp/terraform/bootstrap plan -out="$INF004_EVIDENCE/config-iam.tfplan"
terraform -chdir=infra/gcp/terraform/bootstrap show -no-color "$INF004_EVIDENCE/config-iam.tfplan" > "$INF004_EVIDENCE/config-iam-plan.txt"
```

For the old membership, the only cloud change must be the replacement of
`google_project_iam_member.config_store` with exactly the same project, role and
member plus the fixed condition above. Its `create_before_destroy` lifecycle
orders addition of the conditional membership before removal of the old
unconditional one; the expected replacement order is `create`, then `delete`.
It does not prove IAM propagation or application availability. If the final
conditional membership is already managed, expect no IAM change or only its
reviewed import. Unrelated bootstrap changes must be reconciled separately.

Reject changes to any other target, Firebase Auth grant, runtime identity,
service, database, build/deployment permissions or trigger. There must be no
nested `module.config_database_scope.google_project_iam_member.runtime` instance.
Record explicit administrator approval for this one membership replacement,
then apply the exact reviewed plan using the same initialized backend:

```bash
terraform -chdir=infra/gcp/terraform/bootstrap apply "$INF004_EVIDENCE/config-iam.tfplan"
```

Do not send this through `terraform-plan-config` / `terraform-apply-config`, use
`-target` to hide unrelated changes, or relax normal saved-plan replacement
guards. This administrator operation is separate from the Config service's
ordinary releases. If apply fails, inspect both live memberships and the remote
state, including any deposed instance, before creating a fresh plan.

If inventory finds an additional old unconditional membership after the
conditional member is managed, remove only that exact old role/member tuple as
a separately reviewed administrator cleanup, leaving other members and grants
intact. For that one direct project binding, the explicit condition selector is:

```bash
gcloud projects remove-iam-policy-binding financial-analysis-512202 --member=serviceAccount:fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com --role=roles/datastore.user --condition=None
```

Run this only after confirming the conditional member exists and state tracks
it. Never remove an entire role binding or replace the complete policy. Inherited
or differently scoped broad permissions require their own owning administrator.

## Acceptance and recovery

After IAM propagation, use the real Config runtime identity through its server
SDK or REST calls. Verify an authenticated user's existing preferences read,
write and transaction path in `(default)`, including the current application
regressions. Record allowed access to a synthetic document in `(default)` and
`PERMISSION_DENIED` for the same identity against an existing authorized test
named database. A missing database, a `404`, the administrator's own identity,
or the Cloud console does not prove denial. Google documents that [per-database
IAM conditions are enforced outside the console](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions).
If the future private databases do not yet exist, retain their live negative
checks as pending; do not provision one in this migration just to mark them done.
Do not use real user holdings or reports in permission probes.

Re-read policy and state to prove the old unconditional member is gone, the
fixed conditional member is present, and Firebase Auth Viewer is unchanged.
Confirm unchanged Config UID, runtime unique ID, image, traffic and configuration,
then obtain a fresh no-change bootstrap plan. A local mock plan proves resource
shape only. Code delivery and live acceptance are separate: without a real
full administrator plan, do not claim target-only changes, and without the live
checks do not claim effective isolation. Completion of this checklist needs
actual administrator evidence.

If `(default)` operations regress, stop dependent private-database rollouts and
investigate propagation, SDK path and grants. When recovery is necessary, an
administrator may temporarily restore only the inventoried previous
unconditional role/member with `gcloud projects add-iam-policy-binding` and
`--condition=None`; retain the conditional grant and record this explicit loss of
isolation. Do not broaden roles or change another runtime. Reconcile state and
repeat the reviewed narrowing and acceptance before claiming INF-004 complete.
Restoring old state alone does not restore live IAM and must not be used as a
rollback. Keep recovery evidence private, then clean local plans and credentials
under the repository's existing retention rules.
