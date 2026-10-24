# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/financial-analysis-512202/serviceAccounts/fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      email  = "fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      member = "serviceAccount:fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/financial-analysis-512202/serviceAccounts/fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
    email  = "fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
    member = "serviceAccount:fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.config.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/financial-analysis-512202/locations/northamerica-northeast2/services/config-api"
    uid = "e4f50b70-600b-4aac-9530-4caa9de99944"
    uri = "https://config.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.config_boundary
  values = {
    uid                  = "e4f50b70-600b-4aac-9530-4caa9de99944"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 1 }]
  }
}

run "adopt_existing_config_and_preserve_external_access_and_service_cap" {
  command = plan

  assert {
    condition = (
      output.service.name == "config-api" &&
      output.runtime_service_account == "fa-config-runtime@financial-analysis-512202.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == local.existing_config_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 1
    )
    error_message = "The Config root must retain its existing service identity, runtime, public invocation mode, and service-wide instance cap."
  }
}

run "reject_same_name_service_with_different_uid" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.config_boundary
    values = {
      uid                  = "replacement-service-uid"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 1 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.config_boundary]
}

run "reject_changed_public_invocation_mode" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.config_boundary
    values = {
      uid                  = "e4f50b70-600b-4aac-9530-4caa9de99944"
      invoker_iam_disabled = false
      scaling              = [{ max_instance_count = 1 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.config_boundary]
}

run "reject_changed_service_wide_cost_cap" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.config_boundary
    values = {
      uid                  = "e4f50b70-600b-4aac-9530-4caa9de99944"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.config_boundary]
}
