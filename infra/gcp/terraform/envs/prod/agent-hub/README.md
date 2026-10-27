# Agent Hub first-provision preparation (INF-006)

This target is registered **disabled**. Merging these files does not create its backend,
identities, trigger, database, Rules release or Cloud Run service. Administrator bootstrap
`agent_hub_provisioning_stage` defaults to `none`; a complete plan against the existing
bootstrap state must have no new Agent Hub actions with that default. No `-target` is needed.

## Ownership and stages

| Owner                            | Future resources                                                                                                                                                | Stage                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Existing administrator bootstrap | Dedicated target state bucket, plan/apply accounts, scoped state/plan permissions, plan/approval triggers; dedicated image-build account and build-only trigger | `execution`                               |
| This business root               | `fa-agent-hub-runtime`, protected named Firestore DB `agent-hub`, protected `agent-hub-api` and configuration controller                                        | Separately approved first creation        |
| Existing administrator bootstrap | Resource-scoped Run/runtime-metadata/image-read permissions; exact DB runtime/metadata grants; deny-all named-DB client Rules                                   | `service`, after business resources exist |

`module.target_execution["agent-hub"]` retains its address from execution through activation.
After either stage is applied, retain its stage in administrator configuration. After explicit
pipeline activation, the registry's `enabled` flag also preserves the service stage. Do not
reset an already-provisioned protected target to `none` or remove its catalog entry.

Never jump directly from `none` to `service`: its Run/runtime-scoped grants and Rules release
require the independently created business resources, and the execution identities must already
exist from stage one. Native preparation plans do not prove those future live prerequisites.

Normal target execution never owns IAM, Roles, Rules, triggers, buckets, another target, or
content keys. Its plan account only reads resource metadata; apply can update this service's
configuration/runtime metadata and this database's metadata. Neither gets entity read/write,
DB create/delete, IAM administration or identity-token minting. The DB metadata permission is
`datastore.databases.getMetadata`; `datastore.databases.get` permits transaction operations and
is deliberately absent from infrastructure roles. Only the apply metadata role also receives
`datastore.operations.get`: provider 7.28.0 waits for the database PATCH's asynchronous operation
([database update](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/services/firestore/resource_firestore_database.go#L784),
[operation polling](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/services/firestore/firestore_operation.go#L53)).
The exact named-DB CEL condition remains unchanged; plan gets no polling/update permission,
and neither role can cancel/delete operations. Native plans validate this proposed permission
set, not its live asynchronous authorization behavior. After actual creation, verify the target
apply identity can complete a reviewed database metadata update and operation wait under that
condition before enabling its normal infrastructure pipeline; no such update runs in preparation.

The runtime alone has conditional Datastore User on
`projects/financial-analysis-512202/databases/agent-hub`. Client Rules are a separate deny-all
release `cloud.firestore/agent-hub`; they never overwrite `(default)` Rules. IAM-based server
SDKs bypass client Rules, so both boundaries must be checked. The image builder gets writer
access only to the existing Toronto Artifact Registry repository and log writing, with no Run
update or runtime attachment. Artifact Registry IAM is repository-scoped, not an image-name
security boundary; no cross-target upload isolation inside that existing repository is claimed.

## Configuration and data limits

- Toronto; request-billed one-vCPU/256Mi container, scale-to-zero, max one instance per revision,
  concurrency eight, timeout sixty seconds. Revision caps are not a total billing cap.
- Cloud Run invoker IAM remains enforced with no public or service-account invoker grant.
  Only health is implemented in the image; private APIs/OAuth/MCP remain unavailable. This
  preparation does not claim production agent integration or application authentication.
- Exact existing Web CORS origin is desired configuration for later implementation; the skeleton
  does not implement private APIs or consume a store yet. No guessed callback or OAuth secret.
- No content key, private agent key, secret value, KMS key, broker credential, plaintext fixture,
  payload logging or trace-body configuration. Existing Docker entry disables access logs;
  managed platform request metadata is still retained. Future handlers must preserve no-body
  logs, owner/grant checks and envelope validation.
- Empty TTL/index maps are intentional until Hub storage collections/queries are implemented.
  Add TTL, ciphertext index exemptions and required metadata indexes in the consuming Hub
  storage tickets before admitting private content. TTL does not replace immediate expiry checks.
  The current empty database/skeleton cannot be treated as completed storage/E2EE functionality.
- Hub delegation-signing/OAuth operational keys are distinct from content keys. No signing-key
  resource or decryption service is created speculatively; later authorization tickets add their
  narrowly scoped operational needs. Firebase Auth Viewer is not pre-granted to this skeleton.

## Complete plans without provisioning

Use pinned Terraform 1.16.7 / Google provider 7.28.0 and the committed lockfile. CI initializes
without a backend and runs credential-free native `plan` tests. For live bootstrap inventory,
use the already-established administrator backend and variables; save a **full** plan with
stage `none`, then review each separately proposed `execution` and `service` plan. Never hide
other target changes with `-target`, replace existing state, or run any apply during preparation.

This target's backend is future `financial-analysis-512202-tfstate-agent-hub`, prefix
`prod/agent-hub`. That bucket is not available until separately authorized execution provisioning.
For the preparation-only business plan, use an isolated copy with only the GCS backend declaration
replaced by a temporary local backend and an empty local state. Keep relative module/tool paths,
lockfile and all resource declarations unchanged; use the full native provider graph, not a
mocked screenshot or fabricated state. Authenticate only provider metadata as required; do not
print/store tokens. `terraform show -json` must list only the target runtime, named database,
Run creation/controller and deferred configured-service read; zero destroy/import actions.
This empty-local-state plan is proposed initial creation, not a remote-state adoption check or
an approved, later-reusable production plan. It must be regenerated after the real backend exists.

`bootstrap_image` has a committed creation-only default so normal noninteractive target plans
can run after activation without ad-hoc variable files. `terraform.tfvars.example` records the
same previously verified build-only artifact solely as a plan
candidate. Its manual build lacks supported target-trigger/output provenance. It grants **no**
first-provision approval and is not a reason to relax `first_provision.py` or release guards.
No stage is applied by this preparation PR.

## Future separately authorized first creation

1. Recheck live inventory and the three legacy runtimes' exact default-DB conditions. Keep new
   target registration disabled and the image release build-only. Review/apply only the full
   `execution` bootstrap plan for this target; preserve the saved plan/source/state fingerprints.
2. Run the new main-only target image trigger; independently capture successful build, trigger,
   immutable digest and supported output-only provenance. Use `first_provision.py` to prepare and
   validate matching review material. Empty provenance remains a failed gate. Update the candidate
   creation image to that reviewed digest, re-review source and regenerate complete plans.
3. Initialize the real isolated backend only after its bucket exists. Administrators review and
   approve the business-root saved plan separately. Create runtime/database/Run without granting
   normal execution create/IAM rights. Do not import nonexistent resources or invent UIDs.
4. After those resources exist and the Firebase Rules API availability is confirmed (otherwise
   record enabling it as an explicit future operation), review/apply only the additive `service`
   bootstrap plan. Verify exact named-DB Rules release and IAM. No stage-three resource references
   a nonexistent Run service during stage one.
5. Immediately test real old Market/User/Config runtime reads/writes/transactions are denied on the
   new DB, and verify Hub can access only its own DB. Backfill INF-002–004 before any real private
   data. Missing-DB 404 is not permission denial. Verify anonymous/private-route rejection,
   authenticated health, no payload logs/keys and empty second full plans. No user data is needed.
6. Only after these checks, separately enable normal infrastructure planning. Image registry
   release mode stays `build_only` until its own deployment review; this preparation changes no
   service release setting. The initial image/traffic ownership stays with reviewed creation and
   the later release controller; normal configuration must preserve live image/revision/traffic.

On failure keep the service private, stop progression and retain protected resources/state for
review. Revert only the target's configuration or restore its previous reviewed release when
available; do not delete the DB/identities, reset stage to none, disable unrelated IAM, or broaden
permissions as a workaround. No infrastructure cleanup is needed for this plan-only delivery.

Official contracts: [Firestore IAM](https://cloud.google.com/firestore/native/docs/security/iam),
[named Firestore Rules deployment](https://firebase.google.com/docs/rules/manage-deploy),
[server SDK versus Rules](https://firebase.google.com/docs/firestore/security/rules-conditions).
