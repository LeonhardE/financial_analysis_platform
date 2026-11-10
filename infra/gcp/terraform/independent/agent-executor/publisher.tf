variable "publisher_access_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.publisher_access_enabled || var.enabled
    error_message = "Public control publication is a separately reviewed grant after workload buckets exist."
  }
}
variable "challenge_access_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.challenge_access_enabled || var.enabled
    error_message = "Challenge publication requires a separate explicit administrator grant and existing token bucket."
  }
}
variable "publisher_operators" {
  type    = set(string)
  default = []
  validation {
    condition     = alltrue([for member in var.publisher_operators : can(regex("^user:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", member))])
    error_message = "Select explicit Owner users; no public, group, domain, Hub or workload impersonation."
  }
}
resource "google_service_account" "publisher" {
  for_each     = var.enabled ? toset(["control", "challenge"]) : toset([])
  project      = var.admin.project_id
  account_id   = each.key == "control" ? "fv-owner-publish" : "fv-acme-publish"
  display_name = "Executor Owner ${each.key} public artifact publisher"
}
resource "google_project_iam_custom_role" "publisher" {
  for_each    = var.enabled ? toset(["read", "create", "config"]) : toset([])
  project     = var.admin.project_id
  role_id     = "folioExecutorPublish${title(each.key)}"
  title       = "Executor public artifact ${each.key}"
  permissions = each.key == "read" ? ["storage.objects.get"] : each.key == "create" ? ["storage.objects.create"] : ["storage.objects.get", "storage.objects.create", "storage.objects.delete"]
}
resource "google_storage_bucket_iam_member" "enrollment_read" {
  count  = var.enabled && var.publisher_access_enabled ? 1 : 0
  bucket = "${var.admin.project_id}-executor-state"
  role   = google_project_iam_custom_role.publisher["read"].name
  member = "serviceAccount:${google_service_account.publisher["control"].email}"
  condition {
    title      = "public-enrollment-only"
    expression = "resource.name.startsWith('projects/_/buckets/${var.admin.project_id}-executor-state/objects/executor-enrollment/')"
  }
}
resource "google_storage_bucket_iam_member" "finalization_create" {
  count  = var.enabled && var.publisher_access_enabled ? 1 : 0
  bucket = "${var.admin.project_id}-executor-state"
  role   = google_project_iam_custom_role.publisher["create"].name
  member = "serviceAccount:${google_service_account.publisher["control"].email}"
  condition {
    title      = "create-finalization-only"
    expression = "resource.name.startsWith('projects/_/buckets/${var.admin.project_id}-executor-state/objects/executor-enrollment/') && resource.name.endsWith('-finalization.json')"
  }
}
resource "google_storage_bucket_iam_member" "config_publish" {
  count  = var.enabled && var.publisher_access_enabled ? 1 : 0
  bucket = "${var.admin.project_id}-executor-config"
  role   = google_project_iam_custom_role.publisher["config"].name
  member = "serviceAccount:${google_service_account.publisher["control"].email}"
  condition {
    title      = "public-reviewed-config-only"
    expression = "resource.name.startsWith('projects/_/buckets/${var.admin.project_id}-executor-config/objects/executor-config/')"
  }
}
resource "google_storage_bucket_iam_member" "challenge_publish" {
  count  = var.enabled && var.challenge_access_enabled ? 1 : 0
  bucket = "${var.admin.project_id}-executor-acme"
  role   = google_project_iam_custom_role.publisher["config"].name
  member = "serviceAccount:${google_service_account.publisher["challenge"].email}"
  condition {
    title      = "public-http01-only"
    expression = "resource.name.startsWith('projects/_/buckets/${var.admin.project_id}-executor-acme/objects/.well-known/acme-challenge/')"
  }
}
resource "google_service_account_iam_member" "owner_publish" {
  for_each           = var.enabled ? { for pair in setproduct(["control", "challenge"], var.publisher_operators) : "${pair[0]}:${pair[1]}" => pair } : {}
  service_account_id = google_service_account.publisher[each.value[0]].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value[1]
}
