mock_provider "google" { override_during = plan }
variables {
  admin = { project_id = "demo-executor-alpha", region = "northamerica-northeast2", repository_id = "projects/demo-executor-alpha/locations/northamerica-northeast2/connections/owner/repositories/folio", runtime_account_id = "executor-runtime", creation_account_id = "executor-creation" }
}
run "default_none_is_inert" {
  command = plan
  assert {
    condition     = length(module.owner_lane) == 0 && length(google_project_iam_custom_role.workload) == 0 && length(google_project_iam_member.apply) == 0 && length(google_service_account_iam_member.workload_act_as) == 0
    error_message = "Source merge cannot provision or grant independent authority."
  }
}
run "admin_preparation_does_not_activate_execution_or_workload_access" {
  command = plan
  variables { enabled = true }
  assert {
    condition     = !output.preparation.execution_enabled && length(module.owner_lane) == 1 && length(google_project_iam_member.apply) == 0 && length(google_project_iam_member.plan_read) == 0 && length(google_service_account_iam_member.workload_act_as) == 0
    error_message = "Administrator resources and workload permissions must have separate explicit gates."
  }
}
run "approved_apply_has_no_content_crypto_or_execution_administration" {
  command = plan
  variables {
    enabled                 = true
    workload_access_enabled = true
  }
  assert {
    condition     = alltrue([for permission in ["cloudkms.cryptoKeyVersions.useToDecrypt", "cloudkms.cryptoKeyVersions.useToSign", "iam.serviceAccounts.getAccessToken", "cloudbuild.builds.create", "cloudbuild.triggers.update", "datastore.entities.get", "datastore.entities.list", "storage.objects.get"] : !contains(google_project_iam_custom_role.workload["apply"].permissions, permission)]) && length(google_service_account_iam_member.workload_act_as) == 0 && !output.preparation.execution_enabled
    error_message = "A reviewed infrastructure apply is not content decryption, signing, service impersonation or lane administration."
  }
}
run "cannot_enable_execution_without_metadata" {
  command = plan
  variables { execution_enabled = true }
  expect_failures = [var.execution_enabled]
}
run "cannot_grant_workload_act_as_implicitly" {
  command = plan
  variables { workload_act_as_enabled = true }
  expect_failures = [var.workload_act_as_enabled]
}

run "publisher_grants_are_separate_and_no_state_overwrite_or_private_crypto" {
  command = plan
  variables {
    enabled                  = true
    publisher_access_enabled = true
    challenge_access_enabled = true
  }
  assert {
    condition     = google_storage_bucket_iam_member.enrollment_read[0].bucket == "demo-executor-alpha-executor-state" && google_project_iam_custom_role.publisher["read"].permissions == toset(["storage.objects.get"]) && google_project_iam_custom_role.publisher["create"].permissions == toset(["storage.objects.create"]) && strcontains(google_storage_bucket_iam_member.finalization_create[0].condition[0].expression, "endsWith('-finalization.json')") && google_storage_bucket_iam_member.config_publish[0].bucket == "demo-executor-alpha-executor-config" && google_service_account.publisher["challenge"].account_id != google_service_account.publisher["control"].account_id && length(google_service_account_iam_member.owner_publish) == 0 && !output.preparation.execution_enabled
    error_message = "Control and challenge publication use separate exact buckets/prefixes, no encrypted state access or implicit impersonation."
  }
}
