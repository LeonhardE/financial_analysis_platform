# User default-database IAM migration

This is an administrator-owned migration in `bootstrap/user.tf`. It changes only
`google_project_iam_member.user_cache`, retaining its Terraform address, role
`roles/datastore.user` and member
`serviceAccount:fa-user-runtime@financial-analysis-512202.iam.gserviceaccount.com`.
The existing grant becomes conditional on both:

```text
resource.type == 'firestore.googleapis.com/Database' &&
resource.name == 'projects/financial-analysis-512202/databases/(default)'
```

The shared `user_database_scope` module exposes that condition with an empty
member map. It owns no second IAM grant and creates no database, account or
service. Firebase Auth Viewer, image publishing, execution roles, Cloud Run
configuration, image and traffic remain under their existing owners. User still
shares `(default)` with the other existing services; this does not provide
collection, user or agent isolation inside that database.

## Inventory and safe state adoption

Run the existing-runtime migrations in ticket order. Before User, complete and
accept the INF-002 Market administrator migration. Pin the administrator checkout
to this User ticket's reviewed merge commit, record that full commit, and generate
a new User migration plan only after the predecessor's state and live checks are
accepted. A later `main` can include pending User, Market and Config IAM changes;
a full plan from that source is not a User-only plan. Do not apply all pending
runtime migrations together. Use the appropriate reviewed source commit and
reconcile predecessor state instead of hiding changes with `-target`.

Use the existing administrator checkout, pinned Terraform 1.16.7 / Google 7.28.0,
existing `bootstrap` remote backend and reviewed variables. Do not initialize a
new local state against deployed resources. Quiesce administrator IAM edits and
bootstrap execution, record the source commit and preserve a private state/policy
snapshot under the existing recovery procedure. Do not commit snapshots, plans or
raw IAM policies.

Before planning, confirm the live User service still uses `fa-user-runtime` and
`FIRESTORE_DATABASE=(default)`. Record its UID, image digest, traffic and runtime
identity so the post-migration checks can compare them. Inventory the runtime's
effective IAM at project, folder, organization and group membership boundaries,
including custom roles, basic roles and other conditions that permit Firestore
access. A conditional membership does not override another broad membership.
Keep all other principals' bindings intact; removing residual User access from an
independent owner requires its own explicit administrator review.

Inspect the existing address:

```bash
terraform -chdir=infra/gcp/terraform/bootstrap state show google_project_iam_member.user_cache
```

Choose the matching state situation; stop on any different project, member,
role, duplicate owner or ambiguous condition title:

- **The old unconditional grant is already tracked at this address.** Keep the
  address and state entry. The updated configuration plans a member replacement
  with `create_before_destroy`: establish the conditional tuple first, then
  remove this member from the old unconditional binding. Do not `state rm`, move
  it into the module or add a second Terraform owner.
- **The address is missing, and the old unconditional grant exists.** Import that
  exact old tuple into the same address before generating the migration plan:

  ```bash
  terraform -chdir=infra/gcp/terraform/bootstrap import google_project_iam_member.user_cache 'financial-analysis-512202 roles/datastore.user serviceAccount:fa-user-runtime@financial-analysis-512202.iam.gserviceaccount.com'
  ```

  This import records ownership in the existing administrative state; it does
  not alter cloud IAM. The next plan must explicitly show creation of the
  conditional tuple followed by removal of the old unconditional tuple. Never
  import a nonexistent conditional membership to hide the broad grant.

- **The conditional tuple is already deployed, and this address is missing.**
  First verify the old unconditional tuple and other residual broad User grants
  are absent. Import the exact conditional tuple, including its condition title:

  ```bash
  terraform -chdir=infra/gcp/terraform/bootstrap import google_project_iam_member.user_cache 'financial-analysis-512202 roles/datastore.user serviceAccount:fa-user-runtime@financial-analysis-512202.iam.gserviceaccount.com database-default'
  ```

  The committed declarative import uses this same conditional identity. After
  import, compare the complete title, description and expression with the module
  output; a title by itself is not a scope guarantee. A matching tuple should
  produce no IAM change.

If neither tuple exists, stop and reconcile the missing production permission
before treating this as a narrowing migration. Do not apply the bootstrap as an
empty-state first provisioning exercise.

## Administrator saved-plan review

IAM condition contents are part of the provider's resource identity. Adding a
condition therefore replaces this IAM membership even though its Terraform
address is preserved. This resource uses `create_before_destroy`: the new
conditional membership is added before this member is removed from the old
unconditional binding. The provider distinguishes the two by their complete
condition contents, so removal of the old tuple preserves the new tuple. During
this short overlap the old broad permission still applies; narrowing is complete
only after its removal and the residual-access checks. If deletion fails, stop
and reconcile the pending old/deposed tuple; a successfully created conditional
tuple alone does not establish isolation.

The normal target runner deliberately rejects IAM revocation/replacement and has
no project IAM administration permission; do not
relax its action guards or grant it extra permissions for this migration.

As the existing administrator, initialize the existing backend, create a saved
bootstrap plan at the recorded User merge commit, and inspect the complete plan
and its JSON privately. With INF-002 already accepted, expected cloud actions are
only the `user_cache` unconditional-to-conditional replacement
(or no change if it is already migrated). Stop if another target, a database,
service, identity, trigger, bucket, image or traffic appears as a change. No
`-target` shortcut, global policy replacement or broad role restoration is part
of this migration. For the old unconditional state, the saved JSON plan must show
`["create", "delete"]` for this address, preserving the role/member and changing
only the database condition; reject a delete-first order or an unrelated change.

The administrator reviews and applies only that exact saved plan through the
existing administrator process. The repository's merge and normal service
release do not apply bootstrap IAM. Creating the narrower tuple first avoids
an intentional permission gap, but IAM propagation is asynchronous; this ordering
does not promise uninterrupted access or immediate revocation. Choose a suitable
rollout window and keep the recorded recovery evidence. Replan after apply and
require no remaining changes or pending old/deposed membership.

## Live acceptance and rollback

The mocked configuration tests prove the desired condition, fixed User member,
empty scope-only grants and unchanged Firebase Auth Viewer. They do not prove
live IAM enforcement or absence of inherited access.

After the administrator apply, use a controlled synthetic account/document path
through the actual User runtime identity to verify existing watchlist reads,
writes, deletes and transaction conflict handling in `(default)`. Preserve
Firebase revoked/disabled-user verification, authenticated owner isolation and
anonymous private-route rejection. Do not use personal holdings, private reports
or another user's documents for these checks. Compare the recorded service UID,
image, traffic and runtime identity; none should change.

Independently confirm the old unconditional User tuple is gone and no other
broad grant supplies access to other databases. Once the real portfolio and Hub
databases exist, verify the User runtime receives `PERMISSION_DENIED` for reads,
writes and transactions in each while `(default)` continues working. A missing
database error or a Console view is not this negative test. Until then, record
cross-database denial as pending; do not create a database merely to complete
this ticket's test.

If access fails, stop subsequent database provisioning and inspect the exact
condition, selected database, runtime identity and residual permissions. Prefer
repairing the conditional grant. Any emergency temporary return to the previous
unconditional **User-only** tuple requires an explicit administrator review and
saved plan, followed by removing that temporary broad access after repair. Do not
restore another service's grant, widen all runtimes, restore a whole IAM policy,
or create service-account keys. Restoring a Terraform state snapshot alone does
not roll back cloud IAM. After any rollback, reconcile the import identity,
remote state and live policy before the next plan.

References:

- [Firestore database access conditions](https://firebase.google.com/docs/firestore/manage-databases#configure_database_access_conditions)
- [Google provider 7.28 project IAM identities and imports](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/google_project_iam.html.markdown)
- [Google provider 7.28 IAM member import and ForceNew schema](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/tpgiamresource/resource_iam_member.go)
