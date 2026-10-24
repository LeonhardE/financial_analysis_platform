mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      id    = "projects/financial-analysis-512202/serviceAccounts/mock@financial-analysis-512202.iam.gserviceaccount.com"
      email = "mock@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
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
      length(module.target_execution) == 0 &&
      output.target_execution == {} &&
      local.execution_registry.targets.repo.enabled &&
      alltrue([for name, target in local.execution_registry.targets : !target.enabled if name != "repo"])
    )
    error_message = "Service/client execution infrastructure must remain absent until its separate target adoption PR enables it."
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
