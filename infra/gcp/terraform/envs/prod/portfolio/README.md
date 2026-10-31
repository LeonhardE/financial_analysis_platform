# Adopted Portfolio deployment configuration

Portfolio already has its private Cloud Run service, keyless runtime identity,
named database and isolated state. The source catalog admits guarded updates to
this existing service. Normal Terraform execution remains `enabled=false`;
administrative operations use separately reviewed complete saved plans. The image
trigger defaults to build-only until the explicit administrator-only
`portfolio_image_deployment_enabled` switch is reviewed and enabled at the retained
`service` stage. Preserve all other targets and their already-applied stages.

## Explicit inputs

The runtime's verified `target-instance-v1` projection supplies one typed
`deployment` object: `project_id`, `region`, `artifact_repository`,
`runtime_account_id`, `creation_image`, `existing_service_uid`, and `web_origin`.
There are no author-project, image, runtime or CORS defaults. Images must be an
immutable Portfolio digest in the selected region/project/repository; Web origin
must be one canonical lowercase HTTPS origin without credentials, port, path,
query or fragment. The upstream loader validates the entire closed projection
and binds it to actual source/build/trigger metadata and the saved plan.

Generate a private review candidate from an explicitly selected operator profile:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile .deployment/profile.json --target portfolio \
  --output-dir .deployment/portfolio-review
```

The candidate's `terraform-inputs.candidate.json` contains only the permitted
`deployment` input. The legacy `bootstrap_image` argument defaults to null and,
if supplied by an older private operator file, must exactly equal the selected
creation image. It never selects an alternate image; the module uses
`deployment.creation_image` exclusively. The example files contain synthetic
placeholders, not inventory, credentials or provisioning permission.

## Existing ownership and access

The business root retains its existing resource addresses for the runtime,
`portfolio` database, `portfolio-api`, and the shared configuration controller.
A new read-only service boundary requires the inventoried UID, enabled invoker
IAM checks (`invoker_iam_disabled=false`) and the existing service-wide maximum
of 12. A missing/replaced service, absent identity/cap metadata or changed
invocation mode fails the plan. The revision maximum remains 1; service-wide and
revision limits are distinct existing settings. No invoker grant is added.

The shared controller continues to preserve the live image and release-owned
traffic. Private identity/metadata reads do not grant database content access.
The runtime still accesses only the named Portfolio database through its
existing condition; browser/client SDK reads and writes remain denied by the
existing client Rules. No key, secret, brokerage credential, model access,
private broker, KMS resource or server decryptor is introduced.

Administrator bootstrap keeps the existing Portfolio `service` stage and owns
its execution state, identities, IAM, client Rules and image trigger. Only its
Portfolio runtime/account references, artifact repository and existing build
trigger UUID are read from that target's projection. An output precondition
rejects a different trigger UUID without adding a resource or import. Inactive
stages remain inert. Other targets keep their original configuration and stage.

## Review and verification

Use the existing isolated Portfolio backend from the operator profile; retain
its bucket, prefix, lineage, serial and managed addresses. Do not initialize an
empty state, change region/account, import another target, use `-target`, or
reset an applied stage. Review complete business and administrator plans against the specific INF-008
changes below. The business plan may create only the eleven opaque-field
exemptions and replace its existing guarded local configuration controller for
the five trust settings. The native service, runtime and named database must be
retained. The administrator plan may update only Portfolio trigger metadata,
its explicitly enabled image path, and the exact permissions described below.
Other targets, private invocation and capacity must remain unchanged.

Keep the actual main-only source, UUID/digest, six-hour age, configuration
ownership, backend generation, Terraform locking/lineage/serial, native approval
and exact saved-plan-only apply checks. Old saved plans require regeneration
after reviewed source/configuration changes. This source change performs no
apply or new cloud provisioning; real plan evidence is an operator step.

Offline tests use two independent synthetic projects/regions/runtimes/images,
verify named-DB/CORS/private service boundaries, and reject UID/invocation/cap
changes, malformed inputs, wrong-owner or mutable images, noncanonical origins
and an overriding legacy image alias. Bootstrap mocks test stage gating,
repository/runtime binding and refusal of a changed build-trigger UUID. They
use no real account or cloud mutation and do not replace live IAM evidence.

## INF-008 trust, storage and existing-image release

The closed `portfolio-hub-trust.consumer.json` marker opts this source into the
repo foundation's `portfolio-hub-trust.v1` contract. Compile an explicitly selected
v4 private profile with `compile-portfolio-hub-trust`; default compile/render
continues to omit the extension. Review and bind the candidate's exact hashes,
Hub numeric subject, same-project runtime identities, live service UIDs and Run
URLs. The optional `hub_trust` map has exactly five fields; null/all-empty preserves
the old runtime environment. Partial maps, extra keys, noncanonical identities,
wrong audiences or an alternate reverse-authority endpoint fail validation.

The five runtime values are `PORTFOLIO_SERVICE_AUDIENCE`,
`PORTFOLIO_DELEGATION_AUDIENCE`, `PORTFOLIO_DELEGATION_ISSUER`,
`PORTFOLIO_TRUSTED_HUB_CALLERS` and `PORTFOLIO_HUB_AUTHORITY_ORIGIN`.
Only the pinned Hub enters internal caller trust. The administrator consumes the
separate `invokerServiceAccounts` projection for exact Web/Hub `roles/run.invoker`
tuples on `portfolio-api`; both accounts must match their selected anchors and be
distinct. Portfolio retains IAM checks. IAM does not replace Firebase owner
verification or internal workload-plus-delegation checks. Web receives no database,
KMS, Secret, content key or token-creator permission.

`storage.tf` exempts eleven implemented opaque string/map/array fields from
single-field indexing. This includes snapshot `carrierJson` and `keyProofs`, public
authority history/keys, receipts and source reference maps. Stores use exact IDs;
no composite index or TTL is added. State/history/receipts are not deleted by a
retention timer. Infrastructure metadata roles add only field read/update as
appropriate, under the existing exact Portfolio database condition. They still
lack entity access and database/index create/delete privileges.

Only the runtime receives the single `firebaseauth.users.get` permission needed
for the application's existing revoked-token checks. No user listing, management,
signing or content access is granted by that role.

Enabling `portfolio_image_deployment_enabled` requires an explicit `service` stage
and a complete administrator plan review. The dedicated image publisher receives
the existing service-scoped get/update-only role and attachment of this runtime.
It also reads project build/trigger metadata through the existing one-permission
foundation role to verify the producing build. It cannot queue/approve builds,
create/delete services or administer IAM. The retained trigger switch
then uses the unchanged main/source/build/image/etag guards in the release helper;
its unique build tag and published digest must be verified. The ordinary Terraform
pipeline remains inactive. Never bypass the catalog guard or use first provision
to update an existing service. The creation-image input remains creation-only and
must not be rewritten to force a release.

Apply storage/configuration before exposing the Web owner module. Preserve private
service UID, runtime, named DB, service-wide maximum 12 and revision maximum 1.
Review actual field metadata (no indexes, no TTL) and successful image provenance,
then exercise Web owner and actual Hub caller paths. Synthetic Terraform tests do
not replace those checks. Portfolio's remote fence ACK consumer is still separate
POR-004 work; this deployment does not claim to implement that seam.
