# Cloud Run configuration and release ownership

The shared module uses a conditional configuration writer so Terraform configuration changes can
coexist with image releases and traffic rollback. No production root is adopted by this foundation
PR. The earlier [native-provider failures](native-ownership-findings.md) remain frozen regression
coverage; passing those reproductions alone is not compatibility approval.

## Protocol

| Owner                                                               | Responsibility                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Native `google_cloud_run_v2_service.service`                        | Create/import identity, initial digest and defaults, deletion protection. `ignore_changes = all` prevents any native update PATCH. |
| `terraform_data.configuration` and `configure_cloud_run_service.py` | Desired runtime settings, environment/secret references, ingress; fresh live read and conditional etag update at apply time.       |
| `deploy_existing_service.py`                                        | Image release, deterministic release revision, build ordering markers and deliberate 100% latest traffic.                          |
| Explicit rollback                                                   | Pin traffic to a chosen immutable revision. Configuration apply never edits traffic.                                               |

The configuration controller contains no image, traffic, revision or etag captured during planning.
At execution it verifies the service UID, waits for settled reconciliation, copies the latest
single-container template, edits only its documented owned settings and assigns a fresh `-cfg-`
revision name. It preserves the live image, unknown supported template/container fields and unrelated
annotations. PATCH includes the live etag and excludes traffic. A 409/412 causes a fresh read/merge;
there is no unconditional overwrite fallback. Failed permissions, failed revisions and timeout
remain errors. Stale reads after an accepted write cannot cause duplicate PATCHes.

The image helper still uses conditional etag writes. A configuration update may land between an
image PATCH and its readiness poll. Exact config-revision/base-build annotations attest that
relationship; polling accepts it only with the same image, ready revision, observed generation and
100% latest traffic. A new image release removes the old attestation. Arbitrary Console changes are
not accepted as descendants. Existing short-service revision names remain unchanged; long names use
a deterministic shortened build suffix to stay within Cloud Run's 63-character limit.

## Rollback and drift semantics

When traffic is pinned to B while the desired template is C, config apply stages a newly named C
configuration template and **keeps B serving**. Immutable B keeps its old runtime configuration. The staged cfg template is not claimed to be
serving or independently ready while B is pinned. The helper reports
that distinction. The next explicitly authorized image release carries the staged settings and
chooses latest traffic. Configuration apply is never an implicit promotion or rollback cancellation.

An apply-ordered Google data source verifies the owned settings. When idle, external owned-setting
drift fails the plan with a repair instruction. Image/revision/traffic changes alone remain no-op.
To repair drift, review a plan with `-replace=module.<name>.terraform_data.configuration`; that
replacement only reruns the local controller and never destroys the service. This bridge detects
drift but does not automatically schedule repairs for out-of-band configuration changes. It has
no timestamp or observed-state-hash trigger that would create perpetual plans.

The target execution runner supports only explicitly enabled registry entries and exact registered
controller addresses. The current catalog enables `repo` alone and gives it no controller exception.
Each consumer PR must supply its root, isolated state/execution permissions and controller address
before activation. Actual resource deletion or replacement remains rejected. The saved-plan
configuration fingerprint includes both executable helpers.

## Offline validation

```bash
python3 infra/gcp/terraform_tools.py check --terraform /path/to/pinned/terraform
```

The pinned Terraform 1.16.7 / Google 7.28.0 run includes native mocked module contracts, five frozen
historical provider wire cases and five current ownership integration cases. Current cases execute
the actual module, provider and configuration subprocess against a strict localhost HTTP fixture:

- Release B followed by a clean plan.
- Apply an A-era saved configuration plan after B; retain B, apply the intended settings, then no-op.
- Fresh configuration plan after pinned-B rollback; stage C settings and preserve B traffic.
- Saved configuration plan followed by rollback; apply without cancelling rollback.
- Detect external owned drift, explicitly repair it, then no-op.

Unit tests inject etag conflicts won by a newer release or rollback, accepted-PATCH stale reads,
configuration-descendant release polling, failed readiness, UID replacement and authorization
errors. Localhost subprocess transport disables proxies and refuses non-loopback endpoints. These
are deterministic protocol tests, not real-cloud concurrency stress tests.

## Authenticated isolated verification

```bash
python3 infra/gcp/verify_release_ownership.py --live --project financial-analysis-512202 --terraform /absolute/path/to/terraform
```

The legacy executable name forwards to this current verifier. Historical classifier helpers remain
importable only to retain earlier regression evidence.

The explicit opt-in runner discovers three existing same-project immutable images, snapshots all
four production services, and creates one private min-0/max-1 request-billed service plus one
keyless runtime identity without role grants. It applies two actual saved configuration plans
across image release and traffic rollback, verifies markers and observed traffic, publishes a
subsequent image with the staged settings, and requires clean post-apply plans. Cleanup compares the
Terraform-recorded UID/account identity and independently checks deletion and unchanged production
fingerprints. No images are built and no application URLs, databases or AI APIs are invoked.

Cloud operations and logs can incur small charges; instance limits are not a spending cap. The
mode-0700 temporary folder retains raw state, plans and logs privately. `public-report.json` is an
explicit allowlist of snapshots/checks/source hashes without environment values or credentials.
Exit `0` / `PASS` requires every check and cleanup; incomplete evidence exits `1` / `ERROR`.

This live sequence uses synthetic build IDs and direct helper calls, not Cloud Build triggers or the
registered repo runner. Traffic rollback uses the Cloud Run API. Concurrency interleavings are
verified offline. Every production consumer still needs its own inventory/import/permissions and
end-to-end deployment validation PR.

## Authenticated result: 2026-10-23

**PASS: all 22 required checks passed** with Terraform 1.16.7 / Google provider 7.28.0 in Toronto.
The [sanitized evidence](live-ownership-results-2026-10-23.json) records actual desired and observed
traffic, images/revisions, plan scope and tested source hashes. The tested sources contained
uncommitted changes on the recorded base commit; file hashes identify the exact code.

| Stage                                           | Observed result                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Create A                                        | Ready, private min 0/max 1 request billing; baseline Terraform no-op.                                                          |
| Publish B, apply saved A-era configuration plan | Image B preserved, intended settings applied in a new cfg revision serving at 100%, release markers retained; next plan no-op. |
| Publish C, save config plan, pin rollback to B  | Desired template C; exact B revision receives 100% observed traffic.                                                           |
| Apply that saved plan during rollback           | New C configuration template staged; exact B traffic and C release markers retained; next plan no-op.                          |
| Publish the subsequent B image explicitly       | New release carries staged settings and receives 100% latest traffic; final Terraform no-op.                                   |
| Cleanup and independent production comparison   | Temporary service/account both return 404; all four production configuration fingerprints unchanged.                           |

The disposable service was `fv-compat-e289f01aa28a`. The check used existing immutable image digests
and synthetic verification build IDs. Concurrency conflict/polling interleavings passed offline;
this live sequence did not inject concurrent production traffic or execute Cloud Build triggers.

References:

- [Cloud Run Service etag](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
- [Cloud Run conditional PATCH and update mask](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch)
- [Terraform data controller](https://developer.hashicorp.com/terraform/language/resources/terraform-data)
- [Pinned native provider implementation](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/services/cloudrunv2/resource_cloud_run_v2_service.go)
