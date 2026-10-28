variables {
  deployment = {
    project_id           = "demo-folio-alpha"
    region               = "us-central1"
    artifact_repository  = "folio-images"
    runtime_account_id   = "folio-market-runtime"
    creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    existing_service_uid = "11111111-1111-4111-8111-111111111111"
    web_origin           = "https://web.alpha.example.invalid"
  }
}

# Synthetic provider snapshots exercise the production root's adoption guards.
# Plans only: no credentials, provisioner execution, or cloud mutations.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/demo-folio-alpha/serviceAccounts/folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com"
      email  = "folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com"
      member = "serviceAccount:folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com"
    }
  }
}

# Resolve declarative imports without a provider read or remote state change.
override_resource {
  target          = module.runtime_identity.google_service_account.this
  override_during = plan
  values = {
    id     = "projects/demo-folio-alpha/serviceAccounts/folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com"
    email  = "folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com"
    member = "serviceAccount:folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com"
  }
}

override_resource {
  target          = module.market.google_cloud_run_v2_service.service
  override_during = plan
  values = {
    id  = "projects/demo-folio-alpha/locations/us-central1/services/market-api"
    uid = "11111111-1111-4111-8111-111111111111"
    uri = "https://market.example.invalid"
  }
}

override_data {
  target = data.google_cloud_run_v2_service.market_boundary
  values = {
    uid                  = "11111111-1111-4111-8111-111111111111"
    invoker_iam_disabled = true
    scaling              = [{ max_instance_count = 2 }]
  }
}

run "adopt_existing_market_and_preserve_external_access_and_service_cap" {
  command = plan

  assert {
    condition = (
      output.service.name == "market-api" &&
      output.runtime_service_account == "folio-market-runtime@demo-folio-alpha.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == local.existing_market_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 2
    )
    error_message = "The Market root must retain its existing service identity, runtime, public invocation mode, and service-wide instance cap."
  }
}

run "reject_same_name_service_with_different_uid" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.market_boundary
    values = {
      uid                  = "replacement-service-uid"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.market_boundary]
}

run "reject_changed_public_invocation_mode" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.market_boundary
    values = {
      uid                  = "11111111-1111-4111-8111-111111111111"
      invoker_iam_disabled = false
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.market_boundary]
}

run "reject_changed_service_wide_cost_cap" {
  command = plan

  override_data {
    target = data.google_cloud_run_v2_service.market_boundary
    values = {
      uid                  = "11111111-1111-4111-8111-111111111111"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 3 }]
    }
  }

  expect_failures = [data.google_cloud_run_v2_service.market_boundary]
}

# The same production root can adopt another explicit synthetic instance.
run "adopt_second_project_region_repository_and_runtime" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-beta"
      region               = "europe-west1"
      artifact_repository  = "beta-images"
      runtime_account_id   = "beta-market-runtime"
      creation_image       = "europe-west1-docker.pkg.dev/demo-folio-beta/beta-images/market-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      existing_service_uid = "22222222-2222-4222-8222-222222222222"
      web_origin           = "https://web.beta.example.invalid"
    }
  }

  override_resource {
    target          = module.runtime_identity.google_service_account.this
    override_during = plan
    values = {
      id     = "projects/demo-folio-beta/serviceAccounts/beta-market-runtime@demo-folio-beta.iam.gserviceaccount.com"
      email  = "beta-market-runtime@demo-folio-beta.iam.gserviceaccount.com"
      member = "serviceAccount:beta-market-runtime@demo-folio-beta.iam.gserviceaccount.com"
    }
  }

  override_resource {
    target          = module.market.google_cloud_run_v2_service.service
    override_during = plan
    values = {
      id  = "projects/demo-folio-beta/locations/europe-west1/services/market-api"
      uid = "22222222-2222-4222-8222-222222222222"
      uri = "https://market.beta.example.invalid"
    }
  }

  override_data {
    target = data.google_cloud_run_v2_service.market_boundary
    values = {
      uid                  = "22222222-2222-4222-8222-222222222222"
      invoker_iam_disabled = true
      scaling              = [{ max_instance_count = 2 }]
    }
  }

  assert {
    condition = (
      output.service.name == "market-api" &&
      output.runtime_service_account == "beta-market-runtime@demo-folio-beta.iam.gserviceaccount.com" &&
      output.adoption_boundary.uid == var.deployment.existing_service_uid &&
      output.adoption_boundary.invoker_iam_disabled &&
      output.adoption_boundary.service_max_instances == 2
    )
    error_message = "Explicit inputs must select the second instance while preserving Market's adoption boundaries."
  }
}

run "reject_invalid_project" {
  command = plan
  variables {
    deployment = {
      project_id           = "Bad_Project"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_region" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1/other"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_repository" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "../images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_runtime_account_email" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "runtime@example.invalid"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_invalid_uid" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "not-an-inventoried-uuid"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_noncanonical_uid" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "ABCDEFAB-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_mutable_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api:latest"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_project_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/other-project/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_region_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "europe-west1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_cross_repository_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/other-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_wrong_package_image" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/user-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.alpha.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_insecure_web_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "http://web.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_noncanonical_web_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://WEB.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_userinfo" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://user@web.example.invalid"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_port" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.example.invalid:443"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_slash" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.example.invalid/"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_path" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.example.invalid/app"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_query" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.example.invalid?q=1"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_web_origin_with_fragment" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = "https://web.example.invalid#fragment"
    }
  }
  expect_failures = [var.deployment]
}

run "reject_null_web_origin" {
  command = plan
  variables {
    deployment = {
      project_id           = "demo-folio-alpha"
      region               = "us-central1"
      artifact_repository  = "folio-images"
      runtime_account_id   = "folio-market-runtime"
      creation_image       = "us-central1-docker.pkg.dev/demo-folio-alpha/folio-images/market-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      existing_service_uid = "11111111-1111-4111-8111-111111111111"
      web_origin           = null
    }
  }
  expect_failures = [var.deployment]
}
