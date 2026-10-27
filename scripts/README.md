# Target registration, CI and first provision

`service-targets.json` is the source registry used by CI, the isolated backend
test runner and application release guards. It registers only source targets
already delivered in this repository. It creates no infrastructure, build
trigger, service account or Cloud Run service.

## Register a backend in its own PR

Add the new backend's source, tests, dependency files, Dockerfile and Cloud Build
configuration in that backend's single-target PR. Add one closed registry row:

```json
{
  "id": "example-service",
  "kind": "backend",
  "directory": "services/example-service",
  "service": "example-api",
  "cloudbuild": "infra/gcp/cloudbuild.example.yaml",
  "release_mode": "build_only"
}
```

This is an illustrative registration, not a target delivered by this foundation.
Current registrations are the three existing backends and Web. `common` remains
an independent shared test suite, not a deployable service. The infrastructure
execution registry in `infra/gcp/terraform/pipeline.json` is separate: source
registration does not register or enable Terraform targets.

The registry is versioned/closed, bounds entries and paths, and requires unique
IDs, directories, service names and Cloud Build files. Backend IDs match their
directory basename. IDs/path segments cannot inject shell options or escape
the repository; symbolic links are rejected. Every backend supplies
`app/main.py`, `requirements.txt`, `requirements-dev.txt`, a Dockerfile and
discoverable Python tests. Web retains its existing source/Docker/test contract.
Optional backend Ruff configuration is discovered from its own `pyproject.toml`.

An unregistered runnable directory fails CI, including nonstandard/hidden
executable sources; documentation-only future plans may exist before delivery.
Current registry validation happens before any conservative path-selection
fallback. Corrupt registration cannot become a successful old-target-only run.

New IDs must start `build_only`. The historical registry is read from the actual
PR base or push-before commit. First introduction of this registry grandfathers
only source/build paths that already existed in that base. Implicit target
deletion, identity changes or directory renames are rejected. File moves between
existing owners still expose both paths through Git's no-rename comparison.
Service retirement or identity reassignment needs a separately designed explicit
process; deleting a row is not one.

Later promotion to `existing` is an explicit reviewed target change after its
own infrastructure first provision. It is a release-policy declaration, not a
provisioning permission or proof that a service exists. Runtime publication
still fails on Cloud Run404 and never creates the missing service.

## Dynamic CI and local tests

```sh
python scripts/test_services.py
python scripts/test_services.py --service common --service user-service
```

The default runner executes common and every currently registered backend,
using separate processes/PYTHONPATHs. Explicit choices are derived from the
registry. Discovery of zero tests or an entirely skipped suite fails; a single
optional skip within an otherwise executed suite remains supported. A failed
suite cannot be hidden by a later success.

CI derives backend dependency/Docker/test paths from the same registry. Shared
changes select every registered backend; target changes select that target;
registry/workflow/tooling changes select the required global checks. Missing or
invalid event/base history fails registration-transition verification. Once
that transition is verified, a path-diff failure conservatively selects all
current targets. A registered target cannot disappear through a stale hardcoded
three-service list or a full-selection early return.

The required **Quality checks** job validates all selected jobs and reads the
current Actions run attempt's job evidence. Each selected backend must have
exactly one successful child with successful test, image-build and isolated
health steps. Missing, duplicate, cancelled, failed or unexpectedly skipped
children/critical steps fail the gate. Evidence pagination is bounded and cannot
come from another attempt. Only this job receives ephemeral `actions: read`;
no GCP credential or additional cloud IAM is granted.

Backend smoke containers use `--network none`; health is checked through
`docker exec` and loopback. New backends must expose `/health` on port8080 and
start without real cloud credentials for this offline smoke profile. Normal PR
CI builds local images, without publishing them or provisioning resources.

## Build-only publication

A new backend's build configuration must explicitly use `_DEPLOY_SERVICE=false`.
Its registered release mode also blocks enabled deployment, including accidental
use of the release script's enabled default. This refusal happens before any
credential acquisition or cloud API call. Explicit disabled publication performs
no Cloud Run access and needs no existing service.

The existing release script only GETs an existing service and conditionally
PATCHes its image/revision/traffic with its current etag. It never POSTs a service
or substitutes first provision for404. Enabled publication binds the complete
image address to the target, project/region, artifact repository and build ID.
Existing runtime settings and service identity remain owned by their separate
configuration/infrastructure workflow.

Future target-owned build triggers must watch their source, common dependencies,
their Cloud Build file, `infra/gcp/deploy_existing_service.py`,
`scripts/service_targets.py` and `scripts/service-targets.json`. Changing only
the registry must not silently leave a deployed trigger's dependency filters
stale. Existing trigger instances are not rewritten in this foundation PR;
their owners adopt dependency-filter changes in their own infrastructure PRs.

The registry Python/JSON dependencies are included in Terraform's saved-plan
configuration hash because the configuration writer imports release-policy code.
Changing them invalidates older saved plans. Generate a new plan through the
existing target workflow before any later approved apply. This does not run an
apply or update deployed trigger filters; a registry-only change may need an
explicit plan-trigger run until those target-owned filters are adopted.

## Prepare first-provision material after a successful build

The first-provision helper accepts a deliberately bounded profile: a completed
SUCCESS build from the target's explicit main-only, build-only Cloud Build
trigger, with output source provenance and one immutable image digest. Creation
of that build trigger/identity, when needed, is itself a separately reviewed
target infrastructure step. Source/CI registration does not create it. Manual
or unrecognized build-source profiles are not silently treated as equivalent.

Capture build and trigger metadata through a trusted operator/read-only cloud
identity. The files may contain operational metadata; keep them outside the
repository and do not print secrets. Review their live origin independently.
Then prepare the bounded request using independently trusted parameters:

```sh
python infra/gcp/first_provision.py prepare \
  --target "$TARGET_ID" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --artifact-repository "$ARTIFACT_REPOSITORY" \
  --repository-url "$SOURCE_REPOSITORY_URL" \
  --commit "$MAIN_COMMIT_SHA" \
  --build-id "$SUCCESSFUL_BUILD_ID" \
  --build-json "$BUILD_CAPTURE" \
  --trigger-json "$TRIGGER_CAPTURE" \
  --output "$REVIEW_REQUEST"
```

For `resolvedConnectedRepository`, also supply `--connected-repository` from a
trusted repository-resource-to-URL mapping, not by copying an unverified capture.
The current `resolvedGitSource` profile compares the exact trusted URL and commit.

`prepare_request` binds target/project/region/source, commit, canonical build and
trigger IDs, registered configuration, explicit build-only mode, main-only push,
artifact repository and one exact image tag/digest. It emits an `@sha256:` image
reference for later review. It refuses missing, failed/working, ambiguous,
cross-target/repository or inconsistent evidence. Image digests are read from a
completed build; a WORKING build's own deployment step cannot yet assume its
final `results.images` exists.

Use the same inputs with command `validate` and `--request-json` to recompute and
compare every request field. Output files are created exclusively and never
overwritten. Local JSON is **not authenticated Google evidence**: a shape check
cannot prove who produced a capture. The request always says
`approval.status=not_requested`. Adding `approved:true` or editing an image does
not create an approval or survive exact validation.

The helper does not obtain credentials, call APIs, invoke Terraform or create
anything. Actual first provision remains in the target's separately reviewed
infrastructure PR/root and isolated state. Reuse `terraform_pipeline.py`'s saved
plan/source/configuration hashes, exact target binding and native Cloud Build
approval-required apply. A local request file is not an alternative approval.
After approved first provision is confirmed, promote that target's registry and
normal release switch in its own ordered target changes.

## Verification

```sh
npm run test:ci
npm run test:infra
npm run check
```

Tests build complete temporary repositories with an additional backend; no new
real target is registered or deployed. They exercise real Git comparisons,
isolated test children, empty/skipped/failing suites, registry transitions,
matrix evidence and synthetic successful-build/trigger material. Existing
native saved-plan approval tests remain required. Cloud tests use fake APIs;
no new resource or provisioning command is required for this foundation.

The metadata format follows Google's [build/source-provenance reference](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.builds)
and [trigger reference](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.locations.triggers).
