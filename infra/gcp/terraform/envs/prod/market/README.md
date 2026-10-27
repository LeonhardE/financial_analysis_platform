# Adopt the existing Market service

This root adopts only the existing `market-api` in Toronto and its existing
`fa-api-runtime` identity. It uses the shared guarded configuration controller;
image publication and explicit traffic rollback retain their existing owners.
User, Config and Web are outside this root and remain disabled Terraform targets.

## Ownership and imports

| Resource                                                      | Owner                                              | Adoption                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `market-api` identity and runtime configuration               | This root, `module.market`                         | Import the existing full service ID; retain UID `9c834402-c8d5-4c71-82d9-1a705e335f02`               |
| `fa-api-runtime` metadata                                     | This root, `module.runtime_identity`               | Import the existing enabled service account; no new identity or key                                  |
| Market execution accounts, state bucket and approval triggers | Administrator `bootstrap/` state                   | Create only the Market execution boundary after review                                               |
| Existing Market image trigger and IAM grants                  | Administrator Market configuration in `bootstrap/` | Import the existing trigger and individual grants; retain trigger ID and shared `fa-build` account   |
| Configuration executor's existing-image access                | Administrator Market configuration in `bootstrap/` | Grant only artifact download on the existing Toronto `financial-analysis` repository to Market apply |
| Image, release markers, revision selection and traffic        | Existing image-release helper / explicit rollback  | Never imported as desired release state                                                              |
| Existing Firestore database and other services                | Existing owners                                    | No creation, import or data migration here                                                           |

The two declarative blocks in `imports.tf` stay in the root after adoption.
Existing imported resources must plan as `no-op`; any service/account create,
delete or replacement is a stop condition. Native deletion protection and
`prevent_destroy` also remain enabled. The native service resource ignores later
updates: configuration changes run through the conditional controller, never the
provider's full-template update path.

The registered backend is `financial-analysis-512202-tfstate-market`, prefix
`prod/market`. The pipeline supplies these backend settings; no operator variable
files or local backend credentials belong in this directory. The pinned
Terraform/provider and provider lock match the repository toolchain. Provider
attribution labels are disabled so import does not introduce an unrelated label.

## Preserved configuration and first apply

The reviewed inventory has one HTTP container on port `8080`, request-based
one-vCPU billing, `512Mi`, startup CPU boost, timeout `300s`, concurrency `80`,
revision minimum `0` / maximum `12`, seven existing nonsecret environment values
and no secret references. The service-wide maximum is separately `2`. These
existing values are preserved rather than combined with a capacity or cost-tuning
change; scale-to-zero remains available, but neither maximum is a spending cap.

The API currently represents one CPU as `1000m`, while the shared controller
requires the equivalent value `1`. **The first approved controller apply therefore
creates a configuration revision to normalize that CPU representation.** This is
not a service recreation. It must preserve the existing service UID, live image,
traffic route and release markers. Afterward, verify the API returns CPU `1` and
the next plan is clean. Stop and inspect a failed verification rather than
repeatedly applying it. Raw state, plans and environment-bearing inventory remain
private; public evidence must use an explicit sanitized field allowlist.

The first authenticated configuration apply exposed an additional Cloud Run
requirement: the caller needs `artifactregistry.repositories.downloadArtifacts`
when validating a template PATCH, even if its image is unchanged. Bootstrap now
grants that single permission only to `fa-infra-market-apply`, on the existing
Toronto `financial-analysis` Artifact Registry repository. It grants no image
upload/deletion, repository administration, build submission, or project-wide
artifact access. The repository is shared, so this read boundary includes other
images stored in that repository; it is not an image-path-specific grant. Market
plan and other service execution identities receive no such grant here.

A failed apply can already have recorded the two imports while leaving the local
configuration controller tainted. After fixing a verified permission failure,
review a fresh saved Market plan and use the normal approval flow; never recreate
the imported service or replay the failed saved plan.

The immutable image input is only the required creation-time contract, resolved
from the inventoried image digest. Editing it is not a release and adoption does
not roll back to that digest. Apply reads the current live image with a fresh
etag. The controller is registered as
`module.market.terraform_data.configuration`; its creation or narrowly allowed
replacement changes configuration without replacing the native service.

## Existing public access and observed boundaries

Market currently uses `INGRESS_TRAFFIC_ALL` and `invokerIamDisabled=true` for
public browser access. Its IAM policy does not contain an `allUsers` invoker
grant. `allow_unauthenticated=false` here means **do not create a new IAM member**;
it does not turn this imported service private. Native ignore rules and the
controller's update mask preserve the existing invoker-check setting.

`data.google_cloud_run_v2_service.market_boundary` independently checks the
existing UID, disabled invoker IAM check and service-wide maximum of `2` during
planning, so a missing/replaced service fails before any native create could run.
The shared controller owns revision scaling, not the service-wide cap or this
public-access switch. Those boundaries are observed rather than automatically
repaired; a changed boundary fails verification and needs a separate reviewed
change. This PR does not extend shared ownership or add public IAM permissions.

## Rollout and acceptance

Merging this PR does not authorize an unattended infrastructure apply. Follow the
[target execution workflow](../../../README.md) using only the Market target:

1. Review an administrator bootstrap plan against the existing remote state.
   Adopt the existing Market image trigger/IAM grants and provision only Market
   execution permissions, accounts, state and triggers. Keep the existing image
   trigger and its `_DEPLOY_SERVICE=true` behavior; do not grant normal Market
   execution permission to submit arbitrary builds or act as shared `fa-build`.
2. Run a fresh `terraform-plan-market` from merged `main`. Review the exact saved
   plan and the two imports. The expected business-root actions are the two
   imports with no native changes, creation of the local configuration controller
   and its ordered configuration verification read. The independent boundary read
   must already pass. Reject any unexpected resource action.
3. Request `terraform-apply-market` with that producing build ID, review its
   source and target, and give native approval. Verify unchanged service UID,
   image, desired/observed traffic and release markers; the CPU normalization may
   add one configuration revision. Re-run plan and require no resource changes.
4. Verify ordinary image publication through the existing Market build trigger,
   then a deliberate rollback to a known immutable revision. Require a clean
   Market plan after each and confirm a subsequent approved configuration apply
   preserves pinned rollback traffic. Do not run production release/rollback
   drills until that rollout is explicitly approved.

The [guarded ownership protocol](../../../compatibility/README.md) has isolated
live coverage. This consumer still needs its own post-merge authenticated apply
and release/rollback acceptance; a read-only import plan does not claim that those
production operations already succeeded. No production apply or release is
performed merely to prepare this PR.

Mocked root tests and the repository's standard checks require no cloud
credentials. Authenticated read-only validation should use private temporary
state and plans, never the production backend or a copy committed to Git. Keep
Market application behavior and the other services' deployment fingerprints
unchanged during adoption.

## Database IAM narrowing (INF-002)

The desired administrator-owned `google_project_iam_member.market_cache` now
uses a fixed condition limiting `fa-api-runtime`'s existing Datastore User role
to `projects/financial-analysis-512202/databases/(default)`. A scope-only module
produces the condition without creating a second grant or managing the database.
The application still explicitly selects `(default)`; this changes no image,
service configuration, runtime identity, traffic or database contents.

This is a source change, not evidence that production IAM has been narrowed.
Follow the [administrator migration and acceptance procedure](database-iam-migration.md).
Its IAM replacement cannot run through the ordinary Market execution guard.
The historical read-only adoption verifier and report below describe the earlier
unconditional import; they do not validate or authorize this later migration.

## Read-only verification for this adoption

```bash
python3 infra/gcp/verify_market_adoption.py --live --terraform /absolute/path/to/terraform --report /private/path/to/new-market-report.json
```

The [source-bound result](adoption-readonly-results-2026-10-23.json) passed with
Terraform 1.16.7 / Google provider 7.28.0. The verifier downloaded the existing
administrator state to a private local copy and used an empty private local state
for Market. It created no remote state, locks, resources or revisions.

- Historical administrator plan: four existing Market imports with no changes,
  plus 25 additions for Market's execution boundary, scoped roles and grants. The
  later authenticated apply exposed the image-read requirement described above;
  its role and repository member add two resources, bringing the fresh-adoption
  bootstrap allowlist to 27. The linked historical result retains its original
  source hashes and count. All existing repo resources remain no-op.
- Market plan: existing service and runtime imports with no native changes;
  only the built-in configuration controller is created, followed by its data read.
- Live before/after snapshots of all four production services, Market IAM/runtime
  and image trigger were identical. Remote administrator state generation was unchanged.
- In-memory controller analysis confirms that the first CPU-normalization revision
  retains the live image, etag and release annotations, and excludes traffic and
  invocation-mode fields. This is analysis, not a production apply or rollback drill.

The image trigger stays in administrator state because its write permission also
permits build submission ([Cloud Build IAM](https://docs.cloud.google.com/build/docs/iam-roles-permissions)).
Raw evidence stays private; the checked-in result exposes only reviewed identifiers,
actions, hashes and checks. The recorded source hashes identify the tested code,
including uncommitted source on the recorded base commit.
