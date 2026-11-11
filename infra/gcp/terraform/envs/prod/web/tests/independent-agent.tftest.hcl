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
  owner_environment = jsondecode(<<-JSON
{
  "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID": "demo-web-alpha",
  "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED": "false",
  "FOLIOVIEW_PORTFOLIO_ORIGIN": "",
  "FOLIOVIEW_PORTFOLIO_AUDIENCE": "",
  "FOLIOVIEW_HUB_OWNER_ENABLED": "true",
  "FOLIOVIEW_HUB_ORIGIN": "https://agent-hub-api-111222333444.us-central1.run.app",
  "FOLIOVIEW_INDEPENDENT_AGENT_ENABLED": "true",
  "FOLIOVIEW_INDEPENDENT_AGENT_CONFIG": "{\"audience\":\"https://executor.example.com/mcp\",\"clientId\":\"native_client\",\"connectionId\":\"independent_demo\",\"issuer\":\"https://policy.example.com\",\"nativeRedirectUris\":[\"https://chatgpt.com/connector_platform/oauth/callback\"],\"policyJwk\":{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"dB3VvagX2V5GJlNzIOXVUXmYMCiy-CyZ1QDF7oYk48Q\",\"y\":\"B3C0apw4X9xWc4NVSIexVI7rkSw1ulynGZX_Is1EgdM\"}}"
}
JSON
  )
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

run "reject_retired_independent_pair" {
  command         = plan
  expect_failures = [var.owner_environment]
}
run "reject_incomplete_retired_pair" {
  command = plan
  variables { owner_environment = { for k, v in var.owner_environment : k => v if k != "FOLIOVIEW_INDEPENDENT_AGENT_CONFIG" } }
  expect_failures = [var.owner_environment]
}
run "reject_disabled_retired_pair" {
  command = plan
  variables { owner_environment = merge(var.owner_environment, { FOLIOVIEW_INDEPENDENT_AGENT_ENABLED = "false" }) }
  expect_failures = [var.owner_environment]
}
run "personal_agent_uses_only_existing_owner_environment" {
  command = plan
  variables { owner_environment = { for k, v in var.owner_environment : k => v if !startswith(k, "FOLIOVIEW_INDEPENDENT_AGENT_") } }
  assert {
    condition = (local.environment == var.owner_environment && length(local.environment) == 6 &&
      output.adoption_boundary.invoker_iam_disabled && output.adoption_boundary.service_max_instances == 2 &&
    output.runtime_service_account == "browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com")
    error_message = "Personal Agent support needs only the existing Hub Owner origin; retain service identity, invocation and capacity boundaries."
  }
}
