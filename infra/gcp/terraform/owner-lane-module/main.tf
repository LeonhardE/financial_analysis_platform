# Administrator-owned execution only: no workload resources or business permissions.
locals {
  labels = { application = "folioview", scope = var.target, purpose = "owner-execution" }
  substitutions = var.lane == null ? { _TARGET = var.target } : {
    _TARGET = var.target, _OWNER_LANE = var.lane, _OWNER_LANE_SHA256 = sha256(var.lane)
  }
  plan_prefix = "projects/_/buckets/${google_storage_bucket.private["plans"].name}/objects/plans/${var.target}/"
  lock_object = "projects/_/buckets/${google_storage_bucket.private["state"].name}/objects/prod/${var.target}/default.tflock"
}
resource "google_storage_bucket" "private" {
  for_each                    = toset(["state", "plans"])
  project                     = var.project_id
  name                        = "${var.project_id}-owner-tf${each.key}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
}
resource "google_service_account" "execution" {
  for_each     = toset(["plan", "apply"])
  project      = var.project_id
  account_id   = "fv-owner-${each.key}"
  display_name = "${var.target} independent Owner ${each.key}"
  lifecycle { prevent_destroy = true }
}
resource "google_project_iam_custom_role" "metadata" {
  project     = var.project_id
  role_id     = "folioviewOwnerBuildMetadata"
  title       = "Independent build provenance reads"
  permissions = ["cloudbuild.builds.get"]
}
resource "google_project_iam_custom_role" "lock_delete" {
  project     = var.project_id
  role_id     = "folioviewOwnerLockDelete"
  title       = "Independent exact backend lock deletion"
  permissions = ["storage.objects.delete"]
}
resource "google_project_iam_member" "metadata" {
  for_each = google_service_account.execution
  project  = var.project_id
  role     = google_project_iam_custom_role.metadata.name
  member   = "serviceAccount:${each.value.email}"
}
resource "google_project_iam_member" "logging" {
  for_each = google_service_account.execution
  project  = var.project_id
  role     = "roles/logging.logWriter"
  member   = "serviceAccount:${each.value.email}"
}
resource "google_storage_bucket_iam_member" "plan_state" {
  for_each = toset(["roles/storage.objectViewer", "roles/storage.objectCreator"])
  bucket   = google_storage_bucket.private["state"].name
  role     = each.key
  member   = "serviceAccount:${google_service_account.execution["plan"].email}"
}
resource "google_storage_bucket_iam_member" "plan_lock" {
  bucket = google_storage_bucket.private["state"].name
  role   = google_project_iam_custom_role.lock_delete.name
  member = "serviceAccount:${google_service_account.execution["plan"].email}"
  condition {
    title      = "exact-backend-lock-only"
    expression = "resource.name == '${local.lock_object}'"
  }
}
resource "google_storage_bucket_iam_member" "apply_state" {
  bucket = google_storage_bucket.private["state"].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"
}
resource "google_storage_bucket_iam_member" "plan_write" {
  bucket = google_storage_bucket.private["plans"].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.execution["plan"].email}"
  condition {
    title      = "append-target-plans-only"
    expression = "resource.name.startsWith('${local.plan_prefix}')"
  }
}
resource "google_storage_bucket_iam_member" "apply_read" {
  bucket = google_storage_bucket.private["plans"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"
  condition {
    title      = "exact-target-plans-only"
    expression = "resource.name.startsWith('${local.plan_prefix}')"
  }
}
resource "google_storage_bucket_iam_member" "recovery_write" {
  bucket = google_storage_bucket.private["plans"].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"
  condition {
    title      = "append-private-recovery-only"
    expression = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.private["plans"].name}/objects/recovery/${var.target}/')"
  }
}
resource "google_cloudbuild_trigger" "plan" {
  project         = var.project_id
  location        = var.region
  name            = "owner-plan-${var.target}"
  filename        = "infra/gcp/cloudbuild.owner-plan.yaml"
  service_account = google_service_account.execution["plan"].id
  disabled        = !var.execution_enabled
  substitutions   = local.substitutions
  included_files  = ["infra/gcp/terraform/envs/prod/${var.target}/**", "infra/gcp/owner_lane.py", "infra/gcp/terraform/modules/**", "infra/gcp/terraform/toolchain.json", "infra/gcp/terraform_tools.py", "infra/gcp/terraform_pipeline.py", "infra/gcp/deployment_profile.py", "infra/gcp/cloudbuild.owner-*.yaml"]
  ignored_files   = ["**/*.md"]
  repository_event_config {
    repository = var.repository_id
    push { branch = "^main$" }
  }
  lifecycle { prevent_destroy = true }
}
resource "google_cloudbuild_trigger" "apply" {
  project         = var.project_id
  location        = var.region
  name            = "owner-apply-${var.target}"
  service_account = google_service_account.execution["apply"].id
  disabled        = !var.execution_enabled
  substitutions   = merge(local.substitutions, { _PLAN_BUILD_ID = "" })
  source_to_build {
    repository = var.repository_id
    ref        = "refs/heads/main"
    repo_type  = "GITHUB"
  }
  git_file_source {
    repository = var.repository_id
    revision   = "refs/heads/main"
    path       = "infra/gcp/cloudbuild.owner-apply.yaml"
    repo_type  = "GITHUB"
  }
  approval_config { approval_required = true }
  lifecycle { prevent_destroy = true }
}
