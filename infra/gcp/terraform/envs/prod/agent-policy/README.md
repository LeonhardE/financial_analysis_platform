# Independent Policy deployment: INF-011

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
  60-second timeout. Without `authority`, all application/release gates are off, config/CORS empty,
  and there is no public or caller invoker grant. Explicit D3 bindings and
  activation switches are described below.
- Protected named `agent-policy-witness` Firestore, deny-all client Rules and
  index exemptions for actual live-pointer fields. No TTL/PITR import, backup
  restore or automatic recreation chooses authority.
- A separate private immutable-snapshot bucket, uniform access, public access
  prevention, versioning, seven-day soft delete and configurable 7–30 day unlocked
  minimum retention. No lifecycle rule deletes correctness-bearing objects.
- Protected software ES256 signing and symmetric state-DEK wrapping CryptoKeys.
  The signer uses numeric version 1; symmetric automatic rotation is 90 days and
  old decrypt versions must remain available. No private keys enter Terraform.

With `authority=null`, D1 grants **no runtime KMS, witness, snapshots, Owner lookup, compute metadata,
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

D3 source accepts an optional `authority` object. Omission preserves D1 behavior.
Supply only reviewed public values: Owner UID digest, existing vault/Root public key,
actual fixed KMS signing-version public JWK, explicit state epoch, independent issuer,
Web/executor origins, exact native client/callbacks, Firebase authentication project,
and the distinct creator/runtime identities exported by D2. The executor project
must appear in `operator_project_ids`; it cannot be the Policy project. Public JWKs
reject private/extra fields and noncanonical coordinates. The runtime also checks
that the actual valid Policy key matches its fixed KMS signing version. Synthetic
test keys are never production authority.

The closed configuration derives KMS/witness/snapshot references from this root,
uses the Web `/agents` consent page, executor `/mcp` resource, and one public S256
client with exact callbacks and no client secret. No arbitrary environment map,
redirect wildcard, alternate storage/key selector or Owner secret is accepted.
Configuration is public but integrity-sensitive and recorded in Terraform state.
The public `creation_configuration` output is suitable for independent Root-domain
review; do not treat it as a Root signature or copy an old authority snapshot.

A populated binding grants only:

- Policy runtime: signing and public-key read on the fixed signing CryptoKey,
  DEK decrypt on the fixed recovery CryptoKey. KMS IAM is CryptoKey-level; the
  application independently pins numeric signing version 1.
- Exact reviewed D2 creator: **Encrypt-only** on the recovery CryptoKey. The
  ordinary executor runtime, build identity and Hub receive no KMS grant.
- Policy runtime: exact named-database get/create/update and transaction
  begin/rollback permissions, with no entity list/delete or database restore/admin.
  This is database-level access, not a claimed collection-level IAM restriction.
- Policy runtime: get/create only under the snapshot bucket's `policy-state/`
  object prefix. No list/update/delete/restore or backup fallback.
- Policy runtime: only `firebaseauth.users.get` in the exact Firebase project,
  supporting the existing revoked/disabled-user check. That project's Firebase
  authentication and API readiness remain a separate reviewed prerequisite.

Bindings require `stage="base"` and do **not** activate issuance, key release or
public invocation. `authority_enabled`, `key_release_enabled` and
`public_invocation` each default false. Release requires authority; issuance and
public invocation require bindings. Public invocation grants only Cloud Run
reachability; all application Google/Root/OAuth checks remain. Actual activation
requires separately reviewed full saved plans and live prerequisites; merging
these switches is not approval to apply them.

Terraform never bootstraps a Root domain, enrolls Agent/TLS/encryption keys, chooses
a live head, signs a Root approval or rewinds witness state. Use the existing
explicit Root bootstrap/enrollment protocol after actual attested creation and
Owner review. A config digest change changes the authority domain and fails
closed against existing state; use explicit Root migration/new epoch, never edit
or recreate the witness to make it pass. Original keys and exact resource scope
are bound by the Root enrollment rather than a Terraform secret or inferred VM.

The merged Policy verifies custom-audience Google attestation directly as a
relying party, plus current VM/original-key/Root-state checks. It releases only a
32-byte DEK sealed to the attested ephemeral recipient. It does not hand an
executor a direct KMS credential. Therefore this root creates no unused WIP. Any later
WIP path must independently pin exact claims/audience/image/identity and cannot
bypass Policy or create ordinary executor Decrypt rights. Public invocation,
application authority and key release require separate reviewed activation.

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
[Firestore method permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam),
[KMS resource-level grants](https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles),
[named database IAM](https://firebase.google.com/docs/firestore/manage-databases#configure_access_permissions_for_your_databases),
[custom-audience relying parties](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/connect-external-resources).
