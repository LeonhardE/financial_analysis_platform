mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-folio-alpha/serviceAccounts/mockbuild@demo-folio-alpha.iam.gserviceaccount.com"
      email  = "mockbuild@demo-folio-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:mockbuild@demo-folio-alpha.iam.gserviceaccount.com"
    }
  }
}

override_resource {
  target = module.market_image_release.google_cloudbuild_trigger.this
  values = {
    id         = "projects/demo-folio-alpha/locations/northamerica-northeast2/triggers/00000000-0000-4000-8000-000000000027"
    trigger_id = "00000000-0000-4000-8000-000000000027"
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
    name = "projects/demo-folio-alpha/roles/folioviewMarketServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_service_configuration
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewMarketServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_image_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewMarketConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_identity_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewMarketIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.market_identity_metadata
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewMarketIdentityMetadata"
  }
}

override_resource {
  target = module.user_image_release.google_cloudbuild_trigger.this
  values = {
    id         = "projects/demo-folio-alpha/locations/northamerica-northeast2/triggers/00000000-0000-4000-8000-000000000010"
    trigger_id = "00000000-0000-4000-8000-000000000010"
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
    name = "projects/demo-folio-alpha/roles/folioviewUserServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_service_configuration
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewUserServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_image_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewUserConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_identity_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewUserIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.user_identity_metadata
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewUserIdentityMetadata"
  }
}

override_resource {
  target = google_project_iam_member.user_auth_metadata
  values = {}
}

override_resource {
  target = module.config_image_release.google_cloudbuild_trigger.this
  values = {
    id         = "projects/demo-folio-alpha/locations/northamerica-northeast2/triggers/00000000-0000-4000-8000-000000000012"
    trigger_id = "00000000-0000-4000-8000-000000000012"
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
    name = "projects/demo-folio-alpha/roles/folioviewConfigServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_service_configuration
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewConfigServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_image_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewConfigConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_identity_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewConfigIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.config_identity_metadata
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewConfigIdentityMetadata"
  }
}

override_resource {
  target = google_project_iam_member.config_auth
  values = {}
}

variables {
  project_id         = "demo-folio-alpha"
  region             = "northamerica-northeast2"
  deployment_configs = jsondecode(file("tests/fixtures/deployment-configs.json"))
  repository_id      = "projects/demo-folio-alpha/locations/northamerica-northeast2/connections/financial-analysis-github/repositories/financial-analysis"
}

override_resource {
  target = google_cloudbuild_trigger.web_image_release
  values = {
    id         = "projects/demo-folio-alpha/locations/northamerica-northeast2/triggers/00000000-0000-4000-8000-000000000025"
    trigger_id = "00000000-0000-4000-8000-000000000025"
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
    name = "projects/demo-folio-alpha/roles/folioviewWebServiceRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_service_configuration
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewWebServiceConfiguration"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_image_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewWebConfigurationImageRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_identity_read
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewWebIdentityRead"
  }
}

override_resource {
  target          = google_project_iam_custom_role.web_identity_metadata
  override_during = plan
  values = {
    name = "projects/demo-folio-alpha/roles/folioviewWebIdentityMetadata"
  }
}

# Existing Portfolio trigger identity is provider-mocked, never a live ID.
override_resource {
  target          = module.portfolio_image_release[0].google_cloudbuild_trigger.this
  override_during = plan
  values = {
    id         = "projects/demo-folio-alpha/locations/northamerica-northeast2/triggers/00000000-0000-4000-8000-000000000023"
    trigger_id = "00000000-0000-4000-8000-000000000023"
  }
}

run "portfolio_default_none_adds_no_resources" {
  command = plan

  assert {
    condition = (
      !local.execution_registry.targets.portfolio.enabled &&
      !contains(keys(module.target_execution), "portfolio") &&
      length(module.portfolio_build_identity) == 0 &&
      length(module.portfolio_image_release) == 0 &&
      local.portfolio_deployment == null &&
      length(module.portfolio_database_scope) == 0 &&
      length(google_firebaserules_ruleset.portfolio) == 0 &&
      length(google_firebaserules_release.portfolio) == 0 &&
      length(google_project_iam_custom_role.portfolio_database_configuration) == 0 &&
      length(google_service_account_iam_member.portfolio_runtime_deployer) == 0
    )
    error_message = "A merged Portfolio preparation must not activate execution, identities, Rules or IAM; stage defaults to none."
  }
}

run "portfolio_execution_stage_has_no_missing_service_or_runtime_dependencies" {
  command = plan
  variables {
    portfolio_provisioning_stage = "execution"
  }

  assert {
    condition = (
      contains(keys(module.target_execution), "portfolio") &&
      module.target_execution["portfolio"].state_bucket == "demo-folio-alpha-tfstate-portfolio" &&
      module.target_execution["portfolio"].state_prefix == "prod/portfolio" &&
      length(module.portfolio_build_identity) == 1 &&
      length(module.portfolio_image_release) == 1 &&
      module.portfolio_image_release[0].name == "build-portfolio-api" &&
      module.portfolio_image_release[0].trigger_id == local.portfolio_deployment.adoption.buildTriggerId &&
      google_artifact_registry_repository_iam_member.portfolio_build_images[0].repository == local.portfolio_deployment.artifactRepository &&
      length(module.portfolio_database_scope) == 0 &&
      length(google_cloud_run_v2_service_iam_member.portfolio_execution) == 0 &&
      length(google_service_account_iam_member.portfolio_runtime_deployer) == 0 &&
      length(google_project_iam_member.portfolio_execution_database) == 0 &&
      length(google_firebaserules_release.portfolio) == 0 &&
      !output.portfolio_preparation.image_deployment &&
      !output.portfolio_preparation.pipeline_enabled
    )
    error_message = "Execution-only preparation must build without a runtime/DB/Cloud Run dependency or automatic image deployment."
  }
}

run "portfolio_service_stage_keeps_normal_execution_narrow_and_clients_denied" {
  command = plan
  variables {
    portfolio_provisioning_stage = "service"
  }

  assert {
    condition = (
      toset(google_project_iam_custom_role.portfolio_service_read[0].permissions) == toset(["run.services.get"]) &&
      toset(google_project_iam_custom_role.portfolio_service_configuration[0].permissions) == toset(["run.services.get", "run.services.update"]) &&
      toset(google_project_iam_custom_role.portfolio_database_metadata[0].permissions) == toset(["datastore.databases.getMetadata", "datastore.indexes.get"]) &&
      toset(google_project_iam_custom_role.portfolio_database_configuration[0].permissions) == toset(["datastore.databases.getMetadata", "datastore.databases.update", "datastore.indexes.get", "datastore.indexes.update", "datastore.operations.get"]) &&
      !contains(google_project_iam_custom_role.portfolio_database_configuration[0].permissions, "datastore.databases.create") &&
      !contains(google_project_iam_custom_role.portfolio_database_configuration[0].permissions, "datastore.databases.delete") &&
      !contains(google_project_iam_custom_role.portfolio_database_configuration[0].permissions, "datastore.entities.get") &&
      toset(keys(google_cloud_run_v2_service_iam_member.portfolio_execution)) == toset(["plan", "apply"]) &&
      alltrue([for grant in google_cloud_run_v2_service_iam_member.portfolio_execution : grant.name == "portfolio-api"]) &&
      alltrue([for grant in google_service_account_iam_member.portfolio_execution_metadata : grant.service_account_id == local.portfolio_runtime]) &&
      google_service_account_iam_member.portfolio_runtime_deployer[0].service_account_id == local.portfolio_runtime &&
      module.portfolio_database_scope[0].database_resource_name == "projects/demo-folio-alpha/databases/portfolio" &&
      module.portfolio_database_scope[0].grants.runtime.member == "serviceAccount:fa-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com" &&
      alltrue([for grant in google_project_iam_member.portfolio_execution_database : grant.condition[0].expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/demo-folio-alpha/databases/portfolio'"]) &&
      google_firebaserules_release.portfolio[0].name == "cloud.firestore/portfolio" &&
      strcontains(one(google_firebaserules_ruleset.portfolio[0].source).files[0].content, "allow read, write: if false;")
    )
    error_message = "Only Portfolio service/runtime/named DB boundaries may be granted; no DB creation/deletion, content read or client Rules access for normal execution."
  }
}

run "portfolio_reject_unknown_admin_stage" {
  command = plan
  variables {
    portfolio_provisioning_stage = "all"
  }
  expect_failures = [var.portfolio_provisioning_stage]
}

run "portfolio_reject_replaced_build_trigger_identity" {
  command = plan
  variables { portfolio_provisioning_stage = "service" }
  override_resource {
    target          = module.portfolio_image_release[0].google_cloudbuild_trigger.this
    override_during = plan
    values = {
      id         = "projects/demo-folio-alpha/locations/northamerica-northeast2/triggers/ffffffff-ffff-4fff-8fff-ffffffffffff"
      trigger_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    }
  }
  expect_failures = [output.portfolio_preparation]
}

run "portfolio_legacy_service_has_no_new_invoker_or_image_rights" {
  command = plan
  variables { portfolio_provisioning_stage = "service" }
  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.portfolio_invoker) == 0 && length(google_cloud_run_v2_service_iam_member.portfolio_image_configuration) == 0 && length(google_service_account_iam_member.portfolio_image_runtime) == 0 && length(google_project_iam_member.portfolio_image_build_metadata) == 0 && !output.portfolio_preparation.image_deployment
    error_message = "Legacy Portfolio inputs must retain private invocation and build-only execution."
  }
}

run "portfolio_exact_web_hub_invokers_are_service_scoped" {
  command = plan
  variables {
    portfolio_provisioning_stage = "service"
    deployment_configs           = merge(jsondecode(file("tests/fixtures/deployment-configs.json")), { portfolio = jsonencode(jsondecode(file("tests/fixtures/portfolio-trust.json"))) })
  }
  assert {
    condition     = toset(keys(google_cloud_run_v2_service_iam_member.portfolio_invoker)) == toset(["web", "hub"]) && alltrue([for grant in google_cloud_run_v2_service_iam_member.portfolio_invoker : grant.name == "portfolio-api" && grant.role == "roles/run.invoker"]) && google_cloud_run_v2_service_iam_member.portfolio_invoker["web"].member == "serviceAccount:fa-web-runtime@demo-folio-alpha.iam.gserviceaccount.com" && google_cloud_run_v2_service_iam_member.portfolio_invoker["hub"].member == "serviceAccount:fa-agent-hub-runtime@demo-folio-alpha.iam.gserviceaccount.com" && !output.portfolio_preparation.image_deployment
    error_message = "Only the exact selected Web and Hub receive Portfolio service invocation, with image deployment independently off."
  }
}

run "portfolio_image_release_has_get_update_and_exact_runtime_only" {
  command = plan
  variables {
    portfolio_provisioning_stage       = "service"
    portfolio_image_deployment_enabled = true
  }
  assert {
    condition     = output.portfolio_preparation.image_deployment && length(google_cloud_run_v2_service_iam_member.portfolio_image_configuration) == 1 && google_cloud_run_v2_service_iam_member.portfolio_image_configuration[0].name == "portfolio-api" && google_cloud_run_v2_service_iam_member.portfolio_image_configuration[0].member == module.portfolio_build_identity[0].member && toset(google_project_iam_custom_role.portfolio_service_configuration[0].permissions) == toset(["run.services.get", "run.services.update"]) && google_service_account_iam_member.portfolio_image_runtime[0].service_account_id == local.portfolio_runtime && google_service_account_iam_member.portfolio_image_runtime[0].role == "roles/iam.serviceAccountUser" && length(google_cloud_run_v2_service_iam_member.portfolio_invoker) == 0
    error_message = "Image deployment is separately gated and can only update this service and attach its existing runtime."
  }
}

run "portfolio_image_release_requires_retained_service_stage" {
  command = plan
  variables { portfolio_image_deployment_enabled = true }
  expect_failures = [var.portfolio_image_deployment_enabled]
}

run "portfolio_invoker_cannot_override_selected_web_account" {
  command = plan
  variables {
    portfolio_provisioning_stage = "service"
    deployment_configs           = merge(jsondecode(file("tests/fixtures/deployment-configs.json")), { portfolio = replace(jsonencode(jsondecode(file("tests/fixtures/portfolio-trust.json"))), "fa-web-runtime@demo-folio-alpha.iam.gserviceaccount.com", "other-runtime@demo-folio-alpha.iam.gserviceaccount.com") })
  }
  expect_failures = [google_cloud_run_v2_service_iam_member.portfolio_invoker["web"]]
}

run "portfolio_auth_lookup_is_runtime_only_and_single_permission" {
  command = plan
  variables { portfolio_provisioning_stage = "service" }
  assert {
    condition     = toset(google_project_iam_custom_role.portfolio_owner_auth_lookup[0].permissions) == toset(["firebaseauth.users.get"]) && google_project_iam_member.portfolio_owner_auth[0].member == "serviceAccount:fa-portfolio-runtime@demo-folio-alpha.iam.gserviceaccount.com" && alltrue([for grant in google_project_iam_member.portfolio_execution_database : grant.condition[0].expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/demo-folio-alpha/databases/portfolio'"])
    error_message = "Only Portfolio runtime gets account lookup; infra field metadata rights remain restricted to the Portfolio database."
  }
}
