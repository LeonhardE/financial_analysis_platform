mock_provider "google" {
  override_during = plan
}

override_resource {
  target          = google_service_account.execution["plan"]
  override_during = plan
  values = {
    id    = "projects/example-project/serviceAccounts/fa-infra-example-plan@example-project.iam.gserviceaccount.com"
    email = "fa-infra-example-plan@example-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = google_service_account.execution["apply"]
  override_during = plan
  values = {
    id    = "projects/example-project/serviceAccounts/fa-infra-example-apply@example-project.iam.gserviceaccount.com"
    email = "fa-infra-example-apply@example-project.iam.gserviceaccount.com"
  }
}

variables {
  project_id          = "example-project"
  region              = "northamerica-northeast2"
  target              = "example"
  repository_id       = "projects/example-project/locations/northamerica-northeast2/connections/github/repositories/application"
  plan_bucket         = "example-project-tfplans"
  build_metadata_role = "projects/example-project/roles/terraformBuildMetadata"
  lock_delete_role    = "projects/example-project/roles/terraformStateLockDelete"
}

run "private_target_state_preserves_recovery_versions" {
  command = plan

  assert {
    condition = (
      google_storage_bucket.state.name == "example-project-tfstate-example" &&
      google_storage_bucket.state.location == var.region &&
      google_storage_bucket.state.uniform_bucket_level_access &&
      google_storage_bucket.state.public_access_prevention == "enforced" &&
      !google_storage_bucket.state.force_destroy &&
      google_storage_bucket.state.versioning[0].enabled &&
      one(one(google_storage_bucket.state.lifecycle_rule).condition).with_state == "ARCHIVED" &&
      one(one(google_storage_bucket.state.lifecycle_rule).condition).days_since_noncurrent_time == 30 &&
      one(one(google_storage_bucket.state.lifecycle_rule).condition).num_newer_versions == 2 &&
      output.state_bucket == google_storage_bucket.state.name &&
      output.state_prefix == "prod/example"
    )
    error_message = "The target requires a private versioned state bucket, conservative recovery retention, and its own backend prefix."
  }
}

run "separate_keyless_identities_have_only_foundation_project_grants" {
  command = plan

  assert {
    condition = (
      google_service_account.execution["plan"].account_id == "fa-infra-example-plan" &&
      google_service_account.execution["apply"].account_id == "fa-infra-example-apply" &&
      google_service_account.execution["plan"].email != google_service_account.execution["apply"].email &&
      length(google_project_iam_member.logging) == 2 &&
      alltrue([for grant in google_project_iam_member.logging : grant.project == var.project_id && grant.role == "roles/logging.logWriter"]) &&
      length(google_project_iam_member.build_metadata) == 2 &&
      alltrue([for grant in google_project_iam_member.build_metadata : grant.project == var.project_id && grant.role == var.build_metadata_role]) &&
      output.service_accounts["plan"] == google_service_account.execution["plan"].email &&
      output.service_accounts["apply"] == google_service_account.execution["apply"].email
    )
    error_message = "Plan and apply identities must be separate and receive only logging and read-only build metadata project grants."
  }
}

run "state_grants_never_cross_target_bucket_or_delete_state_while_planning" {
  command = plan

  assert {
    condition = (
      toset(keys(google_storage_bucket_iam_member.plan_state)) == toset(["roles/storage.objectViewer", "roles/storage.objectCreator"]) &&
      alltrue([for grant in google_storage_bucket_iam_member.plan_state : (
        grant.bucket == google_storage_bucket.state.name &&
        grant.member == "serviceAccount:fa-infra-example-plan@example-project.iam.gserviceaccount.com"
      )]) &&
      google_storage_bucket_iam_member.plan_unlock.bucket == google_storage_bucket.state.name &&
      google_storage_bucket_iam_member.plan_unlock.role == var.lock_delete_role &&
      google_storage_bucket_iam_member.plan_unlock.member == "serviceAccount:fa-infra-example-plan@example-project.iam.gserviceaccount.com" &&
      google_storage_bucket_iam_member.plan_unlock.condition[0].expression == "resource.name == 'projects/_/buckets/example-project-tfstate-example/objects/prod/example/default.tflock'" &&
      google_storage_bucket_iam_member.apply_state.bucket == google_storage_bucket.state.name &&
      google_storage_bucket_iam_member.apply_state.role == "roles/storage.objectAdmin" &&
      google_storage_bucket_iam_member.apply_state.member == "serviceAccount:fa-infra-example-apply@example-project.iam.gserviceaccount.com"
    )
    error_message = "State permissions must be bucket-isolated and the planner's delete permission must match only its exact lock."
  }
}

run "saved_plans_and_recovery_are_prefix_isolated_and_append_only" {
  command = plan

  assert {
    condition = (
      google_storage_bucket_iam_member.plan_artifact_write.bucket == var.plan_bucket &&
      google_storage_bucket_iam_member.plan_artifact_write.role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.plan_artifact_write.member == "serviceAccount:fa-infra-example-plan@example-project.iam.gserviceaccount.com" &&
      google_storage_bucket_iam_member.plan_artifact_write.condition[0].expression == "resource.name.startsWith('projects/_/buckets/example-project-tfplans/objects/plans/example/')" &&
      google_storage_bucket_iam_member.plan_artifact_read.bucket == var.plan_bucket &&
      google_storage_bucket_iam_member.plan_artifact_read.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.plan_artifact_read.member == "serviceAccount:fa-infra-example-apply@example-project.iam.gserviceaccount.com" &&
      google_storage_bucket_iam_member.plan_artifact_read.condition[0].expression == google_storage_bucket_iam_member.plan_artifact_write.condition[0].expression &&
      google_storage_bucket_iam_member.apply_recovery_write.bucket == var.plan_bucket &&
      google_storage_bucket_iam_member.apply_recovery_write.role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.apply_recovery_write.member == "serviceAccount:fa-infra-example-apply@example-project.iam.gserviceaccount.com" &&
      google_storage_bucket_iam_member.apply_recovery_write.condition[0].expression == "resource.name.startsWith('projects/_/buckets/example-project-tfplans/objects/recovery/example/')"
    )
    error_message = "The shared artifact bucket must grant only this target's append-only plan/recovery prefixes and exact-object plan reads."
  }
}

run "main_only_plan_filters_target_root_and_common_execution_tooling" {
  command = plan

  assert {
    condition = (
      google_cloudbuild_trigger.plan.name == "terraform-plan-example" &&
      google_cloudbuild_trigger.plan.service_account == google_service_account.execution["plan"].id &&
      google_cloudbuild_trigger.plan.repository_event_config[0].repository == var.repository_id &&
      google_cloudbuild_trigger.plan.repository_event_config[0].push[0].branch == "^main$" &&
      google_cloudbuild_trigger.plan.filename == "infra/gcp/cloudbuild.terraform-plan.yaml" &&
      google_cloudbuild_trigger.plan.substitutions == tomap({ _TARGET = "example", _REPAIR_CONTROLLER = "" }) &&
      toset(google_cloudbuild_trigger.plan.included_files) == toset([
        "infra/gcp/terraform/envs/prod/example/**",
        "infra/gcp/terraform/modules/**",
        "infra/gcp/terraform/pipeline.json",
        "infra/gcp/terraform/toolchain.json",
        "infra/gcp/terraform_pipeline.py",
        "infra/gcp/terraform_tools.py",
        "infra/gcp/configure_cloud_run_service.py",
        "infra/gcp/deploy_existing_service.py",
        "infra/gcp/cloudbuild.terraform-*.yaml",
      ]) &&
      toset(google_cloudbuild_trigger.plan.ignored_files) == toset(["**/*.md"])
    )
    error_message = "The planner must run only trusted main with fixed target metadata and no other target's root paths."
  }
}

run "apply_requires_manual_request_explicit_approval_and_plan_id" {
  command = plan

  assert {
    condition = (
      google_cloudbuild_trigger.apply.name == "terraform-apply-example" &&
      google_cloudbuild_trigger.apply.service_account == google_service_account.execution["apply"].id &&
      length(google_cloudbuild_trigger.apply.repository_event_config) == 0 &&
      google_cloudbuild_trigger.apply.source_to_build[0].repository == var.repository_id &&
      google_cloudbuild_trigger.apply.source_to_build[0].ref == "refs/heads/main" &&
      google_cloudbuild_trigger.apply.git_file_source[0].path == "infra/gcp/cloudbuild.terraform-apply.yaml" &&
      google_cloudbuild_trigger.apply.git_file_source[0].revision == "refs/heads/main" &&
      google_cloudbuild_trigger.apply.approval_config[0].approval_required &&
      google_cloudbuild_trigger.apply.substitutions == tomap({ _TARGET = "example", _PLAN_BUILD_ID = "" })
    )
    error_message = "Apply must be a separate manually requested and approved execution, requiring its producing plan's build ID."
  }
}

run "reject_administrative_target" {
  command = plan
  variables {
    target = "repo"
  }
  expect_failures = [var.target]
}

run "reject_service_account_id_overflow" {
  command = plan
  variables {
    target = "research-worker2"
  }
  expect_failures = [var.target]
}

run "reject_target_path_traversal" {
  command = plan
  variables {
    target = "../market"
  }
  expect_failures = [var.target]
}

run "reject_another_repository_project" {
  command = plan
  variables {
    repository_id = "projects/another-project/locations/northamerica-northeast2/connections/github/repositories/application"
  }
  expect_failures = [var.repository_id]
}

run "reject_another_repository_region" {
  command = plan
  variables {
    repository_id = "projects/example-project/locations/us-central1/connections/github/repositories/application"
  }
  expect_failures = [var.repository_id]
}

run "reject_broad_build_role" {
  command = plan
  variables {
    build_metadata_role = "roles/editor"
  }
  expect_failures = [var.build_metadata_role]
}

run "reject_cross_project_lock_delete_role" {
  command = plan
  variables {
    lock_delete_role = "projects/another-project/roles/terraformStateLockDelete"
  }
  expect_failures = [var.lock_delete_role]
}
