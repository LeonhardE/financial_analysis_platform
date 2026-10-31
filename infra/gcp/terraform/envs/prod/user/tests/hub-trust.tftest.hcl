variables {
  deployment = {
    project_id           = "demo-user-alpha"
    region               = "us-central1"
    artifact_repository  = "alpha-images"
    runtime_account_id   = "alpha-user-runtime"
    creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    existing_service_uid = "33333333-3333-4333-8333-333333333333"
    web_origin           = "https://web.alpha.example.invalid"
    market_origin        = "https://market.alpha.example.invalid"
  }
}

# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-user-alpha/serviceAccounts/alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
      email  = "alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-user-alpha/serviceAccounts/alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
    email  = "alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.user.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-user-alpha/locations/us-central1/services/user-api"
    uid = "33333333-3333-4333-8333-333333333333"
    uri = "https://user.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.user_boundary
  values = {
    uid                  = "33333333-3333-4333-8333-333333333333"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 1 }]
  }
}

run "legacy_profile_stays_closed" {
  command = plan
  assert {
    condition     = toset(keys(local.environment)) == toset(["FIREBASE_PROJECT_ID", "CORS_ORIGINS", "FIRESTORE_DATABASE", "USER_STORE_BACKEND", "MARKET_API_BASE_URL"]) && length(local.hub_trust_environment) == 0
    error_message = "Legacy User environment must be unchanged and Hub trust absent."
  }
}

run "explicit_disabled_stays_closed" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "", "USER_DELEGATION_AUDIENCE" : "", "USER_DELEGATION_ISSUER" : "", "USER_TRUSTED_HUB_CALLERS" : "" } }
  assert {
    condition     = toset(keys(local.environment)) == toset(["FIREBASE_PROJECT_ID", "CORS_ORIGINS", "FIRESTORE_DATABASE", "USER_STORE_BACKEND", "MARKET_API_BASE_URL"]) && length(local.hub_trust_environment) == 0
    error_message = "User trust settings and adoption boundaries must match the explicit reviewed contract."
  }
}

run "exact_pinned_hub_trust" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  assert {
    condition     = local.hub_trust_environment == var.hub_trust && local.environment.USER_SERVICE_AUDIENCE == var.hub_trust.USER_SERVICE_AUDIENCE && local.environment.FIRESTORE_DATABASE == "(default)" && output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 1
    error_message = "User trust settings and adoption boundaries must match the explicit reviewed contract."
  }
}

run "reject_wrong_service_audience" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_region" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.europe-west1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_delegation_audience" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_issuer" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://untrusted.example.invalid", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_issuer_project" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-999888777666.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_foreign_runtime" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"hub-runtime@foreign-project.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_self_runtime" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_noncanonical_callers" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : " {\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_non_numeric_subject" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"self-reported\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_leading_zero_subject" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"0123\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_multiple_callers" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\",\"456\":\"other-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_malformed_callers" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "not-json" } }
  expect_failures = [var.hub_trust]
}

run "reject_partial_disabled" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_extra_environment" {
  command = plan
  variables { hub_trust = { "USER_SERVICE_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app", "USER_DELEGATION_AUDIENCE" : "https://user-api-111222333444.us-central1.run.app/internal/v2", "USER_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "USER_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-user-alpha.iam.gserviceaccount.com\"}", "USER_JWKS_URL" : "https://wrong.invalid" } }
  expect_failures = [var.hub_trust]
}
