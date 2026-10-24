# Market-only administrative adoption. These resources already exist, except
# for the new target execution identities and their narrowly scoped permissions.
# Normal Market execution cannot administer IAM or the shared image-build identity.
locals {
  market_service = "projects/${var.project_id}/locations/${var.region}/services/market-api"
  market_runtime = "projects/${var.project_id}/serviceAccounts/fa-api-runtime@${var.project_id}.iam.gserviceaccount.com"
  market_build   = "fa-build@${var.project_id}.iam.gserviceaccount.com"
}

module "market_image_release" {
  source = "../modules/service-build-trigger"

  project_id            = var.project_id
  region                = var.region
  name                  = "build-market-api"
  description           = ""
  repository_id         = var.repository_id
  build_service_account = "projects/${var.project_id}/serviceAccounts/${local.market_build}"
  filename              = "infra/gcp/cloudbuild.api.yaml"
  # Preserve the existing push filter and deployment switch exactly on import.
  included_files = [
    "services/market-data-service/**",
    ".dockerignore",
    "infra/gcp/cloudbuild.api.yaml",
    "infra/gcp/deploy_existing_service.py",
    "services/common/**",
  ]
  ignored_files  = []
  substitutions  = { _REPOSITORY = "financial-analysis" }
  disabled       = false
  deploy_enabled = true
}

resource "google_cloud_run_v2_service_iam_member" "market_image_deployer" {
  project  = var.project_id
  location = var.region
  name     = "market-api"
  role     = "roles/run.developer"
  member   = "serviceAccount:${local.market_build}"
}

resource "google_service_account_iam_member" "market_runtime_deployer" {
  for_each = {
    image     = local.market_build
    terraform = module.target_execution["market"].service_accounts["apply"]
  }

  service_account_id = local.market_runtime
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${each.value}"
}

# Preserve the existing cache permission. This does not take ownership of the
# shared Firestore database, user documents, or any other runtime's permissions.
resource "google_project_iam_member" "market_cache" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:fa-api-runtime@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_custom_role" "market_service_read" {
  project     = var.project_id
  role_id     = "folioviewMarketServiceRead"
  title       = "FolioView Market service read"
  description = "Read the existing market-api only when bound on that service."
  permissions = ["run.services.get"]
}

resource "google_project_iam_custom_role" "market_service_configuration" {
  project     = var.project_id
  role_id     = "folioviewMarketServiceConfiguration"
  title       = "FolioView Market service configuration"
  description = "Read and update the existing market-api; cannot create, delete, or administer IAM."
  permissions = ["run.services.get", "run.services.update"]
}

resource "google_cloud_run_v2_service_iam_member" "market_execution" {
  for_each = {
    plan  = google_project_iam_custom_role.market_service_read.name
    apply = google_project_iam_custom_role.market_service_configuration.name
  }

  project  = var.project_id
  location = var.region
  name     = "market-api"
  role     = each.value
  member   = "serviceAccount:${module.target_execution["market"].service_accounts[each.key]}"
}

resource "google_project_iam_custom_role" "market_identity_read" {
  project     = var.project_id
  role_id     = "folioviewMarketIdentityRead"
  title       = "FolioView Market identity read"
  description = "Read the existing Market runtime identity when bound on that account."
  permissions = ["iam.serviceAccounts.get"]
}

resource "google_project_iam_custom_role" "market_identity_metadata" {
  project     = var.project_id
  role_id     = "folioviewMarketIdentityMetadata"
  title       = "FolioView Market identity metadata"
  description = "Maintain the existing Market runtime identity's metadata and enabled state only."
  permissions = ["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]
}

resource "google_service_account_iam_member" "market_execution_metadata" {
  for_each = {
    plan  = google_project_iam_custom_role.market_identity_read.name
    apply = google_project_iam_custom_role.market_identity_metadata.name
  }

  service_account_id = local.market_runtime
  role               = each.value
  member             = "serviceAccount:${module.target_execution["market"].service_accounts[each.key]}"
}

# Declarative imports retain the deployed trigger ID and additive IAM tuples.
# The service and runtime identity are imported by the Market business root.
import {
  to = module.market_image_release.google_cloudbuild_trigger.this
  id = "projects/${var.project_id}/locations/${var.region}/triggers/db77a22e-83bf-45cc-b114-50e32192a9c8"
}

import {
  to = google_cloud_run_v2_service_iam_member.market_image_deployer
  id = "${local.market_service} roles/run.developer serviceAccount:${local.market_build}"
}

import {
  to = google_service_account_iam_member.market_runtime_deployer["image"]
  id = "${local.market_runtime} roles/iam.serviceAccountUser serviceAccount:${local.market_build}"
}

import {
  to = google_project_iam_member.market_cache
  id = "${var.project_id} roles/datastore.user serviceAccount:fa-api-runtime@${var.project_id}.iam.gserviceaccount.com"
}
