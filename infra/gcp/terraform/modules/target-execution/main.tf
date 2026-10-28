locals {
  deployment_substitutions = var.deployment_config == null ? {} : {
    _DEPLOYMENT_CONFIG = var.deployment_config
    _DEPLOYMENT_SHA256 = sha256(var.deployment_config)
  }
  target_directory = "infra/gcp/terraform/envs/prod/${var.target}"
  state_prefix     = "prod/${var.target}"
  plan_prefix      = "projects/_/buckets/${var.plan_bucket}/objects/plans/${var.target}/"
  recovery_prefix  = "projects/_/buckets/${var.plan_bucket}/objects/recovery/${var.target}/"
  labels = {
    application = "folioview"
    managed_by  = "terraform"
    scope       = var.target
    purpose     = "terraform-execution"
  }
}

# Each target gets its own GCS IAM boundary. Prefixes alone cannot restrict the
# storage.objects.list permission required by the Terraform GCS backend.
resource "google_storage_bucket" "state" {
  project                     = var.project_id
  name                        = "${var.project_id}-tfstate-${var.target}"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      with_state                 = "ARCHIVED"
      days_since_noncurrent_time = 30
      num_newer_versions         = 2
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# These are keyless build identities, not application runtime identities. This
# module grants no business-resource write permissions or impersonation rights.
resource "google_service_account" "execution" {
  for_each = toset(["plan", "apply"])

  project      = var.project_id
  account_id   = "fa-infra-${var.target}-${each.key}"
  display_name = "FolioView ${var.target} Terraform ${each.key}"
  description = each.key == "plan" ? (
    "Creates ${var.target} infrastructure plans without business resource write permissions."
  ) : "Applies one approved ${var.target} saved plan. Business permissions are provisioned separately for this target."

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

resource "google_project_iam_member" "build_metadata" {
  for_each = google_service_account.execution

  project = var.project_id
  role    = var.build_metadata_role
  member  = "serviceAccount:${each.value.email}"
}

resource "google_storage_bucket_iam_member" "plan_state" {
  for_each = toset(["roles/storage.objectViewer", "roles/storage.objectCreator"])

  bucket = google_storage_bucket.state.name
  role   = each.key
  member = "serviceAccount:${google_service_account.execution["plan"].email}"
}

resource "google_storage_bucket_iam_member" "plan_unlock" {
  bucket = google_storage_bucket.state.name
  role   = var.lock_delete_role
  member = "serviceAccount:${google_service_account.execution["plan"].email}"

  condition {
    title       = "${var.target}-state-lock-only"
    description = "Delete only this target's backend lock, never its state or another target's lock."
    expression  = "resource.name == 'projects/_/buckets/${google_storage_bucket.state.name}/objects/${local.state_prefix}/default.tflock'"
  }
}

resource "google_storage_bucket_iam_member" "apply_state" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"
}

resource "google_storage_bucket_iam_member" "plan_artifact_write" {
  bucket = var.plan_bucket
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.execution["plan"].email}"

  condition {
    title       = "${var.target}-plan-artifacts-only"
    description = "Create immutable saved-plan artifacts only for this target."
    expression  = "resource.name.startsWith('${local.plan_prefix}')"
  }
}

# The pipeline fetches exact artifact names; no bucket-wide listing is needed.
resource "google_storage_bucket_iam_member" "plan_artifact_read" {
  bucket = var.plan_bucket
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"

  condition {
    title       = "${var.target}-plan-artifacts-only"
    description = "Read only this target's verified saved-plan artifacts."
    expression  = "resource.name.startsWith('${local.plan_prefix}')"
  }
}

resource "google_storage_bucket_iam_member" "apply_recovery_write" {
  bucket = var.plan_bucket
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.execution["apply"].email}"

  condition {
    title       = "${var.target}-apply-recovery-only"
    description = "Create private recovery artifacts only for this target."
    expression  = "resource.name.startsWith('${local.recovery_prefix}')"
  }
}

resource "google_cloudbuild_trigger" "plan" {
  project         = var.project_id
  location        = var.region
  name            = "terraform-plan-${var.target}"
  description     = "Plan only ${var.target} infrastructure from trusted main; never apply or administer execution resources."
  service_account = google_service_account.execution["plan"].id
  filename        = "infra/gcp/cloudbuild.terraform-plan.yaml"
  included_files = concat([
    "${local.target_directory}/**",
    "infra/gcp/terraform/modules/**",
    "infra/gcp/terraform/pipeline.json",
    "infra/gcp/terraform/toolchain.json",
    "infra/gcp/terraform_pipeline.py",
    "infra/gcp/terraform_tools.py",
    "infra/gcp/configure_cloud_run_service.py",
    "infra/gcp/deploy_existing_service.py",
    "infra/gcp/cloudbuild.terraform-*.yaml",
  ], var.deployment_config == null ? [] : ["infra/gcp/deployment_profile.py"])
  ignored_files = ["**/*.md"]

  repository_event_config {
    repository = var.repository_id
    push {
      branch = "^main$"
    }
  }

  substitutions = merge({
    _TARGET            = var.target
    _REPAIR_CONTROLLER = ""
  }, local.deployment_substitutions)

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_iam_member.logging,
    google_project_iam_member.build_metadata,
    google_storage_bucket_iam_member.plan_state,
    google_storage_bucket_iam_member.plan_unlock,
    google_storage_bucket_iam_member.plan_artifact_write,
  ]
}

resource "google_cloudbuild_trigger" "apply" {
  project         = var.project_id
  location        = var.region
  name            = "terraform-apply-${var.target}"
  description     = "Manually request and approve applying one verified saved ${var.target} infrastructure plan."
  service_account = google_service_account.execution["apply"].id

  source_to_build {
    repository = var.repository_id
    ref        = "refs/heads/main"
    repo_type  = "GITHUB"
  }

  git_file_source {
    path       = "infra/gcp/cloudbuild.terraform-apply.yaml"
    repository = var.repository_id
    revision   = "refs/heads/main"
    repo_type  = "GITHUB"
  }

  approval_config {
    approval_required = true
  }

  substitutions = merge({
    _TARGET        = var.target
    _PLAN_BUILD_ID = ""
  }, local.deployment_substitutions)

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    google_project_iam_member.logging,
    google_project_iam_member.build_metadata,
    google_storage_bucket_iam_member.apply_state,
    google_storage_bucket_iam_member.plan_artifact_read,
    google_storage_bucket_iam_member.apply_recovery_write,
  ]
}
