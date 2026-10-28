# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
variables {
  deployment = {
    project_id           = "demo-web-alpha"
    region               = "us-central1"
    artifact_repository  = "web-images-alpha"
    runtime_account_id   = "browser-alpha-runtime"
    creation_image       = "us-central1-docker.pkg.dev/demo-web-alpha/web-images-alpha/market-web@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    existing_service_uid = "11111111-1111-4111-8111-111111111111"
  }
}

mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-web-alpha/serviceAccounts/browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
      email  = "browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-web-alpha/serviceAccounts/browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
    email  = "browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.web.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-web-alpha/locations/us-central1/services/market-web"
    uid = "11111111-1111-4111-8111-111111111111"
    uri = "https://market.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.web_boundary
  values = {
    uid                  = "11111111-1111-4111-8111-111111111111"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 2 }]
  }
}

run "adopt_existing_web_and_preserve_external_access_and_service_cap" {
  command = plan

  assert {
    condition = (
      output.service.name == "market-web" &&
      output.runtime_service_account == "browser-alpha-runtime@demo-web-alpha.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == local.existing_web_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 2
    )
    error_message = "The Web root must retain its existing service identity, runtime, public invocation mode, and service-wide instance cap."
  }
}

run "adopt_second_project_region_without_original_instance_fallback" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-web-beta"
      region               = "europe-west3"
      artifact_repository  = "web-images-beta"
      runtime_account_id   = "browser-beta-runtime"
      creation_image       = "europe-west3-docker.pkg.dev/demo-web-beta/web-images-beta/market-web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      existing_service_uid = "22222222-2222-4222-8222-222222222222"
    }
  }
  override_resource {
    target          = module.runtime_identity.google_service_account.this
    override_during = plan
    values = {
      id     = "projects/demo-web-beta/serviceAccounts/browser-beta-runtime@demo-web-beta.iam.gserviceaccount.com"
      email  = "browser-beta-runtime@demo-web-beta.iam.gserviceaccount.com"
      member = "serviceAccount:browser-beta-runtime@demo-web-beta.iam.gserviceaccount.com"
    }
  }
  override_resource {
    target          = module.web.google_cloud_run_v2_service.service
    override_during = plan
    values = {
      id  = "projects/demo-web-beta/locations/europe-west3/services/market-web"
      uid = "22222222-2222-4222-8222-222222222222"
      uri = "https://web-beta.example.invalid"
    }
  }
  override_data {
    target = data.google_cloud_run_v2_service.web_boundary
    values = {
      uid                  = "22222222-2222-4222-8222-222222222222"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }
  assert {
    condition = (
      output.service.id == "projects/demo-web-beta/locations/europe-west3/services/market-web" &&
      output.runtime_service_account == "browser-beta-runtime@demo-web-beta.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == var.deployment.existing_service_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 2
    )
    error_message = "Web must consume the explicitly selected second project, region, runtime and UID."
  }
}

run "reject_same_name_service_with_different_uid" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.web_boundary
    values = {
      uid                  = "replacement-service-uid"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.web_boundary]
}

run "reject_changed_public_invocation_mode" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.web_boundary
    values = {
      uid                  = "11111111-1111-4111-8111-111111111111"
      invoker_iam_disabled = false
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.web_boundary]
}

run "reject_changed_service_wide_cost_cap" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.web_boundary
    values = {
      uid                  = "11111111-1111-4111-8111-111111111111"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 3 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.web_boundary]
}

run "reject_unknown_deployment_fields" {
  command = plan
  variables { deployment = merge(var.deployment, { arbitrary_environment = "synthetic" }) }
  expect_failures = [var.deployment]
}

run "reject_missing_deployment_field" {
  command = plan
  variables { deployment = { for key, value in var.deployment : key => value if key != "artifact_repository" } }
  expect_failures = [var.deployment]
}

run "reject_another_projects_image" {
  command = plan
  variables { deployment = merge(var.deployment, { creation_image = "us-central1-docker.pkg.dev/other-project/web-images-alpha/market-web@sha256:1111111111111111111111111111111111111111111111111111111111111111" }) }
  expect_failures = [var.deployment]
}

run "reject_mutable_image_tag" {
  command = plan
  variables { deployment = merge(var.deployment, { creation_image = "us-central1-docker.pkg.dev/demo-web-alpha/web-images-alpha/market-web:latest" }) }
  expect_failures = [var.deployment]
}

run "reject_runtime_email_instead_of_selected_account_id" {
  command = plan
  variables { deployment = merge(var.deployment, { runtime_account_id = "runtime@other-project.iam.gserviceaccount.com" }) }
  expect_failures = [var.deployment]
}

run "reject_malformed_service_uid" {
  command = plan
  variables { deployment = merge(var.deployment, { existing_service_uid = "not-a-uid" }) }
  expect_failures = [var.deployment]
}
