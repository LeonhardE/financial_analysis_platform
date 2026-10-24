# The provider bootstraps/adopts the service; it must never send an update. Its
# full-template PATCH has no etag and can replay a saved image or rollback route.
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
    ignore_changes  = all
  }
}

locals {
  configuration = {
    runtime_service_account = var.runtime_service_account
    timeout_seconds         = var.timeout_seconds
    concurrency             = var.concurrency
    min_instances           = var.min_instances
    max_instances           = var.max_instances
    port                    = var.port
    memory                  = var.memory
    startup_cpu_boost       = var.startup_cpu_boost
    ingress                 = var.ingress
    environment             = var.environment
    secret_environment      = var.secret_environment
  }
}

# This controller stores only desired configuration, never a planned image,
# revision, traffic route or etag. The helper reads those at execution time.
resource "terraform_data" "configuration" {
  input            = local.configuration
  triggers_replace = [sha256(jsonencode(local.configuration)), google_cloud_run_v2_service.service.uid]

  provisioner "local-exec" {
    command = "python3 \"$FOLIOVIEW_CONFIG_WRITER\""
    quiet   = true
    environment = {
      FOLIOVIEW_CONFIG_WRITER    = abspath("${path.module}/../../../configure_cloud_run_service.py")
      FOLIOVIEW_SERVICE_RESOURCE = google_cloud_run_v2_service.service.id
      FOLIOVIEW_SERVICE_UID      = google_cloud_run_v2_service.service.uid
      FOLIOVIEW_CONFIGURATION    = jsonencode(local.configuration)
    }
  }
}

# Re-read after configuration changes. When idle, fail on owned Console drift
# instead of pretending ignore_changes means the desired configuration is live.
# A reviewed -replace of terraform_data.configuration performs drift repair.
data "google_cloud_run_v2_service" "configured" {
  project  = var.project_id
  location = var.region
  name     = var.name

  depends_on = [terraform_data.configuration]

  lifecycle {
    postcondition {
      condition = jsonencode({
        runtime_service_account = self.template[0].service_account
        timeout_seconds         = tonumber(trimsuffix(self.template[0].timeout, "s"))
        concurrency             = self.template[0].max_instance_request_concurrency
        min_instances           = self.template[0].scaling[0].min_instance_count
        max_instances           = self.template[0].scaling[0].max_instance_count
        port                    = self.template[0].containers[0].ports[0].container_port
        memory                  = self.template[0].containers[0].resources[0].limits["memory"]
        startup_cpu_boost       = self.template[0].containers[0].resources[0].startup_cpu_boost
        ingress                 = self.ingress
        environment = { for entry in self.template[0].containers[0].env : entry.name => entry.value == null ? "" : entry.value
          if length(entry.value_source) == 0
        }
        secret_environment = { for entry in self.template[0].containers[0].env : entry.name => {
          secret  = entry.value_source[0].secret_key_ref[0].secret
          version = entry.value_source[0].secret_key_ref[0].version
          } if length(entry.value_source) > 0
        }
        }) == jsonencode(local.configuration) && (
        self.template[0].containers[0].resources[0].limits["cpu"] == "1" &&
        self.template[0].containers[0].resources[0].cpu_idle
      )
      error_message = "Owned Cloud Run configuration drifted. Reconcile the code or review a plan with -replace=module.<name>.terraform_data.configuration; release-only changes do not need repair."
    }
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
