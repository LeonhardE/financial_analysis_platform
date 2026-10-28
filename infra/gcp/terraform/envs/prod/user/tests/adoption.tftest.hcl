variables {
  deployment = {
    project_id           = "demo-user-alpha"
    region               = "us-central1"
    artifact_repository  = "alpha-images"
    runtime_account_id   = "alpha-user-runtime"
    creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    existing_service_uid = "33333333-3333-4333-8333-333333333333"
    web_origin           = "https://web.alpha.example.invalid"
    market_origin        = "https://market.alpha.example.invalid"
  }
}

# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-user-alpha/serviceAccounts/alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
      email  = "alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-user-alpha/serviceAccounts/alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
    email  = "alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.user.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-user-alpha/locations/us-central1/services/user-api"
    uid = "33333333-3333-4333-8333-333333333333"
    uri = "https://user.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.user_boundary
  values = {
    uid                  = "33333333-3333-4333-8333-333333333333"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 1 }]
  }
}

run "adopt_existing_user_and_preserve_external_access_and_service_cap" {
  command = plan

  assert {
    condition = (
      output.service.name == "user-api" &&
      output.runtime_service_account == "alpha-user-runtime@demo-user-alpha.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == local.existing_user_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 1
    )
    error_message = "The User root must retain its existing service identity, runtime, public invocation mode, and service-wide instance cap."
  }
}

run "reject_same_name_service_with_different_uid" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.user_boundary
    values = {
      uid                  = "replacement-service-uid"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 1 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.user_boundary]
}

run "reject_changed_public_invocation_mode" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.user_boundary
    values = {
      uid                  = "33333333-3333-4333-8333-333333333333"
      invoker_iam_disabled = false
      scaling              = [{ max_instance_count = 1 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.user_boundary]
}

run "reject_changed_service_wide_cost_cap" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.user_boundary
    values = {
      uid                  = "33333333-3333-4333-8333-333333333333"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.user_boundary]
}

# User adopts another explicit instance without enabling new Hub trust settings.
run "adopt_second_user_project_region_and_runtime" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-beta"
      region               = "europe-west1"
      artifact_repository  = "beta-images"
      runtime_account_id   = "beta-user-runtime"
      creation_image       = "europe-west1-docker.pkg.dev/demo-user-beta/beta-images/user-api@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      existing_service_uid = "44444444-4444-4444-8444-444444444444"
      web_origin           = "https://web.beta.example.invalid"
      market_origin        = "https://market.beta.example.invalid"
    }
  }

  override_resource {
    target          = module.runtime_identity.google_service_account.this
    override_during = plan
    values = {
      id     = "projects/demo-user-beta/serviceAccounts/beta-user-runtime@demo-user-beta.iam.gserviceaccount.com"
      email  = "beta-user-runtime@demo-user-beta.iam.gserviceaccount.com"
      member = "serviceAccount:beta-user-runtime@demo-user-beta.iam.gserviceaccount.com"
    }
  }

  override_resource {
    target          = module.user.google_cloud_run_v2_service.service
    override_during = plan
    values = {
      id  = "projects/demo-user-beta/locations/europe-west1/services/user-api"
      uid = "44444444-4444-4444-8444-444444444444"
      uri = "https://user.beta.example.invalid"
    }
  }

  override_data {
    target = data.google_cloud_run_v2_service.user_boundary
    values = {
      uid                  = "44444444-4444-4444-8444-444444444444"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 1 }]
    }
  }

  assert {
    condition = (
      output.service.name == "user-api" &&
      output.runtime_service_account == "beta-user-runtime@demo-user-beta.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == var.deployment.existing_service_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 1
    )
    error_message = "The second explicit User instance must preserve the same adoption and access boundaries."
  }
}

run "reject_invalid_project" {
  command = plan
  variables {
    deployment = {
      project_id           = "Bad_Project"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_region" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1/other"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_repository" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "../images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_runtime_account_email" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "runtime@example.invalid"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_uid" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "not-an-inventoried-uuid"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_mutable_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api:latest"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_project_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/other-project/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_region_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "europe-west1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_repository_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/other-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_wrong_package_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/market-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_slash" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.example.invalid/"
      market_origin        = "https://market.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_insecure_market_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "http://market.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_market_origin_with_userinfo" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://user@market.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_market_origin_with_port" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.example.invalid:443"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_market_origin_with_path" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.example.invalid/api/stocks"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_market_origin_with_query" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.example.invalid?q=1"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_market_origin_with_fragment" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://market.example.invalid#fragment"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_same_web_and_market_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_null_market_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-user-alpha"
      region               = "us-central1"
      artifact_repository  = "alpha-images"
      runtime_account_id   = "alpha-user-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-user-alpha/alpha-images/user-api@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      existing_service_uid = "33333333-3333-4333-8333-333333333333"
      web_origin           = "https://web.alpha.example.invalid"
      market_origin        = null
    }
  }
  expect_failures = [var.deployment]
}
