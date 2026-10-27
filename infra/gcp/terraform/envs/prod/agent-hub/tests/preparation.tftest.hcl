# Native provider plans only: no cloud credentials or provisioner execution.
mock_provider "google" {
  override_during = plan
}

variables {
  bootstrap_image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/agent-hub-api@sha256:e4504d4b3b4624dd0c81585f13166fe3c6a4cb6bd9171adc87c9cf5b0b8ad927"
}

run "agent_hub_first_creation_has_bounded_private_service_and_named_database" {
  command = plan
  assert {
    condition = (
      module.database.database_id == "agent-hub" &&
      module.database.location_id == "northamerica-northeast2" &&
      output.database_resource_name == "projects/financial-analysis-512202/databases/agent-hub" &&
      output.service.name == "agent-hub-api" &&
      output.creation_configuration.min_instances == 0 &&
      output.creation_configuration.max_instances == 1 &&
      output.creation_configuration.concurrency == 8 &&
      output.creation_configuration.timeout_seconds == 60
    )
    error_message = "Initial Agent Hub has its own named database and bounded scale; unchanged module tests cover provider-level bounds/protection."
  }
}

run "agent_hub_configuration_has_only_public_metadata_no_content_keys" {
  command = plan
  assert {
    condition = (
      output.creation_configuration.environment.FIRESTORE_DATABASE == "agent-hub" &&
      output.creation_configuration.environment.CORS_ORIGINS == local.web_origin &&
      toset(keys(output.creation_configuration.environment)) == toset(["FIREBASE_PROJECT_ID", "FIRESTORE_DATABASE", "HUB_STORE_BACKEND", "CORS_ORIGINS"]) &&
      length(module.database.ttl_field_names) == 0 &&
      length(module.database.composite_index_names) == 0
    )
    error_message = "No content key, secret payload, unimplemented OAuth setting or speculative index belongs in this initial root."
  }
}

run "reject_mutable_image_tag" {
  command = plan
  variables { bootstrap_image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/agent-hub-api:latest" }
  expect_failures = [var.bootstrap_image]
}

run "reject_other_target_image" {
  command = plan
  variables { bootstrap_image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/portfolio-api@sha256:e4504d4b3b4624dd0c81585f13166fe3c6a4cb6bd9171adc87c9cf5b0b8ad927" }
  expect_failures = [var.bootstrap_image]
}
