variables {
  deployment = {
    project_id           = "demo-folio-alpha"
    region               = "us-central1"
    artifact_repository  = "folio-images"
    runtime_account_id   = "folio-portfolio-runtime"
    creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/portfolio-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    existing_service_uid = "11111111-1111-4111-8111-111111111111"
    web_origin           = "https://web.alpha.example.invalid"
  }
}

# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-folio-alpha/serviceAccounts/folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com"
      email  = "folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-folio-alpha/serviceAccounts/folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com"
    email  = "folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.portfolio.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-folio-alpha/locations/us-central1/services/portfolio-api"
    uid = "11111111-1111-4111-8111-111111111111"
    uri = "https://user.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.portfolio_boundary
  values = {
    uid                  = "11111111-1111-4111-8111-111111111111"
    invoker_iam_disabled = false
    scaling              = [{ max_instance_count = 12 }]
  }
}

run "legacy_profile_stays_closed" {
  command = plan
  assert {
    condition     = toset(keys(local.environment)) == toset(["FIREBASE_PROJECT_ID", "CORS_ORIGINS", "FIRESTORE_DATABASE", "PORTFOLIO_STORE_BACKEND"]) && length(local.hub_trust_environment) == 0
    error_message = "Legacy Portfolio environment must be unchanged and Hub trust absent."
  }
}

run "explicit_disabled_stays_closed" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "", "PORTFOLIO_DELEGATION_AUDIENCE" : "", "PORTFOLIO_DELEGATION_ISSUER" : "", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "" } }
  assert {
    condition     = toset(keys(local.environment)) == toset(["FIREBASE_PROJECT_ID", "CORS_ORIGINS", "FIRESTORE_DATABASE", "PORTFOLIO_STORE_BACKEND"]) && length(local.hub_trust_environment) == 0
    error_message = "Portfolio trust settings and adoption boundaries must match the explicit reviewed contract."
  }
}

run "exact_pinned_hub_trust" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  assert {
    condition     = local.hub_trust_environment == var.hub_trust && local.environment.PORTFOLIO_SERVICE_AUDIENCE == var.hub_trust.PORTFOLIO_SERVICE_AUDIENCE && local.environment.FIRESTORE_DATABASE == "portfolio" && !output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 12
    error_message = "Portfolio trust settings and adoption boundaries must match the explicit reviewed contract."
  }
}

run "reject_wrong_service_audience" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://config-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_region" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.europe-west1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_delegation_audience" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_issuer" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://untrusted.example.invalid", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://untrusted.example.invalid", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_wrong_issuer_project" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-999888777666.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-999888777666.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_foreign_runtime" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"hub-runtime@foreign-project.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_self_runtime" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"folio-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_noncanonical_callers" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : " {\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_non_numeric_subject" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"self-reported\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_leading_zero_subject" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"0123\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_multiple_callers" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\",\"456\":\"other-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_malformed_callers" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "not-json" } }
  expect_failures = [var.hub_trust]
}

run "reject_partial_disabled" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}" } }
  expect_failures = [var.hub_trust]
}

run "reject_extra_environment" {
  command = plan
  variables { hub_trust = { "PORTFOLIO_SERVICE_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app", "PORTFOLIO_DELEGATION_AUDIENCE" : "https://portfolio-api-111222333444.us-central1.run.app/internal/v2", "PORTFOLIO_DELEGATION_ISSUER" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_HUB_AUTHORITY_ORIGIN" : "https://agent-hub-api-111222333444.us-central1.run.app", "PORTFOLIO_TRUSTED_HUB_CALLERS" : "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}", "PORTFOLIO_JWKS_URL" : "https://wrong.invalid" } }
  expect_failures = [var.hub_trust]
}

run "reject_alternate_authority_endpoint" {
  command = plan
  variables { hub_trust = {
    PORTFOLIO_SERVICE_AUDIENCE     = "https://portfolio-api-111222333444.us-central1.run.app"
    PORTFOLIO_DELEGATION_AUDIENCE  = "https://portfolio-api-111222333444.us-central1.run.app/internal/v2"
    PORTFOLIO_DELEGATION_ISSUER    = "https://agent-hub-api-111222333444.us-central1.run.app"
    PORTFOLIO_TRUSTED_HUB_CALLERS  = "{\"123456789012345678901\":\"alpha-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com\"}"
    PORTFOLIO_HUB_AUTHORITY_ORIGIN = "https://attacker.example.invalid"
  } }
  expect_failures = [var.hub_trust]
}

run "opaque_content_and_public_proofs_are_unindexed_without_ttl" {
  command = plan
  assert {
    condition     = length(google_firestore_field.opaque) == 11 && alltrue([for field in google_firestore_field.opaque : field.database == "portfolio" && length(field.index_config) == 1 && length(field.index_config[0].indexes) == 0 && length(field.ttl_config) == 0]) && contains(local.unindexed_fields.portfolio_snapshots, "carrierJson") && contains(local.unindexed_fields.portfolio_authorities, "registryHistory")
    error_message = "Only the eleven implemented opaque fields are exempted; no TTL or other database is configured."
  }
}
