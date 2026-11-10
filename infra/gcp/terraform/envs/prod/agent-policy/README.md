# Independent Policy base: INF-011 D1

This is a **trusted Owner administrator root in an independent Policy project**.
It is deliberately absent from the ordinary repository bootstrap/catalog, which
would give the routine operator control over its own release authority. No project,
backend, source connection, billing link or cloud resource is created by merging
this source. There are no checked-in production inputs and no automatic apply.
Project names alone do not prove independence: review actual people/credentials,
organization inheritance, IAM/impersonation and recovery ownership before apply.

## Default and base stages

`stage="none"` is the default: zero managed resources or grants. An explicitly
reviewed full `resources` plan prepares build/storage/key resources; a later full
`base` plan adds the private service from an actual successful image. Together
they propose only this target's resources:

- Enable nine required APIs, retaining them on destroy.
- Distinct protected keyless Policy runtime and build identities. The build
  identity can write only its image repository and logs; it cannot deploy,
  impersonate runtime, sign, unwrap a DEK or edit authority.
- A private `agent-policy-api` with the existing guarded configuration controller,
  original image/traffic ownership, min 0/max 1, 1 CPU/512 MiB, concurrency 4 and
  60-second timeout. All application/release gates are fixed off, config/CORS empty,
  no public or caller invoker grant. Changing an input cannot enable authority.
- Protected named `agent-policy-witness` Firestore, deny-all client Rules and
  index exemptions for actual live-pointer fields. No TTL/PITR import, backup
  restore or automatic recreation chooses authority.
- A separate private immutable-snapshot bucket, uniform access, public access
  prevention, versioning, seven-day soft delete and configurable 7–30 day unlocked
  minimum retention. No lifecycle rule deletes correctness-bearing objects.
- Protected software ES256 signing and symmetric state-DEK wrapping CryptoKeys.
  The signer uses numeric version 1; symmetric automatic rotation is 90 days and
  old decrypt versions must remain available. No private keys enter Terraform.

D1 grants **no runtime KMS, witness, snapshots, Owner lookup, compute metadata,
service-account impersonation or WIP/STS access**. Only build logging and exact
repository writer IAM are present. It emits public resource references for the
next stage; an endpoint or healthy image is not an active issuer/key authority.
Retain `base` after eventual creation; switching to `none` cannot erase protected
resources. Never remove protection to recover a failed plan.

## Explicit inputs and first build

Copy the synthetic `terraform.tfvars.example` into ignored operator storage.
Select a separately controlled, existing billed Policy project, region, artifact
repository and distinct account IDs. `operator_project_ids` explicitly inventories
Hub/executor operator projects and cannot include the Policy project. This is an
input consistency check, not a proof about inherited administrators. Never adopt
disposable VAL-008 credentials/projects, prototype private material or personal
scope by implication.

Use a full `stage="resources"` plan first: this creates the protected resources,
repository and build identity, with **no Cloud Run service** and no image input.
Then build using the registered build-only `cloudbuild.agent-policy.yaml` and
independently verify the exact successful main source/provenance and output digest.
Supply that digest as `creation_image` for a fresh full `stage="base"` plan.
The service stage rejects a missing, mutable, foreign-project or other-target image.
No `-target`, fabricated placeholder, source connection or automatic deployment
trigger is needed. Retain all existing stage resources in each full plan. Image
build publication is a separate reviewed event from base provisioning.

## Independent state and approval lane

Use an existing separately reviewed Owner-only GCS backend with a unique
`prod/agent-policy` prefix; never use the routine repository state bucket/account.
The example contains placeholders only. Provisioning that backend and its
independent protected plan/apply lane is a separate **Policy-target** administrator
milestone before any live apply, not a reason to grant ordinary repo execution
broader IAM. The current ordinary runner cannot select this root and must not be
bypassed with a local unreviewed apply.

For credential-free source validation:

```sh
terraform init -backend=false -lockfile=readonly
terraform validate
terraform test
```

The tests use full provider-mocked `plan` only. Live work requires complete saved
plans against the actual independent backend, exact reviewed source/configuration,
backend lineage/generation/locking, plan age/digest validation and final native
Owner approval in that independent lane. No `-target`, auto-approve, mutable image,
empty-state migration, broad execution role or copied old plan is an alternative.
No plan/apply command is added here; live bootstrap/lane, budget and input selection
remain explicit outstanding INF-011 milestones.

## D2 and D3 contract

Export only the `base` output's resource names, runtime/build identities, exact
signing version, recovery CryptoKey and private service URI. INF-012 owns its own
VM/network/state resources and exact current-instance read permission for the Policy
runtime. Narrowly scoped creator **Encrypt-only** cross-project CryptoKey IAM belongs to this Policy target's D3 change after
independently reviewed D2 identity outputs; no executor instance is managed here.

D3 must bind the actual Owner Root/Policy public key, exact issuer/resource/native
client/callback, owner/vault/state epoch, witness/snapshot references and original
Agent/encryption/TLS keys. Root bootstrap/enrollment is separate from Terraform.
Grant runtime only fixed-key ES256/public-key read and DEK decrypt, exact named-DB
read/CAS and snapshot get/create, with no overwrite/delete/restore/list authority.
Enable Owner Google account lookup only in the exact reviewed authentication
project. Grant no ordinary executor/Hub operator Policy code/config/IAM/key/witness
administration. Current VM identity-read IAM is owned by the executor project.

The merged Policy verifies custom-audience Google attestation directly as a
relying party, plus current VM/original-key/Root-state checks. It releases only a
32-byte DEK sealed to the attested ephemeral recipient. It does not hand an
executor a direct KMS credential. Therefore D1 creates no unused WIP. Any later
WIP path must independently pin exact claims/audience/image/identity and cannot
bypass Policy or create ordinary executor Decrypt rights. Public invocation,
application authority and key release require separate reviewed D3 activation.

## Recovery, cost and live acceptance

Snapshot restore never overwrites/imports/rewinds the live witness. Missing latest
state or untrusted witness stops issuance; no bootstrap-as-recovery. Protect the
independent backend, Root recovery, KMS versions and authoritative witness from
routine restore operators. Retention is unlocked intentionally; an irreversible
bucket lock requires its own explicit Owner decision. No object timer or TTL
removes grant/revocation/receipt lineage. Capacity grows until reviewed maintenance;
finite application bounds fail closed rather than reset authority.

Before apply, record billing/project/region, a current price estimate and approved
budget/alerts, image/build provenance, source/plan hashes, resource retention and
cleanup ownership. Scale limits are capacity controls, not billing caps. Minimum
storage retention, soft delete, KMS versions, Firestore and retained registry
images have costs even with service min 0. No estimate or spend is authorized by
this synthetic example.

INF-011 remains partial until actual protected-lane plan/apply and impersonated
positive/negative subjects verify no routine Policy mutation/decrypt/sign/witness
rollback, current authority after service restart/snapshot copy, missing-head
failure, scope/revocation and key release against D2. Record actual IAM inheritance
and no-drift full plans separately from source tests. INF-012/VAL-008 owns actual
TEE/ingress/same-key and later offline/overnight evidence; WEB-015 owns Owner UX.

References: [Policy protocol/operations](../../../../../../services/agent-policy-service/docs/operations.md),
[provider 7.28.0 storage contract](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/website/docs/r/storage_bucket.html.markdown),
[named database IAM](https://firebase.google.com/docs/firestore/manage-databases#configure_access_permissions_for_your_databases),
[custom-audience relying parties](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/connect-external-resources).
