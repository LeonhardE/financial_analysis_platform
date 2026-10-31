# Native provider plans only: no credentials, apply or provisioner execution.
mock_provider "google" { override_during = plan }

override_resource {
  override_during = plan
  target          = google_kms_key_ring.delegation
  values          = { id = "projects/example-project-1234/locations/europe-west3/keyRings/folioview-agent-hub" }
}
override_resource {
  override_during = plan
  target          = google_kms_crypto_key.delegation
  values          = { id = "projects/example-project-1234/locations/europe-west3/keyRings/folioview-agent-hub/cryptoKeys/delegation-signing" }
}
variables {
  deployment = {
    project_id          = "example-project-1234"
    region              = "europe-west3"
    artifact_repository = "example-images"
    runtime_account_id  = "example-hub-runtime"
    creation_image      = "europe-west3-docker.pkg.dev/example-project-1234/example-images/agent-hub-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    web_origin          = "https://web.example.invalid"
    hub_origin          = "https://hub.example.invalid"
  }
}

run "hub_inputs_are_explicit_portable_and_bounded" {
  command = plan
  assert {
    condition = (
      module.database.database_id == "agent-hub" &&
      module.database.location_id == var.deployment.region &&
      output.database_resource_name == "projects/example-project-1234/databases/agent-hub" &&
      output.service.name == "agent-hub-api" &&
      output.creation_configuration.min_instances == 0 &&
      output.creation_configuration.max_instances == 1 &&
      output.creation_configuration.concurrency == 8 &&
      output.creation_configuration.timeout_seconds == 60 &&
      output.creation_configuration.environment.FIREBASE_PROJECT_ID == var.deployment.project_id &&
      output.creation_configuration.environment.AGENT_HUB_STORE_BACKEND == "firestore" &&
      output.creation_configuration.environment.CORS_ORIGINS == var.deployment.web_origin &&
      !contains(keys(output.creation_configuration.environment), "HUB_STORE_BACKEND")
    )
    error_message = "Use the selected instance, exact named database, current backend setting and bounded private first creation."
  }
}

run "operational_signer_never_becomes_a_content_key" {
  command = plan
  assert {
    condition = (
      google_kms_crypto_key.delegation.purpose == "ASYMMETRIC_SIGN" &&
      google_kms_crypto_key.delegation.version_template[0].algorithm == "RSA_SIGN_PKCS1_2048_SHA256" &&
      google_kms_crypto_key.delegation.version_template[0].protection_level == "SOFTWARE" &&
      !google_kms_crypto_key.delegation.skip_initial_version_creation &&
      output.creation_configuration.environment.HUB_KMS_SIGNING_KEY_VERSION == "projects/example-project-1234/locations/europe-west3/keyRings/folioview-agent-hub/cryptoKeys/delegation-signing/cryptoKeyVersions/1" &&
      output.creation_configuration.environment.HUB_SERVICE_AUDIENCE == var.deployment.hub_origin &&
      output.creation_configuration.environment.HUB_CATALOGUE_CALLER_EMAIL == "example-hub-runtime@example-project-1234.iam.gserviceaccount.com"
    )
    error_message = "Only a pinned asymmetric delegation-signing version is configured; no content decryption key or exported key bytes."
  }
}

run "current_opaque_storage_has_index_exemptions_without_ttl" {
  command = plan
  assert {
    condition = (
      length(google_firestore_field.opaque) == 35 &&
      alltrue([for field in google_firestore_field.opaque : field.database == "agent-hub" && length(field.index_config) == 1 && length(field.index_config[0].indexes) == 0 && length(field.ttl_config) == 0]) &&
      length(module.database.ttl_field_names) == 0 &&
      length(module.database.composite_index_names) == 0 &&
      output.index_exemptions.hub_task_versions_carrierJson.field == "carrierJson" &&
      output.index_exemptions.hub_result_revisions_bundleJson.collection == "hub_result_revisions" &&
      output.index_exemptions.hub_vault_lifecycle_history.field == "history"
    )
    error_message = "Only implemented opaque fields lose indexes; no grant/history/operation/cursor document is assigned TTL."
  }
}

run "protocol_flags_and_unknown_source_trust_fail_closed" {
  command = plan
  assert {
    condition = (
      output.creation_configuration.environment.HUB_OAUTH_ENABLED == "0" &&
      output.creation_configuration.environment.HUB_ENCRYPTED_ADAPTER_ENABLED == "0" &&
      output.creation_configuration.environment.HUB_OAUTH_CLIENTS_JSON == "[]" &&
      output.creation_configuration.environment.HUB_OAUTH_ISSUER == var.deployment.hub_origin &&
      output.creation_configuration.environment.HUB_OAUTH_CONSENT_URL == "https://hub.example.invalid/agent/v2/helper/consent.html" &&
      output.creation_configuration.environment.HUB_TRUSTED_PORTFOLIO_CALLERS == "{}" &&
      output.creation_configuration.environment.HUB_PORTFOLIO_CALLER_EMAIL == "" &&
      output.creation_configuration.environment.HUB_USER_ORIGIN == "" &&
      output.creation_configuration.environment.HUB_PORTFOLIO_ORIGIN == ""
    )
    error_message = "No implicit agent registration, source trust or public OAuth/adapter enablement."
  }
}

run "exact_registered_muse_and_21_digit_portfolio_subject_are_supported" {
  command = plan
  variables {
    sources = {
      user_origin               = "https://user.example.invalid"
      portfolio_origin          = "https://portfolio.example.invalid"
      portfolio_caller_email    = "example-portfolio@example-project-1234.iam.gserviceaccount.com"
      trusted_portfolio_callers = { "112010400000000710080" = "example-portfolio@example-project-1234.iam.gserviceaccount.com" }
    }
    connector = {
      oauth_enabled             = true
      encrypted_adapter_enabled = true
      muse_clients = [{
        client_id     = "synthetic-muse"
        redirect_uris = ["https://agent.example.invalid/api/callback"]
      }]
    }
  }
  assert {
    condition = (
      output.creation_configuration.environment.HUB_OAUTH_ENABLED == "1" &&
      output.creation_configuration.environment.HUB_ENCRYPTED_ADAPTER_ENABLED == "1" &&
      one(jsondecode(output.creation_configuration.environment.HUB_OAUTH_CLIENTS_JSON)[0].redirectUris) == "https://agent.example.invalid/api/callback" &&
      jsondecode(output.creation_configuration.environment.HUB_TRUSTED_PORTFOLIO_CALLERS)["112010400000000710080"] == var.sources.portfolio_caller_email
    )
    error_message = "Exact app preregistration does not itself grant Cloud Run public invocation or change Google subject/email bindings."
  }
}

run "reject_mutable_image" {
  command = plan
  variables { bootstrap_image = "europe-west3-docker.pkg.dev/example-project-1234/example-images/agent-hub-api:latest" }
  expect_failures = [var.bootstrap_image]
}
run "reject_conflicting_legacy_image" {
  command = plan
  variables { bootstrap_image = "europe-west3-docker.pkg.dev/example-project-1234/example-images/portfolio-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  expect_failures = [var.bootstrap_image]
}
run "reject_adapter_without_oauth" {
  command = plan
  variables { connector = { encrypted_adapter_enabled = true } }
  expect_failures = [var.connector]
}
run "reject_oauth_without_preregistered_client" {
  command = plan
  variables { connector = { oauth_enabled = true } }
  expect_failures = [var.connector]
}
run "reject_callback_with_wildcard_or_query" {
  command = plan
  variables { connector = { muse_clients = [{ client_id = "muse", redirect_uris = ["https://agent.example.invalid/*?override=1"] }] } }
  expect_failures = [var.connector]
}
run "reject_spoofed_workload_email" {
  command = plan
  variables { sources = { portfolio_caller_email = "example-portfolio@example-project-1234.iam.gserviceaccount.com", trusted_portfolio_callers = { "112010400000000710080" = "attacker@example-project-1234.iam.gserviceaccount.com" } } }
  expect_failures = [var.sources]
}

run "reject_oversized_registration_json" {
  command = plan
  variables {
    connector = {
      muse_clients = [for i in range(8) : {
        client_id     = "synthetic-${i}"
        redirect_uris = [for j in range(4) : "https://agent.example.invalid/${i}/${j}/${join("", [for k in range(1000) : "a"])}"]
      }]
    }
  }
  expect_failures = [var.connector]
}
run "reject_public_client_with_confidential_verifier" {
  command = plan
  variables {
    connector = { muse_clients = [{ client_id = "synthetic", redirect_uris = ["https://agent.example.invalid/callback"], secret_sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }
  }
  expect_failures = [var.connector]
}
run "reject_confidential_client_without_hash" {
  command = plan
  variables {
    connector = { muse_clients = [{ client_id = "synthetic", redirect_uris = ["https://agent.example.invalid/callback"], token_endpoint_auth_method = "client_secret_basic" }] }
  }
  expect_failures = [var.connector]
}
