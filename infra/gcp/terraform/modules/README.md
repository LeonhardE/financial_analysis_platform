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

This PR completes the reusable-module step, not the release-ownership step. In particular, the
initial Cloud Run module owns its full template/image and latest traffic. It cannot yet be combined
with the existing image-release helper. It does not use a broad `ignore_changes(template)` or claim
that ignoring only the image solves immutable revisions, rollbacks or concurrent updates.

Before **any** production service uses this Cloud Run module, a separate `infra(shared)` release
compatibility PR must define and test the actual ownership protocol:

1. Create a temporary single service with image A, then release B using the existing image pipeline.
2. Refresh/plan Terraform and require no release-field drift. Change one harmless environment value,
   apply, and verify B is retained while a valid new revision serves the new configuration.
3. Release C, then require another Terraform no-op. Exercise a Console rollback to B and prove a
   subsequent configuration update does not undo the chosen serving image or traffic.
4. Prove configuration changes and application releases cannot race. A GCS Terraform state lock
   does not lock `deploy_existing_service.py`; until a shared protocol exists, pause the affected
   application trigger and wait for in-flight releases. Document how the live test resources are
   removed without weakening production deletion protection.

Offline mocked tests in this PR verify input/resource contracts only. They cannot establish live
IAM, provider refresh/revision behavior, rollback preservation, regional product availability or
cross-pipeline serialization. No such live test has been performed by this PR.

The subsequent [compatibility verification suite](../compatibility/README.md) now exercises the real
pinned provider against a strict localhost wire fixture and offers a separate Cloud Shell live
reproduction. It demonstrates unresolved full-template/traffic replay and immutable-revision
blockers. It does not relax the gate or change the production module/release helper ownership.

After that prerequisite, use a separate `infra(<target>)` PR for each consumer:

- Add only that target's root, lockfile, state isolation, restricted execution permissions and
  Terraform plan/apply trigger registration. The current repo-only execution identities cannot
  provision these modules, and their existing grants must not be widened casually.
- Inventory actual Cloud Run settings, identities, grants and release trigger IDs. Import existing
  resources at their exact module addresses. The initial saved plan should be a no-op or contain
  only explicitly reviewed non-destructive differences. Do not duplicate resources or authoritative
  IAM ownership; private module defaults do not remove pre-existing external public grants.
- Define a reviewed permission-removal path before adoption: the existing execution runner rejects
  all delete/replacement actions, including deleting an IAM member. Removing an entry from a module
  map describes revocation but cannot currently pass that runner's normal apply flow.
- For a genuinely new service, build a real reviewed digest first. Order required API enablement and
  resource IAM before service creation. Make the Cloud Run module depend on the complete identity
  module when it supplies secret-access grants, not just its email output.
- Enable a single reviewed build trigger after runtime checks pass, with deployment enabled only
  after release compatibility is established. The YAML must honor `_DEPLOY_SERVICE`; the trigger
  module cannot enforce the contents of arbitrary build configurations.

The image release helper, all application YAMLs, existing service instances, bootstrap, execution
policy and CI workflow remain unchanged by this module PR. Existing CI routing already selects
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
