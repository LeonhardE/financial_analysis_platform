# Service build trigger

Defines one regional Cloud Build push trigger for one service or client, using an
existing v2 repository connection and build service account. It grants no IAM
permissions and creates no repository connection, artifact repository, or runtime
service. This shared module has no production instances yet.

The trigger watches only `main`. Callers must supply an explicit `included_files`
list for their target and shared dependencies; repository-wide wildcard filters
are rejected. The build configuration `filename` is added automatically to these
filters, so changes to the target's build configuration produce a build. Markdown
files are ignored by default.

New triggers default to `disabled = true` and `deploy_enabled = false`. A disabled
trigger is not a deployment gate for an already running build. Enable the trigger
only in the target's separate adoption PR after its existing resources and
permissions are verified. Enable deployment only after the separate release
compatibility change proves that Terraform adoption preserves deployed revisions,
traffic, and runtime settings. This module merely passes `_DEPLOY_SERVICE` to the
build configuration; that configuration must implement the build-only behavior.

## Inputs

| Input                   | Purpose                                                | Default                               |
| ----------------------- | ------------------------------------------------------ | ------------------------------------- |
| `project_id`            | Existing project ID                                    | Required                              |
| `region`                | Trigger and repository region                          | `northamerica-northeast2`             |
| `name`                  | Unique target trigger name                             | Required                              |
| `repository_id`         | Full v2 repository resource in that project and region | Required                              |
| `build_service_account` | Full same-project service account resource name        | Required                              |
| `filename`              | Repository-relative YAML build configuration path      | Required                              |
| `included_files`        | Explicit target and dependency path filters            | Required                              |
| `ignored_files`         | Ignored push paths                                     | `["**/*.md"]`                         |
| `substitutions`         | Additional `_UPPER_CASE` custom substitutions          | `{}`                                  |
| `disabled`              | Disable event-triggered builds                         | `true`                                |
| `deploy_enabled`        | Set `_DEPLOY_SERVICE` for the build configuration      | `false`                               |
| `description`           | Human-readable trigger purpose                         | Build one service or client from main |

The module owns `_REGION` and `_DEPLOY_SERVICE`; caller substitutions cannot replace
them, and substitution values cannot be null. Resource paths use the supplied
project ID rather than a project number so
validation can prove that the repository and identity are in the same project.
Use substitutions for nonsecret metadata or resource references, never credentials;
Terraform stores their values in state and Cloud Build exposes them as build metadata.

Outputs are `id` (full resource ID), `trigger_id` (UUID), and `name`. The resource
uses `prevent_destroy`; adoption should import the existing trigger into this
address instead of creating a duplicate. `prevent_destroy` blocks a planned
destruction while its resource configuration remains present; removing the entire
module removes that lifecycle guard.

## Validation

Run `terraform init -backend=false -lockfile=readonly` and `terraform test` from this
directory. Tests mock Google Cloud; they do not create cloud resources or prove
live IAM permissions and regional product availability.

Provider schema: [google_cloudbuild_trigger at Google provider v7.28.0](https://registry.terraform.io/providers/hashicorp/google/7.28.0/docs/resources/cloudbuild_trigger).
