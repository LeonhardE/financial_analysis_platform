resource "google_storage_bucket" "state" {
  count                       = local.enabled ? 1 : 0
  project                     = local.project
  name                        = local.bucket
  location                    = local.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  retention_policy {
    retention_period = 604800
    is_locked        = false
  }
  soft_delete_policy { retention_duration_seconds = 604800 }
  # No timer deletes original keys/outbox/receipts, enrollment or current state.
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.executor]
}
# Public configuration must support Root-approved certificate-byte replacement.
# It is separate from correctness-bearing immutable state/enrollment retention.
resource "google_storage_bucket" "config" {
  count                       = local.enabled ? 1 : 0
  project                     = local.project
  name                        = local.config_bucket
  location                    = local.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  soft_delete_policy { retention_duration_seconds = 604800 }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.executor]
}

resource "google_project_iam_custom_role" "objects" {
  count       = local.enabled ? 1 : 0
  project     = local.project
  role_id     = "folioExecutorImmutableObjects"
  title       = "Executor immutable object get and create"
  permissions = ["storage.objects.get", "storage.objects.create"]
}
resource "google_project_iam_custom_role" "config" {
  count       = local.enabled ? 1 : 0
  project     = local.project
  role_id     = "folioExecutorPublicConfigRead"
  title       = "Executor public configuration get"
  permissions = ["storage.objects.get"]
}
resource "google_storage_bucket_iam_member" "objects" {
  for_each = local.workload_accounts
  bucket   = google_storage_bucket.state[0].name
  role     = google_project_iam_custom_role.objects[0].name
  member   = "serviceAccount:${each.value}"
  condition {
    title = "executor-${each.key}-immutable-prefixes"
    expression = each.key == "creation" ? (
      "resource.name.startsWith('projects/_/buckets/${local.bucket}/objects/executor-state/') || resource.name.startsWith('projects/_/buckets/${local.bucket}/objects/executor-enrollment/')"
    ) : "resource.name.startsWith('projects/_/buckets/${local.bucket}/objects/executor-state/')"
  }
  depends_on = [module.identity]
}
resource "google_storage_bucket_iam_member" "config" {
  for_each = local.workload_accounts
  bucket   = google_storage_bucket.config[0].name
  role     = google_project_iam_custom_role.config[0].name
  member   = "serviceAccount:${each.value}"
  condition {
    title      = "executor-${each.key}-public-config"
    expression = "resource.name.startsWith('projects/_/buckets/${local.config_bucket}/objects/executor-config/')"
  }
  depends_on = [module.identity]
}

# This project owns the exact VM read grant consumed by the independent Policy.
resource "google_project_iam_custom_role" "policy_vm_read" {
  count       = local.enabled ? 1 : 0
  project     = local.project
  role_id     = "folioPolicyCurrentExecutorRead"
  title       = "Policy exact current Executor instance get"
  permissions = ["compute.instances.get"]
}
resource "google_project_iam_member" "policy_vm_read" {
  count   = local.enabled ? 1 : 0
  project = local.project
  role    = google_project_iam_custom_role.policy_vm_read[0].name
  member  = "serviceAccount:${var.policy.runtime_service_account}"
  condition {
    title = "policy-current-exact-executor"
    # Project binding is exact; suffix avoids project-ID/number name aliases.
    expression = "resource.type == 'compute.googleapis.com/Instance' && resource.name.endsWith('/zones/${var.deployment.zone}/instances/${local.name}')"
  }
}
