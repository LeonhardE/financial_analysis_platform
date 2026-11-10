mock_provider "google" { override_during = plan }
variables {
  project_id    = "demo-owner-alpha"
  region        = "northamerica-northeast2"
  target        = "synthetic-worker"
  repository_id = "projects/demo-owner-alpha/locations/northamerica-northeast2/connections/owner/repositories/folio"
}
run "default_disabled_and_independent" {
  command = plan
  assert {
    condition = (
      google_cloudbuild_trigger.plan.disabled && google_cloudbuild_trigger.apply.disabled &&
      google_cloudbuild_trigger.apply.approval_config[0].approval_required &&
      google_cloudbuild_trigger.plan.filename == "infra/gcp/cloudbuild.owner-plan.yaml" &&
      google_cloudbuild_trigger.apply.git_file_source[0].path == "infra/gcp/cloudbuild.owner-apply.yaml" &&
      google_service_account.execution["plan"].account_id == "fv-owner-plan" &&
      google_service_account.execution["apply"].account_id == "fv-owner-apply" &&
      google_storage_bucket.private["state"].name == "demo-owner-alpha-owner-tfstate" &&
      google_storage_bucket.private["plans"].name == "demo-owner-alpha-owner-tfplans" &&
      alltrue([for bucket in google_storage_bucket.private : bucket.public_access_prevention == "enforced" && bucket.versioning[0].enabled && !bucket.force_destroy]) &&
      toset(google_project_iam_custom_role.metadata.permissions) == toset(["cloudbuild.builds.get"])
    )
    error_message = "Source adoption must not enable a trigger or grant business administration."
  }
}
run "state_lock_and_append_only_review_artifacts" {
  command = plan
  assert {
    condition = (
      google_storage_bucket_iam_member.plan_lock.condition[0].expression == "resource.name == 'projects/_/buckets/demo-owner-alpha-owner-tfstate/objects/prod/synthetic-worker/default.tflock'" &&
      google_storage_bucket_iam_member.plan_write.role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.apply_read.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.plan_write.condition[0].expression == google_storage_bucket_iam_member.apply_read.condition[0].expression &&
      google_storage_bucket_iam_member.recovery_write.role == "roles/storage.objectCreator" &&
      google_storage_bucket_iam_member.recovery_write.condition[0].expression == "resource.name.startsWith('projects/_/buckets/demo-owner-alpha-owner-tfplans/objects/recovery/synthetic-worker/')"
    )
    error_message = "Plan must not delete state or overwrite review evidence; recovery is private and append-only."
  }
}
run "cannot_enable_without_reviewed_contract" {
  command = plan
  variables { execution_enabled = true }
  expect_failures = [var.execution_enabled]
}
run "cannot_select_foreign_repository" {
  command = plan
  variables { repository_id = "projects/foreign-alpha/locations/northamerica-northeast2/connections/owner/repositories/folio" }
  expect_failures = [var.repository_id]
}
