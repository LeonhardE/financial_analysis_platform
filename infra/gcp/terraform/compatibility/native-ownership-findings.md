# Historical native-provider ownership findings

This records the pre-fix implementation tested in PR #14. The current guarded protocol is
documented in [the compatibility guide](README.md); these findings remain regression coverage.

## Authenticated GCP result: 2026-10-23

Result: **BLOCKED — do not adopt production services with the current ownership model.**
The [sanitized live evidence](live-results-2026-10-23.json) records Google provider 7.28.0 and
Terraform 1.16.7 in Toronto. The disposable service was `fv-compat-64feaca0fa9c`; no existing service,
trigger or IAM grant was modified. No new images were built and no application URLs were called.

| Stage                                                   | Observed GCP result                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create image A                                          | Service became ready; the initial Terraform plan was a no-op.                                                                                                                   |
| Save an environment-change plan, then publish B         | B became ready with 100% observed traffic. A fresh plan proposed B → A image restoration, separately from the intended environment change.                                      |
| Apply the pre-B saved plan                              | Terraform exited `0`; the service became ready on A with 100% traffic on its new revision. The newer B release was overwritten. Its deployment marker was also cleared.         |
| Publish C, then route traffic back to B through the API | C became ready; the subsequent rollback served the exact B revision with 100% observed traffic while the desired template still referenced C.                                   |
| Inspect the post-rollback Terraform plan                | The plan proposed C → A and B-pinned traffic → `LATEST`. This plan was **not applied**.                                                                                         |
| Cleanup and production check                            | The test service and account independently returned HTTP `404`. All four existing services retained their UID, etag, generation, ready revision and configuration fingerprints. |

The authenticated run used verifier source commit `c51ff3f7df62b59284c50219510329dc52f9b8cd`.
Exact release-field summaries were then extracted locally from its retained native plan JSON and
classified with the hardened classifier, without repeating cloud mutations. Raw state, plans,
credentials, environment values and private diagnostic logs are not committed.

The classifier now records image/revision/traffic before and after, distinguishes intended
environment changes from release drift, and requires a no-op baseline and an observed 100% rollback
to B. A failed apply alone cannot prove an overwrite. Tests include both the recorded live evidence
and environment-only changes that must not be classified as compatibility blockers.

This run isolates the native provider and shared release helper on private local test state. The
registered repo-only saved-plan runner was not involved, and its provenance/state guards remain
unchanged. This is not an end-to-end verification of a future registered service target. The helper was
called directly with validation-generated build labels, rather than through a production Cloud
Build trigger. The rollback used the Cloud Run API, not browser UI automation. Naive-ignore revision
conflicts and other candidate protocols remain offline regressions; no compatible replacement
protocol has been live-verified.

The five frozen localhost cases in `provider_check.py` retain the native-provider failures:
full-template image replay, immutable revision reuse, saved-plan image replay, serving/template
divergence during rollback, and saved-plan traffic replay. They intentionally report blocked;
`ownership_check.py` separately requires the current module to pass the corrected scenarios.
