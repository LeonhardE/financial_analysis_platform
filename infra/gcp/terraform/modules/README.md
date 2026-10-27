# Shared service infrastructure modules

These are reusable building blocks, not registered execution targets. Existing production roots
already consume the Cloud Run and service identity modules. The database, database access and KMS
access modules below have no production instances in this foundation. Adding their source files
does not create databases, keys, identities, IAM grants or triggers; adoption belongs to a separate
single-target infrastructure PR and reviewed plan.

| Module                                                   | One-instance responsibility                                                                      | Defaults                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [cloud-run-service](cloud-run-service/README.md)         | One HTTP container, runtime settings, Secret Manager references and service-scoped invokers      | Toronto, one vCPU/512Mi, request billing, min 0/max 1, private ingress and no invoker grants |
| [service-identity](service-identity/README.md)           | One keyless runtime identity, optionally exact-secret access and deployer actAs on this identity | No permissions or credentials                                                                |
| [service-build-trigger](service-build-trigger/README.md) | One main-branch push trigger using the existing v2 connection and build identity                 | Disabled, build-only, explicit target/dependency path filters                                |
| [firestore-database](firestore-database/README.md)       | One named Native database and its explicit TTL/composite-index declarations                      | Toronto, Standard, delete protection, ABANDON and prevent_destroy; no IAM                    |
| [firestore-access](firestore-access/README.md)           | Fixed type-and-exact-database condition, optionally additive runtime datastore.user grants       | Empty grant map; existing grants can reuse only the condition without moving addresses       |
| [kms-key-access](kms-key-access/README.md)               | Additive fixed-purpose IAM on one existing CryptoKey                                             | No grants; signer, public-key viewer or Firestore-managed CMEK identity only                 |

Each child inherits the consuming root's provider. It has no backend or provider configuration,
generic project-role assignment interface, service-account keys or secret payloads. Project APIs,
application-specific IAM, state/runner permissions and imports belong to their owning root. Shared
registry, Firebase and GitHub connection resources remain outside these modules. Async
queues, schedules and notification delivery are deferred until their actual consumer is designed;
this foundation creates no idle paid resources for proposed features.

## Adoption gates

Reusable modules and the guarded ownership protocol are shared prerequisites. They do not
register execution targets or import any production resource.

The [guarded release ownership protocol](../compatibility/README.md) now prevents native
full-template update replay. It separates create/adopt from conditional configuration updates,
preserves release images and pinned rollback routes, and verifies desired settings. Frozen native
provider regressions remain historical coverage. See the protocol's authenticated report for the
actual scope: sequential isolated saved-plan/release/rollback verification; concurrent interleavings
are tested offline.

After reviewing that evidence, use a separate `infra(<target>)` PR for each consumer:

- Add only that target's root, lockfile, state isolation, restricted execution permissions and
  Terraform plan/apply trigger registration. The generic target execution module creates isolated execution identities/triggers/state only
  after activation; provide business-resource grants in that same target PR. The active repo
  identity must not be reused for service state or business resources.
- Inventory actual Cloud Run settings, identities, grants and release trigger IDs. Import existing
  resources at their exact module addresses. The initial saved plan should be a no-op or contain
  only explicitly reviewed non-destructive differences. Do not duplicate resources or authoritative
  IAM ownership; private module defaults do not remove pre-existing external public grants.
- Register the exact shared configuration-controller address for the runner's source-qualified
  replacement exception. Actual service replacement and IAM-member deletion remain blocked;
  permission-removal workflows need their own reviewed administrative path.
- For a genuinely new service, build a real reviewed digest first. Order required API enablement and
  resource IAM before service creation. Make the Cloud Run module depend on the complete identity
  module when it supplies secret-access grants, not just its email output.
- Enable a single reviewed build trigger after runtime checks pass, with deployment enabled only
  after release compatibility is established. The YAML must honor `_DEPLOY_SERVICE`; the trigger
  module cannot enforce the contents of arbitrary build configurations.

The release helper supports guarded configuration descendants. Application YAMLs, existing service
instances, bootstrap, execution-target policy and CI workflow remain unchanged by the storage/IAM
foundation. Existing CI routing already selects
repository/Terraform checks for module code and leaves service/frontend jobs unselected. The current
pipeline configuration hash already covers all module files, binding saved plans to reviewed source.

## Validation

Use the repository-pinned Terraform and Google provider. From the repository root:

```bash
python3 infra/gcp/terraform_tools.py check --terraform /path/to/verified/terraform
```

The existing check discovers every module through its `versions.tf`, checks recursive formatting,
runs backend-disabled readonly initialization and validation, then executes native tests with a
mocked Google provider. Each module has a committed lockfile for standalone checks; consuming roots
must commit their own lockfiles too. Checks download checksum-verified provider binaries, require
no cloud credentials, and never run an authenticated cloud plan/apply. `npm run check` is also
required for commits.

The test-only [composition fixture](tests/composition/README.md) additionally plans modules together
with newly-created account emails and Secret IDs unknown until apply. IAM maps use stable logical
keys, so first-create planning does not depend on computed resource IDs as instance addresses.

References:

- [Terraform provider mocking](https://developer.hashicorp.com/terraform/language/tests/mocking)
- [Provider requirements for child modules](https://developer.hashicorp.com/terraform/language/modules/develop/providers)
- [Cloud Run revisions](https://docs.cloud.google.com/run/docs/managing/revisions)

The administrator-only [target execution module](target-execution/README.md) supplies independent
plan/apply identities, state and approval triggers. Its catalog entries remain disabled until each
consumer supplies a reviewed root, lockfile and resource permissions.

## Private storage and identity boundaries

Named databases isolate service data through database-level IAM, not collection-level IAM. The
access module fixes both `resource.type` and the full project/database name; it cannot cancel an
existing unconditional grant or another inherited permission. Existing runtime grants must be
narrowed individually through a reviewed administrative migration before adding private domains.
Google Cloud console does not enforce these database conditions; use real SDK/REST access checks
for rollout acceptance. A missing future database returning 404 is not evidence of IAM denial.

TTL is asynchronous cleanup, not an authorization, expiry or revocation fence. Consumers still
check authoritative state before access/commit. KMS IAM is scoped to a CryptoKey, not a key
version: delegation signing must additionally pin its allowed numeric version in application
configuration. Firestore CMEK uses only the Firestore service agent and does not provide end-to-end
encryption. User root/device/agent private keys and content keys never belong in these modules.
Reuse `service-identity.secret_ids` and `cloud-run-service.secret_environment` for exact Secret
Manager references with numeric versions; Terraform never handles secret payloads.
