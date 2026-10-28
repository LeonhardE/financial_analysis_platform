# Web-only administrative references. Existing resources and ownership stay in
# place; instance values come from the explicitly selected Web projection.
# Normal Web execution cannot administer IAM or the shared image-build identity.
locals {
  web_deployment = jsondecode(var.deployment_configs["web"])
  web_service    = "projects/${var.project_id}/locations/${var.region}/services/market-web"
  web_runtime    = "projects/${var.project_id}/serviceAccounts/${local.web_deployment.inputs.runtime_account_id}@${var.project_id}.iam.gserviceaccount.com"
  web_build      = "fa-build@${var.project_id}.iam.gserviceaccount.com"
}

# Preserve the deployed image trigger exactly, including its absent optional
# _DEPLOY_SERVICE substitution (the existing Web build already deploys).
# The shared trigger module adds that key, so this adoption declares the native
# target-owned resource instead of introducing an unrelated trigger update.
resource "google_cloudbuild_trigger" "web_image_release" {
  project         = var.project_id
  location        = var.region
  name            = "build-market-web"
  description     = ""
  disabled        = false
  service_account = "projects/${var.project_id}/serviceAccounts/${local.web_build}"
  filename        = "infra/gcp/cloudbuild.web.yaml"
  included_files = [
    "apps/web/**",
    "package.json",
    "package-lock.json",
    ".dockerignore",
    "infra/gcp/cloudbuild.web.yaml",
    "infra/gcp/deploy_existing_service.py",
  ]
  ignored_files = []
  substitutions = local.web_deployment.build

  repository_event_config {
    repository = var.repository_id
    push {
      branch = "^main$"
    }
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition = try(
        local.web_deployment.schemaVersion == 1 &&
        local.web_deployment.target == "web" &&
        local.web_deployment.project.id == var.project_id &&
        local.web_deployment.region == var.region &&
        local.web_deployment.source.repositoryResource == var.repository_id &&
        local.web_deployment.inputs.project_id == var.project_id &&
        local.web_deployment.inputs.region == var.region &&
        local.web_deployment.inputs.existing_service_uid == local.web_deployment.adoption.serviceUid &&
        local.web_deployment.inputs.artifact_repository == local.web_deployment.artifactRepository &&
        local.web_deployment.build._REGION == var.region &&
        local.web_deployment.build._REPOSITORY == local.web_deployment.artifactRepository &&
        toset(keys(local.web_deployment.build)) == toset([
          "_API_BASE_URL", "_USER_API_BASE_URL", "_CONFIG_API_BASE_URL",
          "_FIREBASE_API_KEY", "_FIREBASE_APP_ID", "_FIREBASE_AUTH_DOMAIN",
          "_FIREBASE_PROJECT_ID", "_REGION", "_REPOSITORY",
        ]),
        false,
      )
      error_message = "Web image configuration must use the selected instance/project/region/repository and exactly the nine public build substitutions."
    }
    postcondition {
      condition     = self.trigger_id == local.web_deployment.adoption.buildTriggerId
      error_message = "Web image release must retain the selected existing trigger UUID."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "web_image_deployer" {
  project  = var.project_id
  location = var.region
  name     = "market-web"
  role     = "roles/run.developer"
  member   = "serviceAccount:${local.web_build}"
}

resource "google_service_account_iam_member" "web_runtime_deployer" {
  for_each = {
    image     = local.web_build
    terraform = module.target_execution["web"].service_accounts["apply"]
  }

  service_account_id = local.web_runtime
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${each.value}"
}

resource "google_project_iam_custom_role" "web_service_read" {
  project     = var.project_id
  role_id     = "folioviewWebServiceRead"
  title       = "FolioView Web service read"
  description = "Read the existing market-web only when bound on that service."
  permissions = ["run.services.get"]
}

resource "google_project_iam_custom_role" "web_service_configuration" {
  project     = var.project_id
  role_id     = "folioviewWebServiceConfiguration"
  title       = "FolioView Web service configuration"
  description = "Read and update the existing market-web; cannot create, delete, or administer IAM."
  permissions = ["run.services.get", "run.services.update"]
}

resource "google_cloud_run_v2_service_iam_member" "web_execution" {
  for_each = {
    plan  = google_project_iam_custom_role.web_service_read.name
    apply = google_project_iam_custom_role.web_service_configuration.name
  }

  project  = var.project_id
  location = var.region
  name     = "market-web"
  role     = each.value
  member   = "serviceAccount:${module.target_execution["web"].service_accounts[each.key]}"
}

# Cloud Run validates the caller's image access on a full-template config PATCH,
# even when the image is unchanged. Read only from the existing repository; no
# image upload/delete, repository administration, or build execution is granted.
resource "google_project_iam_custom_role" "web_image_read" {
  project     = var.project_id
  role_id     = "folioviewWebConfigurationImageRead"
  title       = "FolioView Web configuration image read"
  description = "Read an existing image when Cloud Run validates a Web configuration update."
  permissions = ["artifactregistry.repositories.downloadArtifacts"]
}

resource "google_artifact_registry_repository_iam_member" "web_configuration_image" {
  project    = var.project_id
  location   = var.region
  repository = local.web_deployment.artifactRepository
  role       = google_project_iam_custom_role.web_image_read.name
  member     = "serviceAccount:${module.target_execution["web"].service_accounts["apply"]}"
}

resource "google_project_iam_custom_role" "web_identity_read" {
  project     = var.project_id
  role_id     = "folioviewWebIdentityRead"
  title       = "FolioView Web identity read"
  description = "Read the existing Web runtime identity when bound on that account."
  permissions = ["iam.serviceAccounts.get"]
}

resource "google_project_iam_custom_role" "web_identity_metadata" {
  project     = var.project_id
  role_id     = "folioviewWebIdentityMetadata"
  title       = "FolioView Web identity metadata"
  description = "Maintain the existing Web runtime identity's metadata and enabled state only."
  permissions = ["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]
}

resource "google_service_account_iam_member" "web_execution_metadata" {
  for_each = {
    plan  = google_project_iam_custom_role.web_identity_read.name
    apply = google_project_iam_custom_role.web_identity_metadata.name
  }

  service_account_id = local.web_runtime
  role               = each.value
  member             = "serviceAccount:${module.target_execution["web"].service_accounts[each.key]}"
}

# Declarative imports retain the deployed trigger ID and additive IAM tuples.
# The service and dedicated runtime identity are imported by the Web root.
import {
  to = google_cloudbuild_trigger.web_image_release
  id = "projects/${var.project_id}/locations/${var.region}/triggers/${local.web_deployment.adoption.buildTriggerId}"
}

import {
  to = google_cloud_run_v2_service_iam_member.web_image_deployer
  id = "${local.web_service} roles/run.developer serviceAccount:${local.web_build}"
}

import {
  to = google_service_account_iam_member.web_runtime_deployer["image"]
  id = "${local.web_runtime} roles/iam.serviceAccountUser serviceAccount:${local.web_build}"
}

