# Shared service infrastructure modules

These are reusable building blocks, not registered execution targets. No production root calls
them yet. Adding module source files does not create services, identities, IAM grants or triggers.
The existing `repo` target still contains only its execution contract; merging this foundation
should produce a no-resource-change repo plan without another bootstrap or apply.

| Module                                                   | One-instance responsibility                                                                      | Defaults                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [cloud-run-service](cloud-run-service/README.md)         | One HTTP container, runtime settings, Secret Manager references and service-scoped invokers      | Toronto, one vCPU/512Mi, request billing, min 0/max 1, private ingress and no invoker grants |
| [service-identity](service-identity/README.md)           | One keyless runtime identity, optionally exact-secret access and deployer actAs on this identity | No permissions or credentials                                                                |
| [service-build-trigger](service-build-trigger/README.md) | One main-branch push trigger using the existing v2 connection and build identity                 | Disabled, build-only, explicit target/dependency path filters                                |

Each child inherits the consuming root's provider. It has no backend or provider configuration,
generic project-role assignment interface, service-account keys or secret payloads. Project APIs,
application-specific IAM, state/runner permissions and imports belong to their owning root. Shared
registry, Firebase, Firestore and GitHub connection resources remain outside these modules. Async
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
  Terraform plan/apply trigger registration. The current repo-only execution identities cannot
  provision these modules, and their existing grants must not be widened casually.
- Inventory actual Cloud Run settings, identities, grants and release trigger IDs. Import existing
  resources at their exact module addresses. The initial saved plan should be a no-op or contain
  only explicitly reviewed non-destructive differences. Do not duplicate resources or authoritative
  IAM ownership; private module defaults do not remove pre-existing external public grants.
- Define reviewed controller-replacement and permission-removal paths before adoption: the existing execution runner rejects
  all delete/replacement actions, including deleting an IAM member. The new local configuration controller needs a narrow replacement allowlist; this must not allow
  service replacement. Removing an entry from a module map describes revocation but cannot currently pass that runner's normal apply flow.
- For a genuinely new service, build a real reviewed digest first. Order required API enablement and
  resource IAM before service creation. Make the Cloud Run module depend on the complete identity
  module when it supplies secret-access grants, not just its email output.
- Enable a single reviewed build trigger after runtime checks pass, with deployment enabled only
  after release compatibility is established. The YAML must honor `_DEPLOY_SERVICE`; the trigger
  module cannot enforce the contents of arbitrary build configurations.

The release helper supports guarded configuration descendants. Application YAMLs, existing service
instances, bootstrap, execution-target policy and CI workflow remain unchanged by this foundation. Existing CI routing already selects
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
