# Reuse original imported-object test snapshots; no live reads or state mutation.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/financial-analysis-512202/serviceAccounts/mock-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      email  = "mock-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      member = "serviceAccount:mock-runtime@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
}

override_resource {
  target = module.market_image_release.google_cloudbuild_trigger.this
  values = {
    id         = "projects/financial-analysis-512202/locations/northamerica-northeast2/triggers/db77a22e-83bf-45cc-b114-50e32192a9c8"
    trigger_id = "db77a22e-83bf-45cc-b114-50e32192a9c8"
  }
}

override_resource {
  target = google_cloud_run_v2_service_iam_member.market_image_deployer
  values = {}
}

override_resource {
  target = google_service_account_iam_member.market_runtime_deployer["image"]
  values = {}
}

override_resource {
  target = google_project_iam_member.market_cache
  values = {}
}

override_resource {
  target          = google_project_iam_custom_role.market_service_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewMarketServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_service_configuration
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewMarketServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_image_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewMarketConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_identity_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewMarketIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_identity_metadata
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewMarketIdentityMetadata"
  }
}

override_resource {
  target = module.user_image_release.google_cloudbuild_trigger.this
  values = {
    id         = "projects/financial-analysis-512202/locations/northamerica-northeast2/triggers/4cdbbd0c-94ba-4a47-8fb3-a0c6a73c07e5"
    trigger_id = "4cdbbd0c-94ba-4a47-8fb3-a0c6a73c07e5"
  }
}

override_resource {
  target = google_cloud_run_v2_service_iam_member.user_image_deployer
  values = {}
}

override_resource {
  target = google_service_account_iam_member.user_runtime_deployer["image"]
  values = {}
}

override_resource {
  target = google_project_iam_member.user_cache
  values = {}
}

override_resource {
  target          = google_project_iam_custom_role.user_service_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewUserServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_service_configuration
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewUserServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_image_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewUserConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_identity_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewUserIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_identity_metadata
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewUserIdentityMetadata"
  }
}

override_resource {
  target = google_project_iam_member.user_auth_metadata
  values = {}
}

override_resource {
  target = module.config_image_release.google_cloudbuild_trigger.this
  values = {
    id         = "projects/financial-analysis-512202/locations/northamerica-northeast2/triggers/67b14a77-dd90-42d3-b61d-0f8993a41060"
    trigger_id = "67b14a77-dd90-42d3-b61d-0f8993a41060"
  }
}

override_resource {
  target = google_cloud_run_v2_service_iam_member.config_image_deployer
  values = {}
}

override_resource {
  target = google_service_account_iam_member.config_runtime_deployer["image"]
  values = {}
}

override_resource {
  target = google_project_iam_member.config_store
  values = {}
}

override_resource {
  target          = google_project_iam_custom_role.config_service_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewConfigServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_service_configuration
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewConfigServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_image_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewConfigConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_identity_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewConfigIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_identity_metadata
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewConfigIdentityMetadata"
  }
}

override_resource {
  target = google_project_iam_member.config_auth
  values = {}
}

variables {
  repository_id = "projects/financial-analysis-512202/locations/northamerica-northeast2/connections/financial-analysis-github/repositories/financial-analysis"
}

override_resource {
  target = google_cloudbuild_trigger.web_image_release
  values = {
    id         = "projects/financial-analysis-512202/locations/northamerica-northeast2/triggers/d337875a-823a-47e1-bc6e-e1ba8b3f4f92"
    trigger_id = "d337875a-823a-47e1-bc6e-e1ba8b3f4f92"
  }
}

override_resource {
  target = google_cloud_run_v2_service_iam_member.web_image_deployer
  values = {}
}

override_resource {
  target = google_service_account_iam_member.web_runtime_deployer["image"]
  values = {}
}

override_resource {
  target          = google_project_iam_custom_role.web_service_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewWebServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_service_configuration
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewWebServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_image_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewWebConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_identity_read
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewWebIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_identity_metadata
  override_during = plan
  values = {
    name = "projects/financial-analysis-512202/roles/folioviewWebIdentityMetadata"
  }
}

run "agent_hub_preparation_is_inert_by_default" {
  command = plan
  assert {
    condition = (
      var.agent_hub_provisioning_stage == "none" &&
      !local.execution_registry.targets["agent-hub"].enabled &&
      !contains(keys(module.target_execution), "agent-hub") &&
      length(module.agent_hub_build_identity) == 0 &&
      length(module.agent_hub_image_release) == 0 &&
      length(google_project_iam_custom_role.agent_hub) == 0 &&
      length(module.agent_hub_database_access) == 0 &&
      length(google_firebaserules_release.agent_hub) == 0
    )
    error_message = "Merging Agent Hub preparation must not provision identities, triggers, IAM, rules or databases."
  }
}

run "agent_hub_execution_precedes_business_resources" {
  command = plan
  variables { agent_hub_provisioning_stage = "execution" }
  assert {
    condition = (
      contains(keys(module.target_execution), "agent-hub") &&
      module.target_execution["agent-hub"].state_prefix == "prod/agent-hub" &&
      length(module.agent_hub_build_identity) == 1 &&
      module.agent_hub_image_release[0].name == "build-agent-hub-api" &&
      length(google_cloud_run_v2_service_iam_member.agent_hub_execution) == 0 &&
      length(module.agent_hub_database_access) == 0 &&
      length(google_firebaserules_release.agent_hub) == 0
    )
    error_message = "The execution stage is build-only and cannot depend on a not-yet-created service or database."
  }
}

run "agent_hub_service_iam_is_exact_and_has_no_content_keys" {
  command = plan
  variables { agent_hub_provisioning_stage = "service" }
  assert {
    condition = (
      module.agent_hub_database_access[0].condition.expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/financial-analysis-512202/databases/agent-hub'" &&
      keys(module.agent_hub_database_access[0].grants) == ["runtime"] &&
      module.agent_hub_database_access[0].grants.runtime.member == "serviceAccount:fa-agent-hub-runtime@financial-analysis-512202.iam.gserviceaccount.com" &&
      alltrue([for grant in google_cloud_run_v2_service_iam_member.agent_hub_execution : grant.name == "agent-hub-api"]) &&
      alltrue([for grant in google_service_account_iam_member.agent_hub_execution_metadata : grant.service_account_id == local.agent_hub_runtime_resource]) &&
      toset(google_project_iam_custom_role.agent_hub["service_configuration"].permissions) == toset(["run.services.get", "run.services.update"]) &&
      toset(google_project_iam_custom_role.agent_hub["database_read"].permissions) == toset(["datastore.databases.getMetadata"]) &&
      toset(google_project_iam_custom_role.agent_hub["database_configuration"].permissions) == toset(["datastore.databases.getMetadata", "datastore.databases.update", "datastore.operations.get"]) &&
      alltrue([for grant in google_project_iam_member.agent_hub_database_configuration : grant.condition[0].expression == module.agent_hub_database_access[0].condition.expression]) &&
      google_service_account_iam_member.agent_hub_runtime_deployer[0].member == "serviceAccount:fa-infra-agent-hub-apply@financial-analysis-512202.iam.gserviceaccount.com"
    )
    error_message = "Only Agent Hub runtime accesses its data; infra can read/update exact resource metadata, never create/delete databases, read entities or administer IAM."
  }
  assert {
    condition = (
      google_firebaserules_release.agent_hub[0].name == "cloud.firestore/agent-hub" &&
      strcontains(google_firebaserules_ruleset.agent_hub[0].source[0].files[0].content, "allow read, write: if false;")
    )
    error_message = "Deny all client SDK reads/writes on the named database independently of service IAM."
  }
}

run "reject_unknown_agent_hub_provisioning_stage" {
  command = plan
  variables { agent_hub_provisioning_stage = "apply-everything" }
  expect_failures = [var.agent_hub_provisioning_stage]
}
