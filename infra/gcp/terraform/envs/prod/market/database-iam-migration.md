# Market default-database IAM migration (INF-002)

This procedure is a separately reviewed administrator operation for one Market
membership. The committed change and offline tests do not apply production IAM,
prove effective isolation, or authorize an unattended bootstrap apply. No new
service, database, identity, key, API or execution target is part of this ticket.

## Exact desired boundary

- Owner remains `bootstrap/` at `google_project_iam_member.market_cache`.
- Project: `financial-analysis-512202`.
- Member: `serviceAccount:fa-api-runtime@financial-analysis-512202.iam.gserviceaccount.com`.
- Role remains `roles/datastore.user`, retaining the permissions used by the
  cache's reads, writes and transactions.
- Condition title: `database-default`.
- Expression:

  ```text
  resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/financial-analysis-512202/databases/(default)'
  ```

`module.market_database_scope` supplies metadata only; its runtime-account map
is empty and creates zero IAM resources. Do not add the Market runtime to that
map: the existing standalone resource is the sole owner of this membership.
The database itself remains outside this root's ownership. This IAM boundary
covers the database, not individual collections, documents, users or agents.

## Inventory before an authorized migration

Using an approved administrator identity, inspect the actual bootstrap backend,
its current state, and current effective IAM before producing a saved plan.
Keep state/policy/plan payloads in private storage; do not commit them or paste
credentials into a report. Record a sanitized baseline of:

1. The existing Market IAM tuple in state and the live project policy, including
   any condition, condition title, full expression and description. Detect
   duplicate state ownership and any authoritative policy/binding manager.
2. Every other grant that could give this runtime Firestore access, including
   inherited project/folder/organization roles and group membership. Adding a
   narrow condition does not subtract permissions granted elsewhere. A residual
   broad grant blocks isolation acceptance; removal outside the one known
   Market tuple needs its own reviewed owner-specific action.
3. Market service UID, immutable image, desired/observed traffic, runtime email
   and relevant cache behavior. Inventory User/Config/Web permissions so the
   migration cannot accidentally change another runtime.

Do not assume the earlier adoption report establishes the current state or IAM
policy. It is historical evidence bound to its recorded source hashes.

## State and import handling

The pinned Google provider treats IAM condition content as part of membership
identity and replaces a membership when the condition changes. Keeping its
Terraform address does not turn the operation into an in-place IAM update.
`create_before_destroy = true` requests the conditional tuple before removing
the old unconditional tuple; isolation remains incomplete until the old tuple
and any other broad grants are gone. Inspect actual ordering and actions in the
fresh saved plan, and account for IAM propagation during verification.

The declarative import now names the desired conditional tuple:

```text
financial-analysis-512202 roles/datastore.user serviceAccount:fa-api-runtime@financial-analysis-512202.iam.gserviceaccount.com database-default
```

Changing an import ID does not re-import or rewrite an already managed state
object. Choose the path based on the inventoried state and actual policy:

- **Old unconditional tuple already managed at the correct address:** retain
  that state. Plan the reviewed replacement at the same address. Do not use
  `state rm`, retarget another resource, or remove the broad tuple manually
  while Terraform still owns it.
- **State does not own the tuple, and only the old unconditional tuple exists:**
  the desired conditional import must fail rather than pretending the old tuple
  is already narrow. After separate authorization for state adoption, import
  the old tuple explicitly at `google_project_iam_member.market_cache` using
  the three-part ID below, then inspect a new full saved plan. This imports
  state only; it does not narrow IAM:

  ```text
  financial-analysis-512202 roles/datastore.user serviceAccount:fa-api-runtime@financial-analysis-512202.iam.gserviceaccount.com
  ```

- **Exact conditional tuple already exists and needs state recovery:** use the
  four-part desired ID and inspect the imported expression/description, not
  merely its title. Multiple matching titles, extra broad tuples or conflicting
  state ownership require investigation before applying.
- **Both tuples exist or an interrupted replacement left deposed state:**
  inspect both policy and state, then review a fresh plan for the specific
  remaining action. Neither an import nor a narrow tuple proves the broad
  permission was removed. Do not replay the failed saved plan or run a blanket
  destroy/state-removal operation.

## Administrator plan and rollout boundary

Use the pinned toolchain and actual administrator bootstrap backend. Pin source
to the reviewed **INF-002 merge commit**, with its matching modules and lockfiles;
do not silently substitute the latest branch head. Review a **full bootstrap
saved plan**, without `-target`,
against current remote state. Once existing resources are correctly adopted,
the only expected mutating resource is
`google_project_iam_member.market_cache`: the old unconditional tuple is replaced
with the fixed conditional tuple (or no-op if already migrated).

Reject service/database creation or replacement, changed execution boundaries,
changes to another runtime/member/role, unrelated IAM actions, and unexpected
imports. Any prerequisite drift or missing adoption must be resolved separately;
never approve a broader plan simply because it includes this permission change.
The scope-only module must introduce no resource actions.

INF-002, INF-003 and INF-004 remain separate target changes even if their source
PRs merge before any administrator migration. Latest bootstrap source may then
contain three pending IAM replacements. Do not apply them together or use
`-target` to hide shared-state drift. Apply in order: approved INF-002 saved plan
from its fixed merge commit, verify it and current state, then separately plan and
approve INF-003 from its fixed merge commit, and finally INF-004. If a preceding
migration is not actually applied, the later full plan cannot be described as
current-target-only. Stop and resolve that ordering before requesting approval.
At source-delivery time no administrator apply has run; all live acceptance below
remains pending. Reusing an earlier saved plan after source/state changes is not
part of this procedure.

The normal Market runner lacks IAM administration and rejects deletion and
replacement, including create-before-destroy. Its shared guard and controller
exception remain unchanged. This bootstrap migration requires a separately
approved administrator saved-plan/apply path. Do not register bootstrap as a
business target, grant the Market execution identity setIamPolicy, disable the
guard, or use a normal service release as the migration mechanism. Merging the
PR alone does not execute this step. No cloud write is needed for code review.

## Verification and remaining acceptance

Offline module/bootstrap mock tests validate the literal condition, unchanged
member/role/address and empty module grant map. The unchanged Market root still
explicitly configures the SDK database as `(default)`.
A regression test keeps IAM replacement outside the ordinary Market runner.
Mocks do not exercise IAM authorization or the real provider's replacement RPCs.
The existing `verify_market_adoption.py` checks the historical initial no-op
adoption and deliberately rejects IAM mutations; do not widen it for this change.

After an authorized administrator migration:

1. Read back current policy/state and prove the exact conditional tuple is
   managed once, the unconditional tuple is absent, and no inherited/additive
   permission still gives the runtime broader Firestore access.
2. Through the actual Market runtime identity, verify existing `(default)`
   reads/writes and transaction behavior. Prefer a dedicated synthetic cache
   record and remove only that record; do not mutate real user data or increase
   upstream-provider traffic merely to test IAM. A cached HTTP response alone
   does not prove the service contacted Firestore.
3. Confirm service UID, image, runtime, traffic and other services' IAM are
   unchanged, then require a clean bootstrap plan. The Market business root
   should remain unchanged and its normal plan should remain clean.
4. Once a separately authorized Portfolio/Hub named database actually exists,
   test SDK/REST reads and writes against that real resource using the Market
   identity using approved synthetic document paths and require explicit permission
   denial. Stop and inspect any unexpected success; clean only an accidentally
   created synthetic record after its own authorization.
   A nonexistent database's 404 is not evidence of isolation. Until those
   resources exist, record cross-database live denial as pending; do not create
   a database solely to complete this ticket under a no-new-resource constraint.

Firestore Console behavior is not a substitute for SDK/REST IAM checks. Record
source revision, state/backend identity, reviewer, sanitized action list,
post-policy evidence and each acceptance result without exposing private plans.

## Rollback

If default-database reads/writes or transactions fail, stop further changes and
inspect the exact deny/propagation evidence. An approved rollback may restore
only this runtime's previous membership at the same administrative address;
review its full fresh saved plan. That temporarily reintroduces broad database
access, so isolation acceptance is no longer satisfied. Do not expand User,
Config or other services' roles, change browser Security Rules to bypass server
IAM, replace the runtime/service, or delete a database to troubleshoot.
If replacement was interrupted, reconcile the actual state and existing tuples
before choosing rollback; replaying a prior plan can remove the wrong condition.

## Primary references

- [Firestore per-database IAM and verification caveats](https://firebase.google.com/docs/firestore/manage-databases)
- [Supported IAM resource type/name attributes](https://docs.cloud.google.com/iam/docs/conditions-resource-attributes)
- [Pinned provider conditional IAM import and identity](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/google_project_iam.html.markdown)
- [Pinned provider condition replacement/import implementation](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/tpgiamresource/resource_iam_member.go)
