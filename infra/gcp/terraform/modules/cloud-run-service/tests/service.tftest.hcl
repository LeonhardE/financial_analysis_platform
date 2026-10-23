mock_provider "google" {}

variables {
  project_id              = "example-project"
  name                    = "example-api"
  runtime_service_account = "example-runtime@example-project.iam.gserviceaccount.com"
  image                   = "northamerica-northeast2-docker.pkg.dev/example-project/images/example-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "private_scale_to_zero_defaults" {
  command = plan

  assert {
    condition = (
      google_cloud_run_v2_service.service.location == "northamerica-northeast2" &&
      google_cloud_run_v2_service.service.ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" &&
      google_cloud_run_v2_service.service.deletion_protection &&
      length(google_cloud_run_v2_service_iam_member.invoker) == 0 &&
      google_cloud_run_v2_service.service.template[0].service_account == var.runtime_service_account &&
      google_cloud_run_v2_service.service.template[0].scaling[0].min_instance_count == 0 &&
      google_cloud_run_v2_service.service.template[0].scaling[0].max_instance_count == 1
    )
    error_message = "A new service must use a dedicated identity, private ingress and scale to zero with one-instance default."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.service.template[0].containers[0].resources[0].cpu_idle &&
      !google_cloud_run_v2_service.service.template[0].containers[0].resources[0].startup_cpu_boost &&
      google_cloud_run_v2_service.service.template[0].containers[0].resources[0].limits == tomap({ cpu = "1", memory = "512Mi" }) &&
      google_cloud_run_v2_service.service.template[0].timeout == "60s" &&
      google_cloud_run_v2_service.service.template[0].max_instance_request_concurrency == 40 &&
      google_cloud_run_v2_service.service.template[0].containers[0].ports[0].container_port == 8080
    )
    error_message = "Default compute must use request billing, a bounded timeout and explicit small resource limits."
  }
}

run "public_access_requires_two_explicit_choices" {
  command = plan
  variables {
    allow_unauthenticated    = true
    ingress                  = "INGRESS_TRAFFIC_ALL"
    invoker_service_accounts = { caller = "example-caller@example-project.iam.gserviceaccount.com" }
  }

  assert {
    condition = (
      length(google_cloud_run_v2_service_iam_member.invoker) == 2 &&
      google_cloud_run_v2_service_iam_member.invoker["public"].member == "allUsers" &&
      google_cloud_run_v2_service_iam_member.invoker["service-account:caller"].member == "serviceAccount:example-caller@example-project.iam.gserviceaccount.com" &&
      alltrue([for grant in google_cloud_run_v2_service_iam_member.invoker :
        grant.role == "roles/run.invoker" && grant.name == var.name &&
        grant.project == var.project_id && grant.location == var.region
      ])
    )
    error_message = "Opt-in public and named caller grants must be additive and limited to this service."
  }
}

run "environment_secrets_and_resource_overrides" {
  command = plan
  variables {
    environment = { LOG_LEVEL = "warning" }
    secret_environment = {
      MODEL_KEY = { secret = "projects/example-project/secrets/model-key", version = "3" }
    }
    memory            = "1Gi"
    max_instances     = 2
    concurrency       = 8
    timeout_seconds   = 300
    startup_cpu_boost = true
    port              = 8000
  }

  assert {
    condition = (
      one([for entry in google_cloud_run_v2_service.service.template[0].containers[0].env : entry.value if entry.name == "LOG_LEVEL"]) == "warning" &&
      one([for entry in google_cloud_run_v2_service.service.template[0].containers[0].env : entry.value_source[0].secret_key_ref[0].secret if entry.name == "MODEL_KEY"]) == "projects/example-project/secrets/model-key" &&
      one([for entry in google_cloud_run_v2_service.service.template[0].containers[0].env : entry.value_source[0].secret_key_ref[0].version if entry.name == "MODEL_KEY"]) == "3" &&
      google_cloud_run_v2_service.service.template[0].containers[0].resources[0].limits["memory"] == "1Gi" &&
      google_cloud_run_v2_service.service.template[0].containers[0].resources[0].cpu_idle &&
      google_cloud_run_v2_service.service.template[0].containers[0].resources[0].startup_cpu_boost &&
      google_cloud_run_v2_service.service.template[0].scaling[0].max_instance_count == 2 &&
      google_cloud_run_v2_service.service.template[0].max_instance_request_concurrency == 8 &&
      google_cloud_run_v2_service.service.template[0].timeout == "300s" &&
      google_cloud_run_v2_service.service.template[0].containers[0].ports[0].container_port == 8000
    )
    error_message = "Owned settings and secret references must be rendered explicitly without retrieving secret payloads."
  }
}

run "reject_mutable_image" {
  command = plan
  variables {
    image = "example.com/images/example-api:latest"
  }
  expect_failures = [var.image]
}

run "reject_default_compute_identity" {
  command = plan
  variables {
    runtime_service_account = "123456-compute@developer.gserviceaccount.com"
  }
  expect_failures = [var.runtime_service_account]
}

run "reject_reserved_environment" {
  command = plan
  variables {
    environment = { PORT = "8000" }
  }
  expect_failures = [var.environment]
}

run "reject_environment_collision" {
  command = plan
  variables {
    environment = { MODEL_KEY = "plain" }
    secret_environment = {
      MODEL_KEY = { secret = "projects/example-project/secrets/model-key", version = "1" }
    }
  }
  expect_failures = [var.secret_environment]
}

run "reject_unpinned_secret_version" {
  command = plan
  variables {
    secret_environment = {
      MODEL_KEY = { secret = "projects/example-project/secrets/model-key", version = "latest" }
    }
  }
  expect_failures = [var.secret_environment]
}

run "reject_cross_project_secret" {
  command = plan
  variables {
    secret_environment = {
      MODEL_KEY = { secret = "projects/another-project/secrets/model-key", version = "1" }
    }
  }
  expect_failures = [var.secret_environment]
}

run "reject_inverted_scaling" {
  command = plan
  variables {
    min_instances = 2
    max_instances = 1
  }
  expect_failures = [var.max_instances]
}

run "reject_fractional_scaling" {
  command = plan
  variables {
    max_instances = 1.5
  }
  expect_failures = [var.max_instances]
}

run "reject_unbounded_request_settings" {
  command = plan
  variables {
    concurrency     = 0
    timeout_seconds = 3601
    port            = 65536
    memory          = "8Gi"
  }
  expect_failures = [var.concurrency, var.timeout_seconds, var.port, var.memory]
}

run "reject_implicit_public_ingress" {
  command = plan
  variables {
    allow_unauthenticated = true
  }
  expect_failures = [var.allow_unauthenticated]
}

run "reject_broad_invoker_principal" {
  command = plan
  variables {
    invoker_service_accounts = { broad = "allAuthenticatedUsers" }
  }
  expect_failures = [var.invoker_service_accounts]
}

run "reject_duplicate_invoker_ownership" {
  command = plan
  variables {
    invoker_service_accounts = {
      first  = "example-caller@example-project.iam.gserviceaccount.com"
      second = "example-caller@example-project.iam.gserviceaccount.com"
    }
  }
  expect_failures = [var.invoker_service_accounts]
}
