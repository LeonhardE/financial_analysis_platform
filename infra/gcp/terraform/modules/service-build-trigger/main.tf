resource "google_cloudbuild_trigger" "this" {
  project         = var.project_id
  location        = var.region
  name            = var.name
  description     = var.description
  disabled        = var.disabled
  service_account = var.build_service_account
  filename        = var.filename
  included_files  = distinct(concat(var.included_files, [var.filename]))
  ignored_files   = var.ignored_files

  repository_event_config {
    repository = var.repository_id
    push {
      branch = "^main$"
    }
  }

  substitutions = merge(var.substitutions, {
    _REGION         = var.region
    _DEPLOY_SERVICE = tostring(var.deploy_enabled)
  })

  lifecycle {
    prevent_destroy = true
  }
}
