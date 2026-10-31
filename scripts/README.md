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
Current registrations include Market, User, Config, Portfolio, Agent Hub and Web. `common` remains
an independent shared test suite, not a deployable service. The infrastructure
execution registry in `infra/gcp/terraform/pipeline.json` is separate: source
registration does not register or enable Terraform targets. That catalog contains static
protocol metadata; managed target triggers supply the explicitly selected deployment instance.
Its disabled `inactive-v1` Hub entry cannot enter normal infrastructure execution.

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

Agent Hub has completed its separately reviewed first provisioning and is registered
for existing-service image release. Its administrator trigger still defaults to
build-only until a separate Hub-only deployment opt-in and exact service/runtime
permissions are reviewed. Registration does not enable OAuth, the encrypted adapter
or normal Terraform execution.

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

## Required secret scanning

`npm run check` and the pre-commit hook run `npm run security:scan` first. A new
clone downloads the fixed official Gitleaks release into the ignored
`.security-tools/` directory. Installation validates both the release archive
and extracted executable against the reviewed SHA-256 values in
`ci/gitleaks-toolchain.json`. A cached executable is rechecked before every use.
A missing tool, unsupported platform, failed download, invalid checksum or
incomplete scan fails the command; there is no successful skip. Linux and macOS
on x64 and arm64 are supported by this toolchain.

```sh
npm run security:scan
python3 scripts/ci/secret_scan.py install --directory .security-tools
python3 scripts/ci/secret_scan.py scan --gitleaks .security-tools/gitleaks
```

The scan covers every locally reachable Git ref, the exact staged blobs, and
current tracked/unignored files, as three independent inputs. Fetch complete
history before scanning a shallow clone. Staged ignored files are still scanned;
ignored local deployment profiles, credentials and environment files stay out of
normal Git/Docker inputs. Public examples, schemas and JSON source fixtures
remain eligible source files. Local private files need their own handling and
must never be force-added. The scanner does not call cloud services or validate
credentials against a provider.

CI fetches full history, installs the same checksum-pinned CLI, runs its
integration tests and performs the required repository scan in the Repository
checks job. No licensed scanner Action is required. For isolated scanner tests,
set `FOLIOVIEW_GITLEAKS_PATH` to that verified executable; `npm run check` installs
it at the default location before tests. A bare `test:ci` run without either
executable skips scanner integration cases, so it is not equivalent to the
required security scan or full check.

Only rule, path and line number are printed for findings. Matching values,
source lines and scanner diagnostics are suppressed; redacted reports and
snapshots live in automatically removed temporary directories. Inline
`gitleaks:allow` comments and `.gitleaksignore` files cannot bypass this wrapper.
Snapshot/file limits, unresolved merge stages, submodules, shallow history and
scanner errors fail closed rather than silently reducing coverage. Existing
ignore rules are a preventive layer, not a replacement for scanning or review.

`.gitleaks.toml` extends the pinned defaults and records narrowly reviewed public
exceptions: the named Firebase Web public-config assignment in its historical
bootstrap path, and two exact public JWS payload fragments at the existing
interoperability fixture path. The Firebase exception applies only to the two
key detectors and that complete assignment line; another backend key or private
key in the same file still fails. Other rules and unknown fixture values remain
active. Firebase Web configuration is public client configuration, not an IAM
service-account credential; its API restrictions and backend authorization still
need to be managed. Review any change to scanner policy or pinned hashes as a
security-sensitive code change. No secret scanner proves that every possible
secret is absent; rotate actual exposed credentials if an investigation finds
one.

Temporary Git fixtures remove all inherited `GIT_*` context and configuration
injection. Scanner subprocesses also isolate repository/configuration settings,
and use no global/system Git configuration. Within the caller's selected
repository, scanning binds an active `GIT_INDEX_FILE` to that repository's real
Git directory/worktree, copies it to a bounded temporary regular file, and uses
only that copy for read-only index listing. A missing or mismatched active index
fails; it never falls back to the clean default. This covers hook temporary
indexes and explicit alternate indexes when the working copy is already clean.
When `--root` deliberately selects a different repository, the caller's index is
not imported; that selected repository's default index is scanned instead.
Regression tests verify the parent repository's configuration, author settings,
index and refs are unchanged under hook-like variables.

Upstream release and checksum sources are recorded alongside the pinned hashes:
[Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) and its
[official checksum asset](https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt).
To upgrade, independently review that release, verify each supported archive
against its official checksum, recompute the regular executable hash, and rerun
the positive, negative and tamper tests before changing the pins.
