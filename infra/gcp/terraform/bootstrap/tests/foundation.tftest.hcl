mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id    = "projects/financial-analysis-512202/serviceAccounts/mock@financial-analysis-512202.iam.gserviceaccount.com"
      email = "mock@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
}

# Terraform mocks cannot resolve declarative imports. Override only these
# existing objects so the real bootstrap configuration can still be planned.
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

# Terraform mocks cannot resolve declarative imports. Override only these
# existing objects so the real bootstrap configuration can still be planned.
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

run "separate_private_state_and_plan_boundaries" {
  command = plan

  assert {
    condition = (
      google_storage_bucket.state["bootstrap"].name != google_storage_bucket.state["execution"].name &&
      google_storage_bucket.state["execution"].name != google_storage_bucket.plans.name &&
      alltrue([for bucket in google_storage_bucket.state : bucket.uniform_bucket_level_access && bucket.public_access_prevention == "enforced" && !bucket.force_destroy && bucket.versioning[0].enabled]) &&
      google_storage_bucket.plans.uniform_bucket_level_access &&
      google_storage_bucket.plans.public_access_prevention == "enforced" &&
      !google_storage_bucket.plans.force_destroy
    )
    error_message = "Administrative state, execution state, and saved plans must use separate protected private buckets."
  }

  assert {
    condition = alltrue([for bucket in google_storage_bucket.state : (
      one(one(bucket.lifecycle_rule).condition).with_state == "ARCHIVED" &&
      one(one(bucket.lifecycle_rule).condition).days_since_noncurrent_time == 30 &&
      one(one(bucket.lifecycle_rule).condition).num_newer_versions == 2
    )])
    error_message = "State cleanup must only remove old noncurrent versions while preserving newer recovery versions."
  }

  assert {
    condition = (
      one(one(google_storage_bucket.plans.lifecycle_rule).condition).age == 7 &&
      google_storage_bucket.plans.soft_delete_policy[0].retention_duration_seconds == 0
    )
    error_message = "Sensitive saved plans must expire after seven days without an additional soft-delete copy."
  }
}

run "runtime_permissions_do_not_administer_bootstrap_or_resources" {
  command = plan

  assert {
    condition = (
      toset(google_project_iam_custom_role.build_metadata.permissions) == toset(["cloudbuild.builds.get"]) &&
      toset(google_project_iam_custom_role.state_lock_delete.permissions) == toset(["storage.objects.delete"])
    )
    error_message = "Runtime custom roles must only read provenance metadata or delete a condition-scoped state lock."
  }

  assert {
    condition = (
      google_storage_bucket_iam_member.apply_state.bucket == google_storage_bucket.state["execution"].name &&
      google_storage_bucket_iam_member.apply_state.role == "roles/storage.objectAdmin" &&
      alltrue([for grant in google_storage_bucket_iam_member.plan_state : grant.bucket == google_storage_bucket.state["execution"].name]) &&
      google_storage_bucket_iam_member.plan_unlock.condition[0].expression == "resource.name == 'projects/_/buckets/financial-analysis-512202-tfstate/objects/prod/repo/default.tflock'" &&
      google_storage_bucket_iam_member.plan_artifact_write.role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.plan_artifact_read.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.apply_recovery_write.bucket == google_storage_bucket.plans.name &&
      google_storage_bucket_iam_member.apply_recovery_write.role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.apply_recovery_write.condition[0].expression == "resource.name.startsWith('projects/_/buckets/financial-analysis-512202-tfplans/objects/recovery/repo/')"
    )
    error_message = "Execution identities must not access administrative state, and plan uploads must be append-only."
  }
}

run "only_main_plans_and_explicitly_approved_manual_apply" {
  command = plan

  assert {
    condition = (
      google_cloudbuild_trigger.plan.repository_event_config[0].repository == var.repository_id &&
      google_cloudbuild_trigger.plan.repository_event_config[0].push[0].branch == "^main$" &&
      google_cloudbuild_trigger.plan.filename == "infra/gcp/cloudbuild.terraform-plan.yaml" &&
      contains(google_cloudbuild_trigger.plan.included_files, "infra/gcp/terraform_tools.py") &&
      google_cloudbuild_trigger.plan.substitutions["_TARGET"] == "repo"
    )
    error_message = "Plans must use the trusted main branch and the repo-only execution root."
  }

  assert {
    condition = (
      google_cloudbuild_trigger.apply.source_to_build[0].repository == var.repository_id &&
      google_cloudbuild_trigger.apply.source_to_build[0].ref == "refs/heads/main" &&
      google_cloudbuild_trigger.apply.git_file_source[0].path == "infra/gcp/cloudbuild.terraform-apply.yaml" &&
      google_cloudbuild_trigger.apply.git_file_source[0].revision == "refs/heads/main" &&
      google_cloudbuild_trigger.apply.approval_config[0].approval_required &&
      google_cloudbuild_trigger.apply.substitutions["_PLAN_BUILD_ID"] == ""
    )
    error_message = "Apply must be manually requested, explicitly approved, and receive an explicit producing plan build ID."
  }
}

run "reject_another_project" {
  command = plan
  variables {
    project_id = "another-project"
  }
  expect_failures = [var.project_id]
}

run "reject_another_region" {
  command = plan
  variables {
    region = "us-central1"
  }
  expect_failures = [var.region]
}

run "reject_repository_outside_project" {
  command = plan
  variables {
    repository_id = "projects/another-project/locations/northamerica-northeast2/connections/github/repositories/repo"
  }
  expect_failures = [var.repository_id]
}

run "reject_unfilled_repository_example" {
  command = plan
  variables {
    repository_id = "projects/financial-analysis-512202/locations/northamerica-northeast2/connections/REPLACE_CONNECTION/repositories/REPLACE_REPOSITORY"
  }
  expect_failures = [var.repository_id]
}

run "catalog_requires_separate_target_activation_and_scoped_repo_artifacts" {
  command = plan

  assert {
    condition = (
      toset(keys(module.target_execution)) == toset(["market", "user", "config", "web"]) &&
      toset(keys(output.target_execution)) == toset(["market", "user", "config", "web"]) &&
      local.execution_registry.targets.repo.enabled &&
      local.execution_registry.targets.market.enabled &&
      local.execution_registry.targets.user.enabled &&
      local.execution_registry.targets.config.enabled &&
      local.execution_registry.targets.web.enabled &&
      local.execution_registry.targets.web.configuration_controllers == ["module.web.terraform_data.configuration"] &&
      local.execution_registry.targets.config.configuration_controllers == ["module.config.terraform_data.configuration"] &&
      local.execution_registry.targets.user.configuration_controllers == ["module.user.terraform_data.configuration"] &&
      local.execution_registry.targets.market.configuration_controllers == ["module.market.terraform_data.configuration"] &&
      alltrue([for name, target in local.execution_registry.targets : !target.enabled if !contains(["repo", "market", "user", "config", "web"], name)])
    )
    error_message = "Only the separately reviewed Market, User, Config and Web adoptions may activate these execution targets."
  }

  assert {
    condition = (
      google_storage_bucket_iam_member.plan_artifact_write.condition[0].expression == "resource.name.startsWith('projects/_/buckets/financial-analysis-512202-tfplans/objects/plans/repo/')" &&
      google_storage_bucket_iam_member.plan_artifact_read.condition[0].expression == "resource.name.startsWith('projects/_/buckets/financial-analysis-512202-tfplans/objects/plans/repo/')" &&
      !contains(google_cloudbuild_trigger.plan.included_files, "infra/gcp/terraform/**") &&
      contains(google_cloudbuild_trigger.plan.included_files, "infra/gcp/terraform/envs/prod/repo/**") &&
      google_cloudbuild_trigger.plan.substitutions["_REPAIR_CONTROLLER"] == ""
    )
    error_message = "Repo must not read/write other targets' artifacts or plan unrelated target roots."
  }
}

run "market_execution_business_roles_cannot_create_delete_or_administer_resources" {
  command = plan

  assert {
    condition = (
      toset(google_project_iam_custom_role.market_service_read.permissions) == toset(["run.services.get"]) &&
      toset(google_project_iam_custom_role.market_service_configuration.permissions) == toset(["run.services.get", "run.services.update"]) &&
      toset(google_project_iam_custom_role.market_image_read.permissions) == toset(["artifactregistry.repositories.downloadArtifacts"]) &&
      toset(google_project_iam_custom_role.market_identity_read.permissions) == toset(["iam.serviceAccounts.get"]) &&
      toset(google_project_iam_custom_role.market_identity_metadata.permissions) == toset(["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"])
    )
    error_message = "Market execution must have only existing-service configuration and runtime metadata permissions, without creation, deletion, IAM administration, build launch, or approval rights."
  }

  assert {
    condition = (
      toset(keys(google_cloud_run_v2_service_iam_member.market_execution)) == toset(["plan", "apply"]) &&
      alltrue([for phase, grant in google_cloud_run_v2_service_iam_member.market_execution : (
        grant.project == var.project_id &&
        grant.location == var.region &&
        grant.name == "market-api" &&
        grant.member == "serviceAccount:${module.target_execution["market"].service_accounts[phase]}"
      )]) &&
      google_cloud_run_v2_service_iam_member.market_execution["plan"].role == google_project_iam_custom_role.market_service_read.name &&
      google_cloud_run_v2_service_iam_member.market_execution["apply"].role == google_project_iam_custom_role.market_service_configuration.name &&
      toset(keys(google_service_account_iam_member.market_execution_metadata)) == toset(["plan", "apply"]) &&
      alltrue([for phase, grant in google_service_account_iam_member.market_execution_metadata : (
        grant.service_account_id == "projects/${var.project_id}/serviceAccounts/fa-api-runtime@${var.project_id}.iam.gserviceaccount.com" &&
        grant.member == "serviceAccount:${module.target_execution["market"].service_accounts[phase]}"
      )]) &&
      google_service_account_iam_member.market_execution_metadata["plan"].role == google_project_iam_custom_role.market_identity_read.name &&
      google_service_account_iam_member.market_execution_metadata["apply"].role == google_project_iam_custom_role.market_identity_metadata.name
    )
    error_message = "Custom-role definitions are project objects, but execution grants must bind only market-api and its existing runtime account."
  }

  assert {
    condition = (
      google_artifact_registry_repository_iam_member.market_configuration_image.project == var.project_id &&
      google_artifact_registry_repository_iam_member.market_configuration_image.location == "northamerica-northeast2" &&
      google_artifact_registry_repository_iam_member.market_configuration_image.repository == "financial-analysis" &&
      google_artifact_registry_repository_iam_member.market_configuration_image.role == google_project_iam_custom_role.market_image_read.name &&
      google_artifact_registry_repository_iam_member.market_configuration_image.member == "serviceAccount:${module.target_execution["market"].service_accounts["apply"]}"
    )
    error_message = "Only Market apply may download existing images from the Toronto financial-analysis repository; do not grant project-wide artifact access, writes, or repository administration."
  }

  assert {
    condition = (
      toset(keys(google_service_account_iam_member.market_runtime_deployer)) == toset(["image", "terraform"]) &&
      alltrue([for grant in google_service_account_iam_member.market_runtime_deployer : (
        grant.service_account_id == "projects/${var.project_id}/serviceAccounts/fa-api-runtime@${var.project_id}.iam.gserviceaccount.com" &&
        grant.role == "roles/iam.serviceAccountUser"
      )]) &&
      google_service_account_iam_member.market_runtime_deployer["image"].member == "serviceAccount:fa-build@${var.project_id}.iam.gserviceaccount.com" &&
      google_service_account_iam_member.market_runtime_deployer["terraform"].member == "serviceAccount:${module.target_execution["market"].service_accounts["apply"]}" &&
      google_cloud_run_v2_service_iam_member.market_image_deployer.name == "market-api" &&
      google_cloud_run_v2_service_iam_member.market_image_deployer.role == "roles/run.developer" &&
      google_cloud_run_v2_service_iam_member.market_image_deployer.member == "serviceAccount:fa-build@${var.project_id}.iam.gserviceaccount.com" &&
      google_project_iam_member.market_cache.role == "roles/datastore.user" &&
      google_project_iam_member.market_cache.member == "serviceAccount:fa-api-runtime@${var.project_id}.iam.gserviceaccount.com"
    )
    error_message = "Preserve the existing image publisher and cache grant; Terraform apply may attach only the Market runtime and must not impersonate fa-build."
  }
}

run "user_execution_business_roles_cannot_create_delete_or_administer_resources" {
  command = plan

  assert {
    condition = (
      toset(google_project_iam_custom_role.user_service_read.permissions) == toset(["run.services.get"]) &&
      toset(google_project_iam_custom_role.user_service_configuration.permissions) == toset(["run.services.get", "run.services.update"]) &&
      toset(google_project_iam_custom_role.user_image_read.permissions) == toset(["artifactregistry.repositories.downloadArtifacts"]) &&
      toset(google_project_iam_custom_role.user_identity_read.permissions) == toset(["iam.serviceAccounts.get"]) &&
      toset(google_project_iam_custom_role.user_identity_metadata.permissions) == toset(["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"])
    )
    error_message = "User execution must have only existing-service configuration and runtime metadata permissions, without creation, deletion, IAM administration, build launch, or approval rights."
  }

  assert {
    condition = (
      toset(keys(google_cloud_run_v2_service_iam_member.user_execution)) == toset(["plan", "apply"]) &&
      alltrue([for phase, grant in google_cloud_run_v2_service_iam_member.user_execution : (
        grant.project == var.project_id &&
        grant.location == var.region &&
        grant.name == "user-api" &&
        grant.member == "serviceAccount:${module.target_execution["user"].service_accounts[phase]}"
      )]) &&
      google_cloud_run_v2_service_iam_member.user_execution["plan"].role == google_project_iam_custom_role.user_service_read.name &&
      google_cloud_run_v2_service_iam_member.user_execution["apply"].role == google_project_iam_custom_role.user_service_configuration.name &&
      toset(keys(google_service_account_iam_member.user_execution_metadata)) == toset(["plan", "apply"]) &&
      alltrue([for phase, grant in google_service_account_iam_member.user_execution_metadata : (
        grant.service_account_id == "projects/${var.project_id}/serviceAccounts/fa-user-runtime@${var.project_id}.iam.gserviceaccount.com" &&
        grant.member == "serviceAccount:${module.target_execution["user"].service_accounts[phase]}"
      )]) &&
      google_service_account_iam_member.user_execution_metadata["plan"].role == google_project_iam_custom_role.user_identity_read.name &&
      google_service_account_iam_member.user_execution_metadata["apply"].role == google_project_iam_custom_role.user_identity_metadata.name
    )
    error_message = "Custom-role definitions are project objects, but execution grants must bind only user-api and its existing runtime account."
  }

  assert {
    condition = (
      google_artifact_registry_repository_iam_member.user_configuration_image.project == var.project_id &&
      google_artifact_registry_repository_iam_member.user_configuration_image.location == "northamerica-northeast2" &&
      google_artifact_registry_repository_iam_member.user_configuration_image.repository == "financial-analysis" &&
      google_artifact_registry_repository_iam_member.user_configuration_image.role == google_project_iam_custom_role.user_image_read.name &&
      google_artifact_registry_repository_iam_member.user_configuration_image.member == "serviceAccount:${module.target_execution["user"].service_accounts["apply"]}"
    )
    error_message = "Only User apply may download existing images from the Toronto financial-analysis repository; do not grant project-wide artifact access, writes, or repository administration."
  }

  assert {
    condition = (
      toset(keys(google_service_account_iam_member.user_runtime_deployer)) == toset(["image", "terraform"]) &&
      alltrue([for grant in google_service_account_iam_member.user_runtime_deployer : (
        grant.service_account_id == "projects/${var.project_id}/serviceAccounts/fa-user-runtime@${var.project_id}.iam.gserviceaccount.com" &&
        grant.role == "roles/iam.serviceAccountUser"
      )]) &&
      google_service_account_iam_member.user_runtime_deployer["image"].member == "serviceAccount:fa-build@${var.project_id}.iam.gserviceaccount.com" &&
      google_service_account_iam_member.user_runtime_deployer["terraform"].member == "serviceAccount:${module.target_execution["user"].service_accounts["apply"]}" &&
      google_cloud_run_v2_service_iam_member.user_image_deployer.name == "user-api" &&
      google_cloud_run_v2_service_iam_member.user_image_deployer.role == "roles/run.developer" &&
      google_cloud_run_v2_service_iam_member.user_image_deployer.member == "serviceAccount:fa-build@${var.project_id}.iam.gserviceaccount.com" &&
      google_project_iam_member.user_cache.role == "roles/datastore.user" &&
      google_project_iam_member.user_cache.member == "serviceAccount:fa-user-runtime@${var.project_id}.iam.gserviceaccount.com"
    )
    error_message = "Preserve the existing image publisher and cache grant; Terraform apply may attach only the User runtime and must not impersonate fa-build."
  }
}

run "user_runtime_auth_metadata_stays_on_its_existing_runtime" {
  command = plan
  assert {
    condition = (
      google_project_iam_member.user_auth_metadata.role == "roles/firebaseauth.viewer" &&
      google_project_iam_member.user_auth_metadata.member == "serviceAccount:fa-user-runtime@${var.project_id}.iam.gserviceaccount.com"
    )
    error_message = "Keep Firebase Auth Viewer on the existing User runtime only, never its Terraform execution identities."
  }
}

run "config_execution_business_roles_cannot_create_delete_or_administer_resources" {
  command = plan

  assert {
    condition = (
      toset(google_project_iam_custom_role.config_service_read.permissions) == toset(["run.services.get"]) &&
      toset(google_project_iam_custom_role.config_service_configuration.permissions) == toset(["run.services.get", "run.services.update"]) &&
      toset(google_project_iam_custom_role.config_image_read.permissions) == toset(["artifactregistry.repositories.downloadArtifacts"]) &&
      toset(google_project_iam_custom_role.config_identity_read.permissions) == toset(["iam.serviceAccounts.get"]) &&
      toset(google_project_iam_custom_role.config_identity_metadata.permissions) == toset(["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"])
    )
    error_message = "Config execution must have only existing-service configuration and runtime metadata permissions, without creation, deletion, IAM administration, build launch, or approval rights."
  }

  assert {
    condition = (
      toset(keys(google_cloud_run_v2_service_iam_member.config_execution)) == toset(["plan", "apply"]) &&
      alltrue([for phase, grant in google_cloud_run_v2_service_iam_member.config_execution : (
        grant.project == var.project_id &&
        grant.location == var.region &&
        grant.name == "config-api" &&
        grant.member == "serviceAccount:${module.target_execution["config"].service_accounts[phase]}"
      )]) &&
      google_cloud_run_v2_service_iam_member.config_execution["plan"].role == google_project_iam_custom_role.config_service_read.name &&
      google_cloud_run_v2_service_iam_member.config_execution["apply"].role == google_project_iam_custom_role.config_service_configuration.name &&
      toset(keys(google_service_account_iam_member.config_execution_metadata)) == toset(["plan", "apply"]) &&
      alltrue([for phase, grant in google_service_account_iam_member.config_execution_metadata : (
        grant.service_account_id == "projects/${var.project_id}/serviceAccounts/fa-config-runtime@${var.project_id}.iam.gserviceaccount.com" &&
        grant.member == "serviceAccount:${module.target_execution["config"].service_accounts[phase]}"
      )]) &&
      google_service_account_iam_member.config_execution_metadata["plan"].role == google_project_iam_custom_role.config_identity_read.name &&
      google_service_account_iam_member.config_execution_metadata["apply"].role == google_project_iam_custom_role.config_identity_metadata.name
    )
    error_message = "Custom-role definitions are project objects, but execution grants must bind only config-api and its existing runtime account."
  }

  assert {
    condition = (
      google_artifact_registry_repository_iam_member.config_configuration_image.project == var.project_id &&
      google_artifact_registry_repository_iam_member.config_configuration_image.location == "northamerica-northeast2" &&
      google_artifact_registry_repository_iam_member.config_configuration_image.repository == "financial-analysis" &&
      google_artifact_registry_repository_iam_member.config_configuration_image.role == google_project_iam_custom_role.config_image_read.name &&
      google_artifact_registry_repository_iam_member.config_configuration_image.member == "serviceAccount:${module.target_execution["config"].service_accounts["apply"]}"
    )
    error_message = "Only Config apply may download existing images from the Toronto financial-analysis repository; do not grant project-wide artifact access, writes, or repository administration."
  }

  assert {
    condition = (
      toset(keys(google_service_account_iam_member.config_runtime_deployer)) == toset(["image", "terraform"]) &&
      alltrue([for grant in google_service_account_iam_member.config_runtime_deployer : (
        grant.service_account_id == "projects/${var.project_id}/serviceAccounts/fa-config-runtime@${var.project_id}.iam.gserviceaccount.com" &&
        grant.role == "roles/iam.serviceAccountUser"
      )]) &&
      google_service_account_iam_member.config_runtime_deployer["image"].member == "serviceAccount:fa-build@${var.project_id}.iam.gserviceaccount.com" &&
      google_service_account_iam_member.config_runtime_deployer["terraform"].member == "serviceAccount:${module.target_execution["config"].service_accounts["apply"]}" &&
      google_cloud_run_v2_service_iam_member.config_image_deployer.name == "config-api" &&
      google_cloud_run_v2_service_iam_member.config_image_deployer.role == "roles/run.developer" &&
      google_cloud_run_v2_service_iam_member.config_image_deployer.member == "serviceAccount:fa-build@${var.project_id}.iam.gserviceaccount.com" &&
      google_project_iam_member.config_store.role == "roles/datastore.user" &&
      google_project_iam_member.config_store.member == "serviceAccount:fa-config-runtime@${var.project_id}.iam.gserviceaccount.com" &&
      google_project_iam_member.config_auth.role == "roles/firebaseauth.viewer" &&
      google_project_iam_member.config_auth.member == "serviceAccount:fa-config-runtime@${var.project_id}.iam.gserviceaccount.com"
    )
    error_message = "Preserve the existing image publisher and preferences grant; Terraform apply may attach only the Config runtime and must not impersonate fa-build."
  }
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

run "web_retains_existing_build_filter_and_public_frontend_configuration" {
  command = plan

  assert {
    condition = (
      google_cloudbuild_trigger.web_image_release.name == "build-market-web" &&
      google_cloudbuild_trigger.web_image_release.filename == "infra/gcp/cloudbuild.web.yaml" &&
      google_cloudbuild_trigger.web_image_release.service_account == "projects/financial-analysis-512202/serviceAccounts/fa-build@financial-analysis-512202.iam.gserviceaccount.com" &&
      google_cloudbuild_trigger.web_image_release.repository_event_config[0].push[0].branch == "^main$" &&
      tolist(google_cloudbuild_trigger.web_image_release.included_files) == tolist(["apps/web/**", "package.json", "package-lock.json", ".dockerignore", "infra/gcp/cloudbuild.web.yaml", "infra/gcp/deploy_existing_service.py"]) &&
      length(google_cloudbuild_trigger.web_image_release.ignored_files) == 0 &&
      !google_cloudbuild_trigger.web_image_release.disabled &&
      !contains(keys(google_cloudbuild_trigger.web_image_release.substitutions), "_DEPLOY_SERVICE") &&
      toset(keys(google_cloudbuild_trigger.web_image_release.substitutions)) == toset(["_API_BASE_URL", "_CONFIG_API_BASE_URL", "_USER_API_BASE_URL", "_FIREBASE_API_KEY", "_FIREBASE_AUTH_DOMAIN", "_FIREBASE_PROJECT_ID", "_FIREBASE_APP_ID", "_REGION", "_REPOSITORY"]) &&
      google_cloudbuild_trigger.web_image_release.substitutions["_USER_API_BASE_URL"] == "https://user-api-630815932903.northamerica-northeast2.run.app" &&
      google_cloudbuild_trigger.web_image_release.substitutions["_CONFIG_API_BASE_URL"] == "https://config-api-630815932903.northamerica-northeast2.run.app"
    )
    error_message = "Web adoption must retain the existing build trigger, paths and build-time public configuration without adding substitutions or redirecting private requests."
  }
}

run "web_execution_is_scoped_to_existing_web_resources" {
  command = plan

  assert {
    condition = (
      toset(google_project_iam_custom_role.web_service_read.permissions) == toset(["run.services.get"]) &&
      toset(google_project_iam_custom_role.web_service_configuration.permissions) == toset(["run.services.get", "run.services.update"]) &&
      toset(google_project_iam_custom_role.web_image_read.permissions) == toset(["artifactregistry.repositories.downloadArtifacts"]) &&
      toset(google_project_iam_custom_role.web_identity_read.permissions) == toset(["iam.serviceAccounts.get"]) &&
      toset(google_project_iam_custom_role.web_identity_metadata.permissions) == toset(["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]) &&
      alltrue([for phase, grant in google_cloud_run_v2_service_iam_member.web_execution : grant.name == "market-web" && grant.member == "serviceAccount:${module.target_execution["web"].service_accounts[phase]}"]) &&
      google_cloud_run_v2_service_iam_member.web_execution["plan"].role == google_project_iam_custom_role.web_service_read.name &&
      google_cloud_run_v2_service_iam_member.web_execution["apply"].role == google_project_iam_custom_role.web_service_configuration.name &&
      alltrue([for phase, grant in google_service_account_iam_member.web_execution_metadata : grant.service_account_id == local.web_runtime && grant.member == "serviceAccount:${module.target_execution["web"].service_accounts[phase]}"]) &&
      alltrue([for grant in google_service_account_iam_member.web_runtime_deployer : grant.service_account_id == local.web_runtime && grant.role == "roles/iam.serviceAccountUser"]) &&
      google_artifact_registry_repository_iam_member.web_configuration_image.repository == "financial-analysis" &&
      google_artifact_registry_repository_iam_member.web_configuration_image.location == "northamerica-northeast2" &&
      google_artifact_registry_repository_iam_member.web_configuration_image.role == google_project_iam_custom_role.web_image_read.name &&
      google_artifact_registry_repository_iam_member.web_configuration_image.member == "serviceAccount:${module.target_execution["web"].service_accounts["apply"]}"
    )
    error_message = "Web may configure only market-web and its dedicated runtime, and only Web apply may read images in the current repository. No IAM administration, resource creation/deletion, deployment of another service, or database access is granted."
  }
}
