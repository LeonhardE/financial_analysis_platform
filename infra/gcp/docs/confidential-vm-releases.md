# Confidential VM source targets and release review

This foundation distinguishes a Python backend's CI ownership (`kind=backend`)
from its deployment runtime. Existing registry rows omit `runtime` and continue
using `cloud_run`; their JSON registrations, build configuration and resource
instances are unchanged. A future target may specify `runtime=confidential_vm`
only in its own source PR with `release_mode=build_only`. The runtime is immutable
under an existing target ID. A VM cannot become an ordinary `existing` Cloud Run
release. This foundation registers no Policy/Executor service or cloud resource.

## Future target source contract

A VM target supplies the existing backend source/dependency/Docker/test files and
an additional `app/health_check.py`. Its Cloud Build configuration builds and
pushes the uniquely tagged image, explicitly remaining build-only; it must not
invoke `deploy_existing_service.py`. Both that Cloud Run publisher and the legacy
`first_provision.py prepare/validate` path reject VM targets before obtaining
credentials. Actual VM provisioning and updates stay in the target's separately
reviewed infrastructure workflow/state.

CI and the isolated Python test runner select VM backends dynamically from the
same registry. The existing matrix's named test/build/health steps remain required.
The shared `service_job.py smoke` command keeps Cloud Run's network-isolated
container and loopback `/health` behavior. For VM targets, it instead runs:

```text
docker run --rm --network none --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --env FOLIOVIEW_EXECUTION_MODE=offline_probe \
  --env PYTHONDONTWRITEBYTECODE=1 --entrypoint python \
  folioview-backend:test app/health_check.py
```

The future probe must return only this closed JSON object on stdout, exit zero,
and finish within 60 seconds:

```json
{
  "profile": "confidential_vm_offline_probe.v1",
  "status": "ok",
  "contentServiceEnabled": false,
  "keyReleaseAttempted": false,
  "attestationVerified": false
}
```

Duplicate/extra fields, other profiles, integer substitutes for booleans, more
than 4096 output bytes, a failed process or timeout fail the job. The probe must
exercise the service's offline checks without attempting content service or key
release. It does not prove TEE execution, TLS binding, original-key recovery or
live workload health. Backend PR CI has no cloud credentials or new IAM grants.

## Successful-build evidence and independent policy

`first_provision.prepare_build_evidence` is the shared, offline artifact parser.
It requires the registered configuration, successful exact project/main commit,
main-only build-only trigger, output source provenance and exactly one matching
image tag/digest. Legacy Cloud Run requests keep their existing wire format.
`confidential_vm_release.py` composes that artifact evidence into a separate VM
review descriptor rather than reusing Cloud Run provision/deploy commands.

Supply an independently reviewed policy file with exactly these fields (all
values below are synthetic):

```json
{
  "schema_version": 1,
  "runtime": "confidential_vm",
  "target": "synthetic-service",
  "project_id": "test-project",
  "region": "northamerica-northeast2",
  "approved_image": "northamerica-northeast2-docker.pkg.dev/test-project/financial-analysis/synthetic-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "workload_identity": "synthetic-runtime@test-project.iam.gserviceaccount.com",
  "policy_checkpoint": {
    "version": 3,
    "digest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }
}
```

The policy is trusted operator configuration, never taken from an incoming
request or derived from an unverified build capture. Its exact image must match
the successful build's immutable reference, and its identity belongs to the
selected project. Preparing a descriptor does not approve that policy or prove
that KMS/WIP currently enforces it. Live origin, issuer/permissions and current
checkpoint must be independently established in the later target workflow.

## Prepare and recompute a release descriptor

```sh
python infra/gcp/confidential_vm_release.py prepare \
  --action first_provision \
  --target "$TARGET_ID" --project "$PROJECT_ID" --region "$REGION" \
  --artifact-repository "$ARTIFACT_REPOSITORY" \
  --repository-url "$SOURCE_REPOSITORY_URL" --commit "$MAIN_COMMIT_SHA" \
  --build-id "$SUCCESSFUL_BUILD_ID" \
  --build-json "$BUILD_CAPTURE" --trigger-json "$TRIGGER_CAPTURE" \
  --policy-json "$REVIEWED_POLICY" --output "$REVIEW_REQUEST"
```

For connected-repository provenance, also supply `--connected-repository` from
an independently verified resource-to-URL mapping. The request binds build/source,
policy digest, execution identity, checkpoint and an explicit action:

- `first_provision` requires no prior release or state pins. It does not initialize
  keys; first trusted public-key enrollment belongs to the actual target.
- `upgrade` requires `--baseline-json` for the latest independently trusted release
  record and a different, explicitly approved image. Original keys and state head
  stay pinned; this is not an implicit key/epoch migration.
- `restore` requires the same baseline and exactly the same approved image. It
  preserves the original keys/state head and cannot restore an older policy
  checkpoint or silently regenerate an identity.

For both later actions, a same-version checkpoint must have the same digest, and
a lower policy version is refused. The baseline fingerprint is an expected-state
CAS input, not evidence of global freshness. A producer must reread current policy,
release/state/outbox pins and revocation fences in its committing transaction.
A local old backup is not an authoritative baseline. Missing/current-state
uncertainty stops execution in the real target.

Use the same arguments with `validate --request-json "$REVIEW_REQUEST"` to
recompute and compare every byte. Editing `approval`, changing runtime, replacing
an image or mixing targets cannot pass. Only `prepare`, `validate` and `record`
exist; there is no deploy/apply/publish command. All requests retain
`approval.status=not_requested` and explicitly reference a separate reviewed
target infrastructure saved-plan workflow. Outputs use exclusive creation and
never overwrite existing evidence. Captured secret/log fields are not copied.

## Record post-deployment observations separately

The library `record_release` and CLI `record` accept the validated request plus
`--health-json` and separate `--pins-json`. Keep the build/trigger/policy/action
and prior-baseline arguments from validation. Trusted pins contain exactly
`original_key_ids` (`agent_signing`, `agent_encryption`, `tls`: distinct canonical
P-256 thumbprints) and `state_head`. Obtain these from independently accepted
Root enrollment/current state, not from the health response itself.

Health captures use `confidential_vm_attested.v1`, bind the exact request digest,
target/image/identity, numeric instance ID, original keys/state head and a current
Unix timestamp (no future time, at most 300 seconds old). The closed `checks`
object requires literal `true` for `attestation_verified`, `tls_key_bound`,
`policy_current`, `original_keys_proven`, `revocation_checked` and
`receipt_continuity_verified`. The normal Docker probe cannot substitute for this
profile; upgrade/restore cannot replace the original key/head pins. The record
copies only bounded allowed fields and retains immutable request/policy binds.

These files are **captured metadata, not authenticated attestation or deployment
authorization**. Booleans cannot prove hardware or private-key possession. Later
Policy/Executor/infra owners must verify real signed measurement, each original
key challenge, certificate binding, lease freshness and authoritative state before
using captures as evidence. Produced records explicitly carry
`capture_status=metadata_only_not_authorization`; successful local validation is
not successful provisioning, production acceptance or permission to apply.

The existing saved-plan/native-approval workflow remains the actual provisioning
gate. No VM API, credentials, billing, IAM, certificate, resource instance or
production state is touched by this foundation. Source/tool changes invalidate
saved configuration hashes where applicable; obtain a fresh target plan before
any later approved apply.
