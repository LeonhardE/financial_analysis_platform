# Web deployment instance configuration

This root adopts the selected existing `market-web` and its dedicated runtime
identity into isolated Web state. It accepts an explicit `deployment` input
compiled from the selected target-instance-v1 projection; no author project,
region, account, UID or image is a production default.

The six required fields are `project_id`, `region`, `artifact_repository`,
`runtime_account_id`, `creation_image` and `existing_service_uid`. Unknown/missing
fields, runtime emails in place of account IDs, invalid UUIDs, mutable image tags
and images outside the selected project/region/repository/Web path fail closed.
The schema remains a closed string map; no generic environment or secret map is
accepted. This input alone does not grant authority to create a missing service.

## Ownership and retained boundaries

- The Web root owns its runtime metadata and declared Cloud Run configuration.
  Native imports select that project/region/account and `market-web`; independent
  reads fail if the service UID, public invocation mode or service-wide maximum
  of two changes. `prevent_destroy` and native `ignore_changes = all` remain.
- Revision scaling remains 0–12, service-wide maximum two, with the existing
  memory, concurrency, timeout and startup settings. No allUsers grant is added;
  public invocation continues to use `invokerIamDisabled=true`.
- The image pipeline owns images, revision names and traffic. The configuration
  controller reads current release fields and preserves rollback traffic. The
  digest input is creation-only, not a request to reset a live image.
- Bootstrap owns Web execution identities/state/approval and existing additive
  grants. Its Web runtime, Artifact Registry reference and image-trigger UUID
  come from `deployment_configs["web"]`. It does not adopt the shared build SA.
- All nine browser-public Firebase/API substitutions come from that projection's
  restricted `build` object. No new build key, runtime environment, private key,
  Firebase provider or browser database permission is introduced. Optional
  User/Config origins retain their existing migration behavior; a usable Market
  API origin is still required for the actual Web image build.

The existing Web image trigger remains a native target-owned resource because
its exact substitution set omits `_DEPLOY_SERVICE`. Its source/main branch,
filters, disabled=false and normal deployment behavior are retained. Missing
region/repository values no longer fall back to the author's YAML defaults;
existing reviewed trigger substitutions provide them explicitly.

## Private inputs and reviewed execution

Use the [shared compiler](../../../../deployment-profiles/README.md) after its
foundation is merged:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile .deployment/profile.json \
  --target web \
  --output-dir .deployment/web-review
```

The four candidate files are private and unapproved. The generated
`terraform-inputs.candidate.json` contains exactly `{"deployment": inputs}`;
local reviews pass it explicitly with `-var-file`, with an independently selected
backend. Operator profiles, plans, state and account inventories must stay out of
Git. Do not put a tfvars file in the root for the remote runner to discover.

For administrator bootstrap, use the full compiler's `bootstrap-inputs.candidate.json`
as reviewed explicit input so `deployment_configs["web"]` is present. Bootstrap
binds Web to that project/region/repository, its adopted image-trigger UUID and
exactly nine public build keys. The static catalog opts only Web into `trigger-v1`.
Plan/apply read actual server Build/Trigger metadata and reject missing or
invocation-overridden pins; no private local file is implicitly inherited.

Review a complete administrator plan against existing identities and state.
The migration adds the Web trigger configuration pins; it must not create/delete
resources, migrate a database, change grants or alter the current public build
settings. Existing state addresses and image/configuration ownership stay intact.
Apply only through the separately authorized administrator procedure. Source
merge and candidate generation do not establish cloud acceptance.

After the managed triggers have the reviewed pins, run `terraform-plan-web` from
trusted main. Review source/projection/input hashes, exact UID/backend/state,
private saved plan and action summary, then request the corresponding natively
approved `terraform-apply-web`. Apply uses only that saved binary. Configuration
repair still requires a fresh explicit controller-replacement plan; never reset
state, recreate `market-web` or replay a stale plan to recover.

Plan may read the existing Web service/runtime. Apply may update that service,
maintain the selected runtime metadata, attach only that runtime and download
images only from the selected existing Artifact Registry repository. There is
no upload/delete/repository administration, database permission or IAM editing
added by this migration.

## Offline verification

Native mock-provider tests plan two unrelated synthetic projects/regions, retain
the three UID/public-mode/service-cap failures, and reject missing/extra inputs,
wrong-project images, mutable tags, runtime emails and invalid UID values.
Bootstrap tests check all nine selected build values and reject unexpected keys
or a mixed build region. Mocks use no backend, credentials or GCP API calls.
The frontend source contains no author-instance fallback; localhost development
and explicit combined-API migration routing are unchanged, with no UI change.
