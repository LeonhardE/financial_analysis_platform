# Offline composition regression fixture

This is a test-only root for the shared module contracts. It is not a production
example, registered execution target, or supported apply configuration. Run only
backend-disabled initialization, validation, and the mocked `terraform test` here;
never run an authenticated plan or apply against it.

The fixture composes new build, caller, and runtime identities with one Secret
Manager metadata container, Cloud Run configuration, and a disabled build trigger.
It creates no secret payload or version. The image, build YAML, and version `1`
reference are illustrative test inputs and are not deployed resources.

The mocked provider overrides computed attributes only during apply, while the test
itself uses `command = plan`. Emails and resource IDs therefore remain unknown when
passed between modules. Stable logical map keys must still allow Terraform to plan
IAM grants; a set keyed by those computed identifiers would fail before apply.

The existing repository Terraform check discovers this root through `versions.tf`,
uses its pinned provider lock, and runs the native test without cloud credentials.
No backend, live execution target, or production resource instance is added.
