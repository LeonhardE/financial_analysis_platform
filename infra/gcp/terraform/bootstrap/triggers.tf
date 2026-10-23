resource "google_cloudbuild_trigger" "plan" {
  project         = var.project_id
  location        = var.region
  name            = "terraform-plan-repo"
  description     = "Plan repo infrastructure from main; never applies or manages the administrative bootstrap."
  service_account = google_service_account.execution["plan"].id
  filename        = "infra/gcp/cloudbuild.terraform-plan.yaml"
  included_files = [
    "infra/gcp/terraform/**",
    "infra/gcp/terraform_pipeline.py",
    "infra/gcp/terraform_tools.py",
    "infra/gcp/cloudbuild.terraform-*.yaml",
  ]
  ignored_files = ["**/*.md"]

  repository_event_config {
    repository = var.repository_id
    push {
      branch = "^main$"
    }
  }

  substitutions = {
    _TARGET = "repo"
  }

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
  name            = "terraform-apply-repo"
  description     = "Manually request and approve applying one verified saved repo infrastructure plan."
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

  substitutions = {
    _TARGET        = "repo"
    _PLAN_BUILD_ID = ""
  }

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
