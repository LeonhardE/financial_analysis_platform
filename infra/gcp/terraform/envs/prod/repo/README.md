# Repo execution configuration

This root keeps the existing `terraform_data.execution_contract` address and
backend prefix `prod/repo`. It owns no Cloud Run service, database, execution
identity, trigger or IAM grant. `deployment` is required and contains exactly
one valid `project_id`; there is no author-project default.

The catalog opts only `repo` into `deployment_source: trigger-v1`. The shared
runtime reads the canonical target-instance JSON and SHA-256 from the existing
administrator-owned repo triggers, validates actual build/trigger metadata and
source, and writes the sole allowed variable file outside the Terraform source.
The projection contains project/region/source and the two existing trigger
UUID anchors. Those values belong to the ignored operator profile. Other
catalog targets retain their previously reviewed source/activation and inputs.

The administrator compiles and reviews the repo projection from an explicit
profile, using the credential-free producer:

```sh
python3 infra/gcp/deployment_profile.py compile \
  --profile .deployment/profile.json --target repo \
  --output-dir .deployment/repo-review
```

The output is a candidate, not production activation or approval. Retain the
existing bootstrap backend and operator stages (`portfolio=service` after its
creation; Hub remains at its actual unprovisioned stage). Do not reinitialize
an empty state, migrate a backend, create a source connection or change project,
region, service identities, images or any other target as part of this cleanup.
The bootstrap now requires explicit `project_id`, `region`, `repository_id` and
matching `deployment_configs.repo` from reviewed operator input; local ignored
files never automatically reach Cloud Build.

Review a complete administrator bootstrap plan. Only the two existing repo
triggers may gain the canonical projection/SHA and the repo plan dependency
filter. Existing IDs, main-only source, execution accounts, native approval,
resource addresses and all other targets must remain unchanged. The repo root
plan must preserve its existing project input and produce no managed changes.
Quiesce repo plan/apply executions before changing the main catalog or trigger
configuration, then resume after the reviewed bootstrap transition. Generate new
saved plans after the reviewed
configuration/runner source changes. Keep the exact source/digest, six-hour
age, backend generation, lineage/serial, locking, saved-plan-only apply and
configuration ownership checks; the ordinary runner cannot administer bootstrap.

Offline provider-free root tests use two synthetic projects and reject invalid,
missing or unknown inputs. Bootstrap provider-mocked tests load the shared
[test-only projections](../../../bootstrap/tests/fixtures/README.md), explicitly
supply legacy instance values and test repo metadata plus mixed-input rejection.
The unused non-repo projections support later independent consumer tests without
changing current legacy triggers.
No cloud resource is created by this source change; activation and its complete
plan review remain separate operator actions.
