# Portfolio-only operator configuration migration. Preserve the existing stage.
# Keep these objects in administrator state; business runners never own IAM.
variable "portfolio_provisioning_stage" {
  description = "Explicit administrative stage: none (no objects), execution (build/state/identities), service (after Portfolio runtime/DB/Run exist). Enabled registry entries retain service-stage ownership."
  type        = string
  default     = "none"
  nullable    = false

  validation {
    condition     = contains(["none", "execution", "service"], var.portfolio_provisioning_stage)
    error_message = "Use none, execution, or service; first provisioning requires separate reviewed administrative plans."
  }
}

locals {
  portfolio_execution_enabled = local.execution_registry.targets.portfolio.enabled || var.portfolio_provisioning_stage != "none"
  portfolio_service_enabled   = local.execution_registry.targets.portfolio.enabled || var.portfolio_provisioning_stage == "service"
  portfolio_deployment        = local.portfolio_execution_enabled ? jsondecode(var.deployment_configs["portfolio"]) : null
  portfolio_runtime           = local.portfolio_service_enabled ? "projects/${var.project_id}/serviceAccounts/${local.portfolio_deployment.inputs.runtime_account_id}@${var.project_id}.iam.gserviceaccount.com" : null
  portfolio_runtime_email     = local.portfolio_service_enabled ? "${local.portfolio_deployment.inputs.runtime_account_id}@${var.project_id}.iam.gserviceaccount.com" : null
}

module "portfolio_build_identity" {
  count  = local.portfolio_execution_enabled ? 1 : 0
  source = "../modules/service-identity"

  project_id   = var.project_id
  account_id   = "fa-portfolio-build"
  display_name = "FolioView Portfolio image build"
  description  = "Build-only Portfolio image publisher; no Cloud Run deployment or content access."
}

resource "google_project_iam_member" "portfolio_build_logging" {
  count   = local.portfolio_execution_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = module.portfolio_build_identity[0].member
}

resource "google_artifact_registry_repository_iam_member" "portfolio_build_images" {
  count      = local.portfolio_execution_enabled ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = local.portfolio_deployment.artifactRepository
  role       = "roles/artifactregistry.writer"
  member     = module.portfolio_build_identity[0].member
}

module "portfolio_image_release" {
  count  = local.portfolio_execution_enabled ? 1 : 0
  source = "../modules/service-build-trigger"

  project_id            = var.project_id
  region                = local.portfolio_deployment.region
  name                  = "build-portfolio-api"
  repository_id         = var.repository_id
  build_service_account = module.portfolio_build_identity[0].id
  filename              = "infra/gcp/cloudbuild.portfolio.yaml"
  included_files = [
    "services/portfolio-service/**",
    "services/common/**",
    "scripts/service-targets.json",
    "scripts/service_targets.py",
    ".dockerignore",
    "infra/gcp/cloudbuild.portfolio.yaml",
    "infra/gcp/deploy_existing_service.py",
  ]
  substitutions  = { _REPOSITORY = local.portfolio_deployment.artifactRepository }
  disabled       = false
  deploy_enabled = false

  depends_on = [google_project_iam_member.portfolio_build_logging, google_artifact_registry_repository_iam_member.portfolio_build_images]
}

# The service stage may only follow administrator creation of the business root.
# Exact resource-scoped grants cannot be bound before those resources exist.
module "portfolio_database_scope" {
  count  = local.portfolio_service_enabled ? 1 : 0
  source = "../modules/firestore-access"

  project_id               = var.project_id
  database_id              = "portfolio"
  runtime_service_accounts = { runtime = local.portfolio_runtime_email }
}

resource "google_project_iam_custom_role" "portfolio_service_read" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioServiceRead"
  title       = "FolioView Portfolio service read"
  permissions = ["run.services.get"]
}

resource "google_project_iam_custom_role" "portfolio_service_configuration" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioServiceConfiguration"
  title       = "FolioView Portfolio service configuration"
  permissions = ["run.services.get", "run.services.update"]
}

resource "google_cloud_run_v2_service_iam_member" "portfolio_execution" {
  for_each = local.portfolio_service_enabled ? {
    plan  = google_project_iam_custom_role.portfolio_service_read[0].name
    apply = google_project_iam_custom_role.portfolio_service_configuration[0].name
  } : {}

  project  = var.project_id
  location = var.region
  name     = "portfolio-api"
  role     = each.value
  member   = "serviceAccount:${module.target_execution["portfolio"].service_accounts[each.key]}"
}

resource "google_project_iam_custom_role" "portfolio_identity_read" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioIdentityRead"
  title       = "FolioView Portfolio runtime identity read"
  permissions = ["iam.serviceAccounts.get"]
}

resource "google_project_iam_custom_role" "portfolio_identity_metadata" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioIdentityMetadata"
  title       = "FolioView Portfolio runtime metadata"
  permissions = ["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]
}

resource "google_service_account_iam_member" "portfolio_execution_metadata" {
  for_each = local.portfolio_service_enabled ? {
    plan  = google_project_iam_custom_role.portfolio_identity_read[0].name
    apply = google_project_iam_custom_role.portfolio_identity_metadata[0].name
  } : {}

  service_account_id = local.portfolio_runtime
  role               = each.value
  member             = "serviceAccount:${module.target_execution["portfolio"].service_accounts[each.key]}"
}

resource "google_service_account_iam_member" "portfolio_runtime_deployer" {
  count              = local.portfolio_service_enabled ? 1 : 0
  service_account_id = local.portfolio_runtime
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${module.target_execution["portfolio"].service_accounts["apply"]}"
}

resource "google_project_iam_custom_role" "portfolio_image_read" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioConfigurationImageRead"
  title       = "FolioView Portfolio existing image read"
  permissions = ["artifactregistry.repositories.downloadArtifacts"]
}

resource "google_artifact_registry_repository_iam_member" "portfolio_configuration_image" {
  count      = local.portfolio_service_enabled ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = local.portfolio_deployment.artifactRepository
  role       = google_project_iam_custom_role.portfolio_image_read[0].name
  member     = "serviceAccount:${module.target_execution["portfolio"].service_accounts["apply"]}"
}

resource "google_project_iam_custom_role" "portfolio_database_metadata" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioDatabaseMetadata"
  title       = "FolioView Portfolio database metadata"
  permissions = ["datastore.databases.getMetadata"]
}

# No entity/content or DB create/delete permission is added to plan/apply.
# Index/TTL permissions follow the actual POR-002 schema, in a separate change.
resource "google_project_iam_custom_role" "portfolio_database_configuration" {
  count   = local.portfolio_service_enabled ? 1 : 0
  project = var.project_id
  role_id = "folioviewPortfolioDatabaseConfiguration"
  title   = "FolioView Portfolio database configuration"
  permissions = [
    "datastore.databases.getMetadata",
    "datastore.databases.update",
    # The provider polls the resulting database operation after PATCH.
    "datastore.operations.get",
  ]
}

resource "google_project_iam_member" "portfolio_execution_database" {
  for_each = local.portfolio_service_enabled ? {
    plan  = google_project_iam_custom_role.portfolio_database_metadata[0].name
    apply = google_project_iam_custom_role.portfolio_database_configuration[0].name
  } : {}

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${module.target_execution["portfolio"].service_accounts[each.key]}"

  condition {
    title       = module.portfolio_database_scope[0].condition.title
    description = module.portfolio_database_scope[0].condition.description
    expression  = module.portfolio_database_scope[0].condition.expression
  }
}

# Client SDK access is independently denied; admin/server IAM does not use Rules.
# API enablement and actual rule publication are future administrative operations.
resource "google_firebaserules_ruleset" "portfolio" {
  count   = local.portfolio_service_enabled ? 1 : 0
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = <<-RULES
        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /{document=**} {
              allow read, write: if false;
            }
          }
        }
      RULES
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_firebaserules_release" "portfolio" {
  count        = local.portfolio_service_enabled ? 1 : 0
  project      = var.project_id
  name         = "cloud.firestore/portfolio"
  ruleset_name = google_firebaserules_ruleset.portfolio[0].name

  lifecycle {
    prevent_destroy = true
  }
}

output "portfolio_preparation" {
  description = "Explicit Portfolio staging metadata, never evidence of applied resources."
  value = {
    requested_stage   = var.portfolio_provisioning_stage
    execution_enabled = local.portfolio_execution_enabled
    service_enabled   = local.portfolio_service_enabled
    pipeline_enabled  = local.execution_registry.targets.portfolio.enabled
    image_deployment  = false
  }

  precondition {
    condition = !local.portfolio_execution_enabled ? true : (
      module.portfolio_image_release[0].trigger_id == local.portfolio_deployment.adoption.buildTriggerId
    )
    error_message = "Retain Portfolio's inventoried build-trigger UUID; never substitute a new trigger."
  }
}
