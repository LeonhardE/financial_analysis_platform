# Portfolio first-provision preparation

This is a single-target infrastructure configuration with inactive normal execution. `pipeline.json` registers
`portfolio` with `enabled=false`; administrator bootstrap defaults
`portfolio_provisioning_stage=none`. Merging this preparation creates no resources and does not
activate target plan/apply triggers. Merging image/configuration updates does not perform an apply. Already-applied administrator
stages must remain selected in administrator variables. A saved plan is review material, not
permission to apply it.

## Ownership and boundaries

- The Portfolio business root owns `fa-portfolio-runtime`, the `portfolio` named Firestore database
  and `portfolio-api`. The shared Cloud Run module uses an immutable creation image, preserves
  release-owned images/traffic after creation, and checks configuration through its existing
  controller. This is first creation, so there is no adoption data source that reads a missing
  service. Do not import another target's identity or database.
- Administrator bootstrap owns only this target's execution bucket, plan/apply/build identities,
  triggers, IAM and deny-all client Rules. Execution keeps the stable
  `module.target_execution["portfolio"]` address before and after registry activation.
- Normal plan can read service/runtime/DB metadata. Normal apply can update only that service's
  configuration, that runtime's metadata/enabled state and that database's metadata, attach only
  its runtime, and download existing images from the existing repository. It cannot create/delete
  services/databases/identities, administer IAM/Rules, read entities or use another target's state.
  Apply also has `datastore.operations.get` under the same exact-database condition to poll the
  operation returned by a database configuration update; plan remains metadata-only. No operation
  listing, cancellation, or deletion is granted. Index/TTL permissions are deferred until an
  implemented schema requires them.
- Runtime `roles/datastore.user` is conditioned on the exact
  `projects/financial-analysis-512202/databases/portfolio` database. Other-runtime denial tests
  occur against the real database immediately after creation, before real private data.
- Client SDKs get a separately published `cloud.firestore/portfolio` deny-all Rules release.
  Server SDK IAM is independent of client Rules. Actual publication plus anonymous/Firebase client
  denials must be verified at first provisioning; native plans do not prove live enforcement.
  Verify both boundaries before exposing data.
- Cloud Run remains private: there is no `allUsers`/invoker grant. The skeleton has no holdings or
  authentication implementation. Public application invocation belongs to a later authenticated
  API change. `min_instances=0`, per-revision `max_instances=1`, concurrency 8, timeout 60 seconds,
  one vCPU/256Mi and no startup CPU boost bound initial capacity. The per-revision maximum is not
  a global service-instance limit or an absolute billing cap.
- The dedicated build identity publishes into the existing shared Artifact Registry repository.
  Its repository-level writer role covers that whole repository, not only the Portfolio image path;
  trigger/source review is essential, and this is not an image-level IAM isolation claim. It gets no
  Cloud Run deployer/runtime attachment permission while build-only.
- No secret, content key, brokerage credential, KMS resource or backend decryptor is configured.
  The database initially has no documents, TTL or composite indexes; POR-002 must define actual
  encrypted storage, ciphertext index exemptions, metadata queries and retention before content
  is admitted. Do not infer E2EE product acceptance from infrastructure preparation.

## Offline validation

Use the checksum-pinned Terraform 1.16.7 and Google provider 7.28.0 toolchain:

```bash
terraform init -backend=false -lockfile=readonly
terraform validate
terraform test
```

The target tests and administrator `tests/portfolio-preparation.tftest.hcl` use complete native
provider-mocked plans, covering inactive defaults, execution/service staging, permission scope,
client Rules, and rejection of mutable/other-target images. These are not real IAM/Rules tests.

For a read-only native creation preview, copy the repository to a private temporary directory,
replace only this root's empty GCS backend declaration with a local backend, and initialize that
copy with `-lockfile=readonly`. Use the checked-in creation-only digest candidate and save the complete plan without `-target`;
`terraform.tfvars.example` documents the same nonsecret candidate, not an extra runner input. Do not initialize a nonexistent remote bucket or apply a preview.
The current example pins the audited target-trigger artifact described below; a local preview
still grants no cloud apply approval. The former manual artifact was replaced only after
official resolved-source and registry checks passed. Review native plans separately from
provider-mocked tests, and retain sanitized actions/hashes in local-docs.

## Future authorized creation sequence

Each stage requires its own reviewed complete saved plan and explicit resource authorization.
Keep normal execution disabled until acceptance; retain already-applied administrator stage
inputs rather than resetting them to the code default `none`.

1. Recheck inventory, project APIs, actual bootstrap backend/state, service-account and database
   name availability, and legacy runtime IAM. Rules publication requires
   `firebaserules.googleapis.com`; this preparation does not enable APIs. Use the existing Toronto
   connected repository, Artifact Registry and project. Capture a fresh bootstrap baseline.
2. **Execution stage:** use administrator bootstrap with
   `-var=portfolio_provisioning_stage=execution`. Its complete plan adds only Portfolio execution
   boundaries and a dedicated build-only identity/trigger. Service/runtime/DB-scoped grants and
   Rules are absent, so it does not depend on missing business resources. This stage must be
   created before a trusted target-trigger build can supply first-provision provenance.
3. Run the actual main-only `build-portfolio-api` trigger with `_DEPLOY_SERVICE=false` and capture
   its output-only resolved source/build/trigger/image metadata. Validate the exact main commit
   and immutable digest through `infra/gcp/first_provision.py`; do not fabricate provenance,
   reuse another target's trigger or weaken guards if the provider omits required metadata.
4. **Business first creation:** independently approve the verified creation image and fix its digest in this target
   source in a reviewed change. Regenerate the complete plan from that exact source and current
   backend/state, initialize the already-created isolated bucket using
   `backend.tfvars.example`, and review/apply one complete administrator plan for this root.
   No ordinary runner gains creation powers. Never apply this preparation's local-backend preview.
5. **Service stage:** after the actual runtime/database/service exist, change only the Portfolio
   bootstrap stage to `service`, review/apply its complete plan, and publish the named DB's
   deny-all Rules. Add exact runtime datastore access and normal execution metadata/configuration
   grants. No build identity receives Cloud Run deployment or runtime attachment rights here.
6. Verify second complete plans are unchanged, actual service health/private API rejection,
   explicit named-DB routing, no body/financial/key logging, client Rules, original runtime
   default-DB access and cross-DB denials for Market/User/Config. Also verify Portfolio denies
   default/other actual databases. Check runtime versus plan/apply identities separately; metadata
   access must not imply content access. Backfill INF-002–004. No nonexistent-resource 404 counts
   as IAM-denial evidence and no real content is permitted until these checks pass.
7. Activate `pipeline.json` only in a later reviewed target change after validating source provenance and runner permissions. The checked-in creation-only digest
   default keeps normal plans noninteractive; the ordinary runner does not accept ad-hoc tfvars. Registry activation
   retains service-stage objects without a new owner. Keep this target's service registry
   `release_mode=build_only` and trigger `_DEPLOY_SERVICE=false`; normal image release requires
   its own scoped permission/release-mode change after first-provision acceptance.

Do not use `-target` or broaden IAM to force a plan through. Once a stage has been applied, keep
that stage input stable in administrator configuration until registry activation; reverting it to
`none` would propose protected-resource removal. Roll back by keeping the new target closed and
build-only, preserving protected state/database/identity, and reviewing only the affected grants
or service revision. Never delete existing targets or relax the legacy database conditions.

## Audited creation image (2026-10-27)

The creation-only default now pins main-only target build
`7dc66184-691c-4044-83d3-1a7b6efec113`, built from
`09f813c7369158b34dce036a51fc894160bf955a`. Its official output-only resolved Git
source, registered trigger, successful isolated image health, unique image result and
Artifact Registry digest were reviewed; the existing `first_provision.py` prepare/validate
checks passed without changing their guard. The digest is
`sha256:93932b8af2887ac39d17bfec040f213416d8a1e8b2547b71c3aa9dedbab535cf`.

This replaces the earlier manual-build plan candidate. It does not perform an apply, enable
the pipeline, change Hub, or grant normal image deployment permission. An administrator must
still review a fresh complete business-root plan against its real isolated backend before
first creation. Retain the already-applied administrator execution/service stage inputs.
