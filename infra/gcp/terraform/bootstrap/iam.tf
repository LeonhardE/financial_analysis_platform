resource "google_service_account" "execution" {
  for_each = toset(["plan", "apply"])

  project      = var.project_id
  account_id   = "fa-infra-${each.key}"
  display_name = "FolioView Terraform ${each.key}"
  description = each.key == "plan" ? (
    "Creates reviewed infrastructure plans without business resource write permissions."
  ) : "Applies an approved, verified saved plan. Business resource permissions are added per target."

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_member" "logging" {
  for_each = google_service_account.execution

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${each.value.email}"
}

# Runtime verification reads Cloud Build metadata; it cannot launch or approve
# builds, change triggers, impersonate another identity, or administer IAM.
resource "google_project_iam_custom_role" "build_metadata" {
  project     = var.project_id
  role_id     = "folioviewTerraformBuildMetadata"
  title       = "FolioView Terraform build metadata"
  description = "Read the current trigger and producing build to verify saved plan provenance."
  # Cloud Build authorizes both builds.get and triggers.get with this permission.
  permissions = ["cloudbuild.builds.get"]
}

resource "google_project_iam_member" "build_metadata" {
  for_each = google_service_account.execution

  project = var.project_id
  role    = google_project_iam_custom_role.build_metadata.name
  member  = "serviceAccount:${each.value.email}"
}

resource "google_storage_bucket_iam_member" "plan_state" {
  for_each = toset(["roles/storage.objectViewer", "roles/storage.objectCreator"])

  bucket = google_storage_bucket.state["execution"].name
  role   = each.key
  member = "serviceAccount:${google_service_account.execution["plan"].email}"
}

# GCS locking needs delete, but planning must never delete or overwrite state.
# ObjectCreator can initialize a missing backend state; it cannot overwrite one.
resource "google_project_iam_custom_role" "state_lock_delete" {
  project     = var.project_id
  role_id     = "folioviewTerraformStateLockDelete"
  title       = "FolioView Terraform state lock delete"
  description = "Delete only a Terraform lock when paired with the bucket IAM condition."
  permissions = ["storage.objects.delete"]
}

resource "google_storage_bucket_iam_member" "plan_unlock" {
  bucket = google_storage_bucket.state["execution"].name
  role   = google_project_iam_custom_role.state_lock_delete.name
  member = "serviceAccount:${google_service_account.execution["plan"].email}"

  condition {
    title       = "repo-state-lock-only"
    description = "Allow unlocking the repo root, never deleting its state or another target's lock."
    expression  = "resource.name == 'projects/_/buckets/${google_storage_bucket.state["execution"].name}/objects/prod/repo/default.tflock'"
  }
}

resource "google_storage_bucket_iam_member" "apply_state" {
  bucket = google_storage_bucket.state["execution"].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"
}

resource "google_storage_bucket_iam_member" "plan_artifact_write" {
  bucket = google_storage_bucket.plans.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.execution["plan"].email}"

  condition {
    title       = "repo-plan-artifacts-only"
    description = "Create append-only repo plans, never another target's plan or recovery artifact."
    expression  = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.plans.name}/objects/plans/repo/')"
  }
}

resource "google_storage_bucket_iam_member" "plan_artifact_read" {
  bucket = google_storage_bucket.plans.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"

  condition {
    title       = "repo-plan-artifacts-only"
    description = "Read only repo's exact saved plan objects; artifact listing is not required."
    expression  = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.plans.name}/objects/plans/repo/')"
  }
}

# Keep failed-apply diagnostics and errored.tfstate private for recovery. This
# append-only prefix cannot create or overwrite the plan artifacts being applied.
resource "google_storage_bucket_iam_member" "apply_recovery_write" {
  bucket = google_storage_bucket.plans.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"

  condition {
    title       = "repo-apply-recovery-only"
    description = "Write private recovery artifacts only beneath the repo execution root."
    expression  = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.plans.name}/objects/recovery/repo/')"
  }
}
