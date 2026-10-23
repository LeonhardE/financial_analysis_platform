# This unused foundation module currently owns the complete service configuration.
# Do not combine it with the existing release helper until the separate release
# compatibility work has proved revision, image, traffic and rollback behavior.
resource "google_cloud_run_v2_service" "service" {
  project             = var.project_id
  location            = var.region
  name                = var.name
  ingress             = var.ingress
  deletion_protection = true

  template {
    service_account                  = var.runtime_service_account
    timeout                          = "${var.timeout_seconds}s"
    max_instance_request_concurrency = var.concurrency

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = var.port
      }

      resources {
        limits = {
          cpu    = "1"
          memory = var.memory
        }
        cpu_idle          = true
        startup_cpu_boost = var.startup_cpu_boost
      }

      dynamic "env" {
        for_each = var.environment
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_environment
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  # Keys stay known when a newly-created caller's email is only known after apply.
  invokers = merge(
    { for key, email in var.invoker_service_accounts : "service-account:${key}" => "serviceAccount:${email}" },
    var.allow_unauthenticated ? { public = "allUsers" } : {},
  )
}

# Incremental grants do not replace a service's complete IAM policy or role binding.
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = local.invokers
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.service.name
  role     = "roles/run.invoker"
  member   = each.value
}
