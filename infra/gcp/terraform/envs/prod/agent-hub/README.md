# Agent Hub infrastructure and guarded image delivery

The ordinary Terraform pipeline remains **disabled**, using `inactive-v1`.
Administrator `agent_hub_provisioning_stage` defaults to `none`, so merging its
configuration creates no service, database, API, identity or public invocation.
For a provisioned instance, retain its reviewed `service` stage rather than
resetting protected resources to `none`. OAuth/adapter gates remain independent.
The application contains encrypted owner APIs, OAuth, helper/MCP, tasks, Runs and
results; image health alone does not establish their production acceptance.

## Existing-service image release

The explicit administrator-only `agent_hub_image_deployment_enabled` defaults to
`false`. False retains build-only trigger behavior and grants no image-deployment
rights, including when the service stage already exists. The ordinary closed
profile compiler cannot emit or enable this override.

Setting it to `true` requires a retained `agent_hub_provisioning_stage="service"`
and a complete reviewed bootstrap plan after the existing service/runtime exist.
The separate repository target catalog must already permit existing-service image
release. This flag sets the dedicated trigger's `_DEPLOY_SERVICE` and grants its
`fa-agent-hub-build` identity only:

- The existing get/update configuration role on `agent-hub-api` alone.
- `roles/iam.serviceAccountUser` on the selected Hub runtime alone.
- The existing project build-metadata read role, whose only permission is
  `cloudbuild.builds.get`, for the unchanged release provenance checks.

No service create/delete, IAM administration, new identity, data/content/key access,
public invoker or normal Terraform pipeline activation is added. The trigger waits
for these three explicit bindings before image deployment. Its release helper
retains exact source/build/digest and existing service UID checks. Both
`agent_hub_preparation.image_deployment` and the compatible `image_deploys` output
reflect this opt-in. Preserve other targets' already-applied stages in every plan.

## Explicit configuration

Supply the closed `deployment` object in `variables.tf`, using the private reviewed
instance profile and a current immutable **agent-hub-api** image. Project, region,
repository, runtime identity, canonical Web origin and canonical Hub origin have no
checked-in production defaults. The example is illustrative and is not a real image.
`bootstrap_image` is a compatibility alias that may only equal the selected image.

`AGENT_HUB_STORE_BACKEND=firestore` is the actual application setting. The obsolete
`HUB_STORE_BACKEND` name is not emitted. The database is explicitly `agent-hub`;
the default database and emulator are refused by the deployed application.
Scale remains min 0/max 1 per revision, one CPU/256 MiB, concurrency 8 and timeout
60 seconds. These bounds limit capacity but are not a total billing cap.

The `sources` input contains fixed HTTPS producer origins and the inventoried
Portfolio Google subject/email pair. Missing values leave those operations
unavailable; do not guess the numeric subject or trust email alone. Producer-side
trust and invoker permissions remain INF-007/008, not this target's IAM grants.
The Hub catalogue caller is its selected runtime identity.

`connector` supplies exact Muse registrations. OAuth and the encrypted adapter
both default to `false`, no client is implicitly registered, and the adapter
cannot be enabled without OAuth. Callbacks have no wildcards, userinfo, query or
fragment; the serialized list is bounded to the application's 16 KiB budget.
Public clients use PKCE with `none` authentication. Confidential clients use only
a high-entropy secret's SHA256 verifier from private operator inputs; never place
the raw secret in Terraform, source or logs. The configured consent page is the
fixed same-origin `/agent/v2/helper/consent.html` asset.

## Ownership and staged creation

| Owner                   | Prospective resources                                                                                                    | Order                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Administrator bootstrap | Dedicated state/plan/apply/build identities and triggers; explicit Cloud KMS API enablement                              | `execution`                              |
| This business root      | Runtime, protected named DB, index-only exemptions, signing key ring/key, private Run and configuration controller       | First creation after execution           |
| Administrator bootstrap | Exact DB and resource metadata IAM, runtime signing/public-key access, Firebase account lookup and deny-all client Rules | `service` after business resources exist |

Use complete saved plans, never `-target`. Preserve the already-applied Portfolio
stage and other target resources. After any provisioning, keep its administrator
stage; never reset protected targets to `none`. The default none plan must remain
inert. The future Hub backend must not be initialized until its bucket exists.

The Cloud KMS API is currently a proposed execution-stage prerequisite with
`disable_on_destroy=false`. The business root proposes one protected
`ASYMMETRIC_SIGN` key using `RSA_SIGN_PKCS1_2048_SHA256`, software protection and
initial numeric version 1. It signs operational delegation authority, never user
holdings/tasks/reports. No private key bytes, content recovery key or KMS decrypt
permission are configured. Future key-version rotation needs its own reviewed
creation and explicit numeric-version change.

Only the runtime receives `roles/cloudkms.signer` and `roles/cloudkms.publicKeyViewer`
on that exact CryptoKey. Those parent-key IAM grants cover usable versions of
that key; the environment pins version 1 but is not a version-level IAM boundary.
Plan/apply identities get ring/key metadata read, and apply gets key metadata
update; neither signs, decrypts, creates/destroys key versions or administers IAM.
Only `firebaseauth.users.get` is added to the runtime for the existing
`check_revoked=True` owner verifier. No user listing/admin or token-signing role.

## Storage and permissions

`storage.tf` records 35 implemented opaque JSON/map/array fields. Each
`google_firestore_field.opaque` has an empty `index_config` and **no `ttl_config`**.
This is deliberately separate from the shared database module's TTL input, which
would enable TTL. No grants, refresh families, immutable histories, operation
ACKs, manifests, deliveries or result references are deleted by TTL. All current
lookups use bounded exact document IDs/get-many; no composite query index is added.

The runtime alone receives data access conditioned on the exact Hub database.
Plan/apply metadata permissions retain the same DB condition. Field GET/PATCH use
`datastore.indexes.get`/`datastore.indexes.update`; apply also polls
`datastore.operations.get`. No entity access, DB create/delete, index create/delete,
list or project-wide data role is added to infrastructure execution. Live field
metadata and asynchronous-operation checks remain required after actual creation.
See the [Firestore method permissions](https://docs.cloud.google.com/firestore/native/docs/audit-logging#getfield)
and [provider 7.28.0 field implementation](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/services/firestore/resource_firestore_field.go).

## Public invocation is a separate decision

The business root grants no invoker IAM. A new instance starts private with no
public/caller invoker grants. A separate administrator service-stage plan can
explicitly set `agent_hub_public_connector_enabled=true` to add only this service's
`allUsers` invoker tuple. That flag does not enable OAuth/adapter, approve an agent,
change application authentication or give normal target execution IAM rights.
Review the application authentication and routing of the selected public surface.
Owner entry/JWKS reachability does not open Muse; real OAuth/consumer acceptance
remains necessary before its independent gates are enabled. Hub owner/internal routes require their exact
Firebase/workload/delegation checks; URL naming, CORS or Web forwarding is not an
authorization boundary. The Web owner BFF and public agent protocol stay distinct.

## Plans, images and remaining live gates

Use the pinned Terraform 1.16.7/provider 7.28.0 lockfile. Native tests are mock
`plan` only and never run the configuration provisioner. Review complete default,
execution and service bootstrap plans, plus a full business first-create plan.
For a new instance whose Hub state bucket does not yet exist, an isolated local-backend
copy with empty state can preview business creation; it is not adoption or a reusable
approved production plan. Regenerate against the real backend after execution.

The pinned historical build-only artifact is a **candidate**, not first-provision approval.
Its reviewed digest, exact released-main source and official build reference are
pinned in [image-candidate.json](image-candidate.json); compose the full image
reference with the selected deployment project/region/repository. This manifest
does not activate a target or substitute a future dedicated-trigger approval.
Supported Git source/output provenance does not replace the dedicated target
trigger requirement. The Hub trigger cannot exist until separately authorized
execution provisioning. Keep `first_provision.py`, source, digest, saved-plan and
release guards intact. A future target-trigger build must be independently checked
and pinned before actual service creation. This preparation performs no apply.

After eventual creation, verify cross-DB refusals with existing DBs, exact
runtime/infra permissions, Firebase owner auth, signing/public JWKS and no content
keys/body logging; then review fresh no-drift plans. Backfill INF-002/003/004 Hub
checks. Configure producer trust in INF-007/008, Web entry in INF-009 and real Muse
acceptance separately. Keep protocol flags and public invocation closed until
those checks are complete. Never recover a failed stage by granting broad IAM,
recreating the DB, deleting histories or supplying a content key to the backend.
