# Cloud Run release compatibility verification

This is a shared infrastructure verification fixture, not a production execution root. It does not
adopt Market, User, Config or Web, change their triggers, or relax the Cloud Run module's adoption
gate. The module and the existing image release helper still have incompatible ownership of the
same service. A successful regression test means the known incompatibility was reproduced; it does
**not** mean production adoption is safe.

## What the checks establish

The offline check runs the repository-pinned Terraform CLI and real Google **7.28.0** provider
against a localhost Cloud Run API emulator. It captures the provider's actual requests rather than
using Terraform's mocked provider. The emulator is a deterministic protocol test; it does not prove
Google's live IAM, reconciliation or revision behavior.

| Scenario                                                                 | Expected blocking evidence                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Create with image A, then release B using the existing helper            | A fresh Terraform plan restores image A, and the provider PATCH submits A.                                          |
| Ignore image, traffic and revision, then change configuration            | A clean post-release plan hides the provider reusing an immutable revision name during the configuration update.    |
| Save a configuration plan on B, then release C                           | Applying the saved plan submits stale B without an etag and overwrites C in the fixture.                            |
| Release C, then roll traffic back to B before a fresh configuration plan | The desired template stays on C, while immutable serving revision B keeps the old configuration.                    |
| Save a configuration plan, then roll traffic back to B                   | Applying the saved plan submits stale latest-revision traffic without an etag, undoing the rollback in the fixture. |

The pinned provider serializes the full template and traffic on update, but does not attach the
service etag. Ignoring a field affects Terraform planning; it does not make the resulting API write
conditional. A freshness check immediately before apply still leaves a race before the PATCH, and
Terraform's GCS state lock does not coordinate with releases or Console rollback.

## Run without cloud resources

From the repository root, install the checksum-verified CLI if needed, then run:

```bash
python3 infra/gcp/terraform_tools.py install --directory /tmp/folioview-terraform-tools
python3 infra/gcp/terraform_tools.py check --terraform /tmp/folioview-terraform-tools/terraform
```

The check uses temporary local Terraform state and the committed provider lock. It needs no GCP
credentials and must only send Cloud Run requests to its localhost emulator. An unexpected provider
request, missing blocking evidence, or command failure is a test failure. Do not change expected
results merely to make a provider upgrade pass: review the captured behavior and the ownership
protocol again.

The repository check initializes the pinned provider first and then runs the wire cases. To repeat
only the wire cases after initialization, use `provider_check.py --terraform /path/to/terraform`
from this directory. Its optional `--report /private/local/path.json` writes the sanitized result.
The standalone script uses an existing provider filesystem mirror; it does not download a provider.
All five expected blockers must be reproduced for exit code `0`. Its JSON then reports
`verification_passed: true`, `compatible: false` and `compatibility_status: "blocked"`. Exit code `1`
means a failed regression or incomplete check; neither outcome authorizes production adoption.

## Optional live reproduction in Cloud Shell

Live verification is separate and requires the explicit `--live` option. It has **not** been run in
the development environment; no authenticated GCP result is claimed by the offline tests. Use the
existing project administrator in Cloud Shell, with the reviewed PR branch checked out and the
pinned Terraform installed:

```bash
python3 infra/gcp/verify_release_compatibility.py --live --project financial-analysis-512202 --region northamerica-northeast2 --terraform "$HOME/folioview-terraform-tools/terraform"
```

The wrapper discovers three existing `market-api` image digests in the project's
`financial-analysis` Artifact Registry repository. It does not build images or change production
services. It creates one uniquely named temporary private Cloud Run service and one keyless runtime
account with no granted roles. Tests release the existing digests and simulate rollback by selecting
an older revision's traffic through the API; Console uses the same Cloud Run traffic model.

The temporary service uses request billing and min 0/max 1 instances. There are no AI calls, database
writes, scheduled jobs or paid warm instances. Cloud Run operations, image pulls and logging can
still incur costs; the instance setting limits capacity rather than imposing a hard spending cap.

Cleanup verifies resource identity before deletion and reports incomplete cleanup. If the process
is interrupted, inspect its reported temporary names in Cloud Run and IAM before removing those
resources. Never substitute a production service name or weaken production deletion protection.

Read the report's individual scenarios and cleanup results. Expected findings leave the result
**blocked**. Authentication/API errors, insufficient image history, failed reconciliation or cleanup
failure are incomplete live verification, not proof of compatibility. Retain private diagnostics
for review; do not commit Terraform state or plans.

The wrapper prints the exact path to `report.json` in its private mode-0700 temporary folder.
That folder also retains numbered Terraform logs, local state and saved plans for diagnosis.
`BLOCKED` exits with code `2`: native ownership drift was observed and the adoption gate remains
closed. `ERROR` or `UNEXPECTED_RESULT` exits with code `1` and needs inspection, including any cleanup
errors. This verifier has no compatibility-approved success result. Offline and live exit codes
intentionally differ because CI asserts the known blockers while the live tool reports their
operational outcome.

## Required follow-up before adopting a service

Keep the adoption gate closed until one reviewed ownership protocol is implemented and verified.
Viable directions are a single configuration writer that preserves release state with conditional
etag updates, or exclusive Terraform ownership of image releases and rollback. Repeating a narrower
`ignore_changes` list or adding a non-atomic pre-apply check does not address the demonstrated race.
Adopt each consuming service in its own later `infra(<target>)` PR after that protocol is proven.

Primary references:

- [Pinned provider revision schema and update implementation](https://github.com/hashicorp/terraform-provider-google/blob/v7.28.0/google/services/cloudrunv2/resource_cloud_run_v2_service.go)
- [Cloud Run Service etag and revision template](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
- [Cloud Run PATCH updateMask](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch)
