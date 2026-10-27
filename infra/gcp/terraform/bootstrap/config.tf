# Config-only administrative adoption. These resources already exist, except
# for the new target execution identities and their narrowly scoped permissions.
# Normal Config execution cannot administer IAM or the shared image-build identity.
locals {
  config_service = "projects/${var.project_id}/locations/${var.region}/services/config-api"
  config_runtime = "projects/${var.project_id}/serviceAccounts/fa-config-runtime@${var.project_id}.iam.gserviceaccount.com"
  config_build   = "fa-build@${var.project_id}.iam.gserviceaccount.com"
}

module "config_image_release" {
  source = "../modules/service-build-trigger"

  project_id            = var.project_id
  region                = var.region
  name                  = "build-config-api"
  description           = ""
  repository_id         = var.repository_id
  build_service_account = "projects/${var.project_id}/serviceAccounts/${local.config_build}"
  filename              = "infra/gcp/cloudbuild.config.yaml"
  # Preserve the existing push filter and deployment switch exactly on import.
  included_files = [
    "services/config-service/**",
    "services/common/**",
    ".dockerignore",
    "infra/gcp/cloudbuild.config.yaml",
    "infra/gcp/deploy_existing_service.py",
  ]
  ignored_files  = []
  substitutions  = { _REPOSITORY = "financial-analysis" }
  disabled       = false
  deploy_enabled = true
}

resource "google_cloud_run_v2_service_iam_member" "config_image_deployer" {
  project  = var.project_id
  location = var.region
  name     = "config-api"
  role     = "roles/run.developer"
  member   = "serviceAccount:${local.config_build}"
}

resource "google_service_account_iam_member" "config_runtime_deployer" {
  for_each = {
    image     = local.config_build
    terraform = module.target_execution["config"].service_accounts["apply"]
  }

  service_account_id = local.config_runtime
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${each.value}"
}

# Reuse the fixed database condition without creating another IAM owner or
# taking ownership of the existing database. Config still uses (default).
module "config_database_scope" {
  source = "../modules/firestore-access"

  project_id  = var.project_id
  database_id = "(default)"
}

# Keep the existing administrator-owned address. The conditional member replaces
# its unconditional predecessor; only an explicitly reviewed admin migration may
# perform this replacement (see the Config database IAM migration runbook).
resource "google_project_iam_member" "config_store" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:fa-config-runtime@${var.project_id}.iam.gserviceaccount.com"

  condition {
    title       = module.config_database_scope.condition.title
    description = module.config_database_scope.condition.description
    expression  = module.config_database_scope.condition.expression
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Preserve Firebase user verification access on the existing runtime only.
resource "google_project_iam_member" "config_auth" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:fa-config-runtime@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_custom_role" "config_service_read" {
  project     = var.project_id
  role_id     = "folioviewConfigServiceRead"
  title       = "FolioView Config service read"
  description = "Read the existing config-api only when bound on that service."
  permissions = ["run.services.get"]
}

resource "google_project_iam_custom_role" "config_service_configuration" {
  project     = var.project_id
  role_id     = "folioviewConfigServiceConfiguration"
  title       = "FolioView Config service configuration"
  description = "Read and update the existing config-api; cannot create, delete, or administer IAM."
  permissions = ["run.services.get", "run.services.update"]
}

resource "google_cloud_run_v2_service_iam_member" "config_execution" {
  for_each = {
    plan  = google_project_iam_custom_role.config_service_read.name
    apply = google_project_iam_custom_role.config_service_configuration.name
  }

  project  = var.project_id
  location = var.region
  name     = "config-api"
  role     = each.value
  member   = "serviceAccount:${module.target_execution["config"].service_accounts[each.key]}"
}

# Cloud Run validates the caller's image access on a full-template config PATCH,
# even when the image is unchanged. Read only from the existing repository; no
# image upload/delete, repository administration, or build execution is granted.
resource "google_project_iam_custom_role" "config_image_read" {
  project     = var.project_id
  role_id     = "folioviewConfigConfigurationImageRead"
  title       = "FolioView Config configuration image read"
  description = "Read an existing image when Cloud Run validates a Config configuration update."
  permissions = ["artifactregistry.repositories.downloadArtifacts"]
}

resource "google_artifact_registry_repository_iam_member" "config_configuration_image" {
  project    = var.project_id
  location   = var.region
  repository = "financial-analysis"
  role       = google_project_iam_custom_role.config_image_read.name
  member     = "serviceAccount:${module.target_execution["config"].service_accounts["apply"]}"
}

resource "google_project_iam_custom_role" "config_identity_read" {
  project     = var.project_id
  role_id     = "folioviewConfigIdentityRead"
  title       = "FolioView Config identity read"
  description = "Read the existing Config runtime identity when bound on that account."
  permissions = ["iam.serviceAccounts.get"]
}

resource "google_project_iam_custom_role" "config_identity_metadata" {
  project     = var.project_id
  role_id     = "folioviewConfigIdentityMetadata"
  title       = "FolioView Config identity metadata"
  description = "Maintain the existing Config runtime identity's metadata and enabled state only."
  permissions = ["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]
}

resource "google_service_account_iam_member" "config_execution_metadata" {
  for_each = {
    plan  = google_project_iam_custom_role.config_identity_read.name
    apply = google_project_iam_custom_role.config_identity_metadata.name
  }

  service_account_id = local.config_runtime
  role               = each.value
  member             = "serviceAccount:${module.target_execution["config"].service_accounts[each.key]}"
}

# Declarative imports retain the deployed trigger ID and additive IAM tuples.
# The service and runtime identity are imported by the Config business root.
import {
  to = module.config_image_release.google_cloudbuild_trigger.this
  id = "projects/${var.project_id}/locations/${var.region}/triggers/67b14a77-dd90-42d3-b61d-0f8993a41060"
}

import {
  to = google_cloud_run_v2_service_iam_member.config_image_deployer
  id = "${local.config_service} roles/run.developer serviceAccount:${local.config_build}"
}

import {
  to = google_service_account_iam_member.config_runtime_deployer["image"]
  id = "${local.config_runtime} roles/iam.serviceAccountUser serviceAccount:${local.config_build}"
}

import {
  to = google_project_iam_member.config_store
  id = "${var.project_id} roles/datastore.user serviceAccount:fa-config-runtime@${var.project_id}.iam.gserviceaccount.com ${module.config_database_scope.condition.title}"
}

import {
  to = google_project_iam_member.config_auth
  id = "${var.project_id} roles/firebaseauth.viewer serviceAccount:fa-config-runtime@${var.project_id}.iam.gserviceaccount.com"
}
