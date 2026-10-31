# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
variables {
  deployment = {
    project_id           = "demo-web-alpha"
    region               = "us-central1"
    artifact_repository  = "web-images-alpha"
    runtime_account_id   = "browser-alpha-runtime"
    creation_image       = "us-central1-docker.pkg.dev/demo-web-alpha/web-images-alpha/market-web@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    existing_service_uid = "11111111-1111-4111-8111-111111111111"
  }
}

mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-web-alpha/serviceAccounts/browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
      email  = "browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-web-alpha/serviceAccounts/browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
    email  = "browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.web.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-web-alpha/locations/us-central1/services/market-web"
    uid = "11111111-1111-4111-8111-111111111111"
    uri = "https://market.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.web_boundary
  values = {
    uid                  = "11111111-1111-4111-8111-111111111111"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 2 }]
  }
}

run "legacy_has_no_owner_environment" {
  command = plan
  assert {
    condition     = length(local.environment) == 0
    error_message = "Legacy Web must keep its empty runtime environment."
  }
}

run "independent_flags_false_false" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "false", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "", "FOLIOVIEW_HUB_OWNER_ENABLED" : "false", "FOLIOVIEW_HUB_ORIGIN" : "" } }
  assert {
    condition     = local.environment == var.owner_environment && output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 2
    error_message = "Consume only the selected owner environment while preserving Web identity, access and capacities."
  }
}

run "independent_flags_true_false" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "false", "FOLIOVIEW_HUB_ORIGIN" : "" } }
  assert {
    condition     = local.environment == var.owner_environment && output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 2
    error_message = "Consume only the selected owner environment while preserving Web identity, access and capacities."
  }
}

run "independent_flags_false_true" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "false", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  assert {
    condition     = local.environment == var.owner_environment && output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 2
    error_message = "Consume only the selected owner environment while preserving Web identity, access and capacities."
  }
}

run "independent_flags_true_true" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  assert {
    condition     = local.environment == var.owner_environment && output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 2
    error_message = "Consume only the selected owner environment while preserving Web identity, access and capacities."
  }
}

run "reject_malformed_owner_config_0" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "other-project", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_1" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "TRUE", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_2" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "1", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_3" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://other.example", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_4" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "http://portfolio.example", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_5" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://hub.custom.example" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_6" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-222333444555.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_7" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.europe-west1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_8" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app/" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_9" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "false", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_10" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "false", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_11" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_12" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_13" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "true", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "FOLIOVIEW_HUB_OWNER_ENABLED" : "true", "FOLIOVIEW_HUB_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "EXTRA" : "unexpected" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_14" {
  command = plan
  variables { owner_environment = { "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID" : "demo-web-alpha", "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED" : "false", "FOLIOVIEW_PORTFOLIO_ORIGIN" : "", "FOLIOVIEW_PORTFOLIO_AUDIENCE" : "", "FOLIOVIEW_HUB_OWNER_ENABLED" : "false", "FOLIOVIEW_HUB_ORIGIN" : "" } }
  expect_failures = [var.owner_environment]
}

run "reject_malformed_owner_config_15" {
  command = plan
  variables { owner_environment = {} }
  expect_failures = [var.owner_environment]
}
