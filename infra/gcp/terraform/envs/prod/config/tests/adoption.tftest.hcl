variables {
  deployment = {
    project_id           = "demo-config-alpha"
    region               = "asia-northeast1"
    artifact_repository  = "alpha-images"
    runtime_account_id   = "alpha-config-runtime"
    creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    existing_service_uid = "55555555-5555-4555-8555-555555555555"
    web_origin           = "https://web.alpha.example.invalid"
  }
}

# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-config-alpha/serviceAccounts/alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com"
      email  = "alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-config-alpha/serviceAccounts/alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com"
    email  = "alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.config.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-config-alpha/locations/asia-northeast1/services/config-api"
    uid = "55555555-5555-4555-8555-555555555555"
    uri = "https://config.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.config_boundary
  values = {
    uid                  = "55555555-5555-4555-8555-555555555555"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 1 }]
  }
}

run "adopt_existing_config_and_preserve_external_access_and_service_cap" {
  command = plan

  assert {
    condition = (
      output.service.name == "config-api" &&
      output.runtime_service_account == "alpha-config-runtime@demo-config-alpha.iam.gserviceaccount.com" &&
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
      uid                  = "55555555-5555-4555-8555-555555555555"
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
      uid                  = "55555555-5555-4555-8555-555555555555"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.config_boundary]
}

# Config's unchanged production root can adopt a different explicit instance.
run "adopt_second_config_project_region_and_runtime" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-beta"
      region               = "europe-west1"
      artifact_repository  = "beta-images"
      runtime_account_id   = "beta-config-runtime"
      creation_image       = "europe-west1-docker.pkg.dev/demo-config-beta/beta-images/config-api@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      existing_service_uid = "66666666-6666-4666-8666-666666666666"
      web_origin           = "https://web.beta.example.invalid"
    }
  }

  override_resource {
    target          = module.runtime_identity.google_service_account.this
    override_during = plan
    values = {
      id     = "projects/demo-config-beta/serviceAccounts/beta-config-runtime@demo-config-beta.iam.gserviceaccount.com"
      email  = "beta-config-runtime@demo-config-beta.iam.gserviceaccount.com"
      member = "serviceAccount:beta-config-runtime@demo-config-beta.iam.gserviceaccount.com"
    }
  }

  override_resource {
    target          = module.config.google_cloud_run_v2_service.service
    override_during = plan
    values = {
      id  = "projects/demo-config-beta/locations/europe-west1/services/config-api"
      uid = "66666666-6666-4666-8666-666666666666"
      uri = "https://config.beta.example.invalid"
    }
  }

  override_data {
    target = data.google_cloud_run_v2_service.config_boundary
    values = {
      uid                  = "66666666-6666-4666-8666-666666666666"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 1 }]
    }
  }

  assert {
    condition = (
      output.service.name == "config-api" &&
      output.runtime_service_account == "beta-config-runtime@demo-config-beta.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == var.deployment.existing_service_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 1
    )
    error_message = "The second Config instance must retain the same service identity and access/cap boundaries."
  }
}

run "reject_invalid_project" {
  command = plan
  variables {
    deployment = {
      project_id           = "Bad_Project"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_region" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1/other"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_repository" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "../images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_runtime_account_email" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "runtime@example.invalid"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_uid" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "not-an-inventoried-uuid"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_mutable_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api:latest"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_project_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/other-project/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_region_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "europe-west1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_repository_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/other-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_wrong_package_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/user-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_insecure_web_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "http://web.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_noncanonical_web_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://WEB.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_path" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.example.invalid/app"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_port" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.example.invalid:443"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_userinfo" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://user@web.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_query" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.example.invalid?q=1"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_fragment" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = "https://web.example.invalid#fragment"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_null_web_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-config-alpha"
      region               = "asia-northeast1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-config-runtime"
      creation_image       = "asia-northeast1-docker.pkg.dev/demo-config-alpha/alpha-images/config-api@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      existing_service_uid = "55555555-5555-4555-8555-555555555555"
      web_origin           = null
    }
  }
  expect_failures = [var.deployment]
}
