# User-only administrative adoption. These resources already exist, except
# for the new target execution identities and their narrowly scoped permissions.
# Normal User execution cannot administer IAM or the shared image-build identity.
locals {
  user_service = "projects/${var.project_id}/locations/${var.region}/services/user-api"
  user_runtime = "projects/${var.project_id}/serviceAccounts/fa-user-runtime@${var.project_id}.iam.gserviceaccount.com"
  user_build   = "fa-build@${var.project_id}.iam.gserviceaccount.com"
}

module "user_image_release" {
  source = "../modules/service-build-trigger"

  project_id            = var.project_id
  region                = var.region
  name                  = "build-user-api"
  description           = ""
  repository_id         = var.repository_id
  build_service_account = "projects/${var.project_id}/serviceAccounts/${local.user_build}"
  filename              = "infra/gcp/cloudbuild.user.yaml"
  # Preserve the existing push filter and deployment switch exactly on import.
  included_files = [
    "services/user-service/**",
    "services/common/**",
    ".dockerignore",
    "infra/gcp/cloudbuild.user.yaml",
    "infra/gcp/deploy_existing_service.py"
  ]
  ignored_files  = []
  substitutions  = { _REPOSITORY = "financial-analysis" }
  disabled       = false
  deploy_enabled = true
}

resource "google_cloud_run_v2_service_iam_member" "user_image_deployer" {
  project  = var.project_id
  location = var.region
  name     = "user-api"
  role     = "roles/run.developer"
  member   = "serviceAccount:${local.user_build}"
}

resource "google_service_account_iam_member" "user_runtime_deployer" {
  for_each = {
    image     = local.user_build
    terraform = module.target_execution["user"].service_accounts["apply"]
  }

  service_account_id = local.user_runtime
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${each.value}"
}

# Derive the default-database condition without creating a second IAM owner.
module "user_database_scope" {
  source = "../modules/firestore-access"

  project_id  = var.project_id
  database_id = "(default)"
}

# Retain this address so an administrator can replace the imported broad grant.
# This does not own the database, user documents, or any other runtime's IAM.
resource "google_project_iam_member" "user_cache" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:fa-user-runtime@${var.project_id}.iam.gserviceaccount.com"

  condition {
    title       = module.user_database_scope.condition.title
    description = module.user_database_scope.condition.description
    expression  = module.user_database_scope.condition.expression
  }

  # Establish the conditional tuple before removing this member's old broad tuple.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_project_iam_custom_role" "user_service_read" {
  project     = var.project_id
  role_id     = "folioviewUserServiceRead"
  title       = "FolioView User service read"
  description = "Read the existing user-api only when bound on that service."
  permissions = ["run.services.get"]
}

resource "google_project_iam_custom_role" "user_service_configuration" {
  project     = var.project_id
  role_id     = "folioviewUserServiceConfiguration"
  title       = "FolioView User service configuration"
  description = "Read and update the existing user-api; cannot create, delete, or administer IAM."
  permissions = ["run.services.get", "run.services.update"]
}

resource "google_cloud_run_v2_service_iam_member" "user_execution" {
  for_each = {
    plan  = google_project_iam_custom_role.user_service_read.name
    apply = google_project_iam_custom_role.user_service_configuration.name
  }

  project  = var.project_id
  location = var.region
  name     = "user-api"
  role     = each.value
  member   = "serviceAccount:${module.target_execution["user"].service_accounts[each.key]}"
}

# Cloud Run validates the caller's image access on a full-template config PATCH,
# even when the image is unchanged. Read only from the existing repository; no
# image upload/delete, repository administration, or build execution is granted.
resource "google_project_iam_custom_role" "user_image_read" {
  project     = var.project_id
  role_id     = "folioviewUserConfigurationImageRead"
  title       = "FolioView User configuration image read"
  description = "Read an existing image when Cloud Run validates a User configuration update."
  permissions = ["artifactregistry.repositories.downloadArtifacts"]
}

resource "google_artifact_registry_repository_iam_member" "user_configuration_image" {
  project    = var.project_id
  location   = var.region
  repository = "financial-analysis"
  role       = google_project_iam_custom_role.user_image_read.name
  member     = "serviceAccount:${module.target_execution["user"].service_accounts["apply"]}"
}

resource "google_project_iam_custom_role" "user_identity_read" {
  project     = var.project_id
  role_id     = "folioviewUserIdentityRead"
  title       = "FolioView User identity read"
  description = "Read the existing User runtime identity when bound on that account."
  permissions = ["iam.serviceAccounts.get"]
}

resource "google_project_iam_custom_role" "user_identity_metadata" {
  project     = var.project_id
  role_id     = "folioviewUserIdentityMetadata"
  title       = "FolioView User identity metadata"
  description = "Maintain the existing User runtime identity's metadata and enabled state only."
  permissions = ["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]
}

resource "google_service_account_iam_member" "user_execution_metadata" {
  for_each = {
    plan  = google_project_iam_custom_role.user_identity_read.name
    apply = google_project_iam_custom_role.user_identity_metadata.name
  }

  service_account_id = local.user_runtime
  role               = each.value
  member             = "serviceAccount:${module.target_execution["user"].service_accounts[each.key]}"
}

# Declarative imports retain the deployed trigger ID and additive IAM tuples.
# The service and runtime identity are imported by the User business root.
import {
  to = module.user_image_release.google_cloudbuild_trigger.this
  id = "projects/${var.project_id}/locations/${var.region}/triggers/4cdbbd0c-94ba-4a47-8fb3-a0c6a73c07e5"
}

import {
  to = google_cloud_run_v2_service_iam_member.user_image_deployer
  id = "${local.user_service} roles/run.developer serviceAccount:${local.user_build}"
}

import {
  to = google_service_account_iam_member.user_runtime_deployer["image"]
  id = "${local.user_runtime} roles/iam.serviceAccountUser serviceAccount:${local.user_build}"
}

import {
  to = google_project_iam_member.user_cache
  id = "${var.project_id} roles/datastore.user serviceAccount:fa-user-runtime@${var.project_id}.iam.gserviceaccount.com ${module.user_database_scope.condition.title}"
}

# Keep the existing token-verification metadata permission on the runtime only.
resource "google_project_iam_member" "user_auth_metadata" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:fa-user-runtime@${var.project_id}.iam.gserviceaccount.com"
}

import {
  to = google_project_iam_member.user_auth_metadata
  id = "${var.project_id} roles/firebaseauth.viewer serviceAccount:fa-user-runtime@${var.project_id}.iam.gserviceaccount.com"
}
