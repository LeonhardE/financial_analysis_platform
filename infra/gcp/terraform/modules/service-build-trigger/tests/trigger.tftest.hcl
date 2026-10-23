mock_provider "google" {}

variables {
  project_id            = "example-project"
  name                  = "build-research-api"
  repository_id         = "projects/example-project/locations/northamerica-northeast2/connections/github/repositories/application"
  build_service_account = "projects/example-project/serviceAccounts/example-build@example-project.iam.gserviceaccount.com"
  filename              = "infra/gcp/cloudbuild.research.yaml"
  included_files        = ["services/research-service/**", "packages/contracts/**"]
}

run "safe_defaults_and_target_path_filters" {
  command = plan

  assert {
    condition = (
      google_cloudbuild_trigger.this.disabled &&
      google_cloudbuild_trigger.this.substitutions["_DEPLOY_SERVICE"] == "false" &&
      google_cloudbuild_trigger.this.substitutions["_REGION"] == "northamerica-northeast2" &&
      google_cloudbuild_trigger.this.repository_event_config[0].push[0].branch == "^main$" &&
      google_cloudbuild_trigger.this.repository_event_config[0].repository == var.repository_id &&
      google_cloudbuild_trigger.this.service_account == var.build_service_account &&
      google_cloudbuild_trigger.this.filename == var.filename &&
      toset(google_cloudbuild_trigger.this.included_files) == toset(concat(var.included_files, [var.filename])) &&
      toset(google_cloudbuild_trigger.this.ignored_files) == toset(["**/*.md"])
    )
    error_message = "New target triggers must be disabled, build-only, main-only, and explicitly path-filtered."
  }
}

run "explicit_target_opt_in" {
  command = plan
  variables {
    disabled       = false
    deploy_enabled = true
    substitutions  = { _SERVICE_NAME = "research-api", _REPOSITORY = "application-images" }
    ignored_files  = ["**/*.md", "services/research-service/docs/**"]
  }

  assert {
    condition = (
      !google_cloudbuild_trigger.this.disabled &&
      google_cloudbuild_trigger.this.substitutions["_DEPLOY_SERVICE"] == "true" &&
      google_cloudbuild_trigger.this.substitutions["_SERVICE_NAME"] == "research-api" &&
      google_cloudbuild_trigger.this.substitutions["_REGION"] == "northamerica-northeast2" &&
      contains(google_cloudbuild_trigger.this.ignored_files, "services/research-service/docs/**")
    )
    error_message = "Only explicit target input should activate the trigger and deployment, preserving custom substitutions."
  }
}

run "reject_repository_in_another_project" {
  command = plan
  variables {
    repository_id = "projects/another-project/locations/northamerica-northeast2/connections/github/repositories/application"
  }
  expect_failures = [var.repository_id]
}

run "reject_repository_in_another_region" {
  command = plan
  variables {
    repository_id = "projects/example-project/locations/us-central1/connections/github/repositories/application"
  }
  expect_failures = [var.repository_id]
}

run "reject_build_identity_in_another_project" {
  command = plan
  variables {
    build_service_account = "projects/another-project/serviceAccounts/example-build@another-project.iam.gserviceaccount.com"
  }
  expect_failures = [var.build_service_account]
}

run "reject_bare_service_account_email" {
  command = plan
  variables {
    build_service_account = "example-build@example-project.iam.gserviceaccount.com"
  }
  expect_failures = [var.build_service_account]
}

run "reject_empty_path_filters" {
  command = plan
  variables {
    included_files = []
  }
  expect_failures = [var.included_files]
}

run "reject_repository_wide_glob" {
  command = plan
  variables {
    included_files = ["**/*"]
  }
  expect_failures = [var.included_files]
}

run "reject_root_wildcard" {
  command = plan
  variables {
    included_files = ["*.json"]
  }
  expect_failures = [var.included_files]
}

run "reject_filter_traversal" {
  command = plan
  variables {
    included_files = ["services/../**"]
  }
  expect_failures = [var.included_files]
}

run "reject_absolute_build_filename" {
  command = plan
  variables {
    filename = "/infra/gcp/cloudbuild.research.yaml"
  }
  expect_failures = [var.filename]
}

run "reject_build_filename_traversal" {
  command = plan
  variables {
    filename = "infra/../cloudbuild.research.yaml"
  }
  expect_failures = [var.filename]
}

run "reject_reserved_deploy_substitution" {
  command = plan
  variables {
    substitutions = { _DEPLOY_SERVICE = "true" }
  }
  expect_failures = [var.substitutions]
}

run "reject_reserved_region_substitution" {
  command = plan
  variables {
    substitutions = { _REGION = "us-central1" }
  }
  expect_failures = [var.substitutions]
}

run "reject_builtin_substitution_override" {
  command = plan
  variables {
    substitutions = { COMMIT_SHA = "not-an-output-provenance" }
  }
  expect_failures = [var.substitutions]
}

run "reject_null_substitution_value" {
  command = plan
  variables {
    substitutions = { _SERVICE_NAME = null }
  }
  expect_failures = [var.substitutions]
}

run "null_optional_flags_keep_safe_defaults" {
  command = plan
  variables {
    disabled       = null
    deploy_enabled = null
  }

  assert {
    condition = (
      google_cloudbuild_trigger.this.disabled &&
      google_cloudbuild_trigger.this.substitutions["_DEPLOY_SERVICE"] == "false"
    )
    error_message = "Null optional flags must resolve to disabled and build-only defaults."
  }
}

run "reject_ignored_filter_traversal" {
  command = plan
  variables {
    ignored_files = ["../**"]
  }
  expect_failures = [var.ignored_files]
}
