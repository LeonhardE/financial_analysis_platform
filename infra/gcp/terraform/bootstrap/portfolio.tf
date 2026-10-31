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

variable "portfolio_image_deployment_enabled" {
  description = "Explicit administrator opt-in to the existing Portfolio image release, only after service-stage review. False preserves build-only triggers and grants no image deployer rights."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.portfolio_image_deployment_enabled || var.portfolio_provisioning_stage == "service"
    error_message = "Image deployment needs an explicitly retained Portfolio service stage and a complete reviewed administrator plan."
  }
}

locals {
  portfolio_execution_enabled = local.execution_registry.targets.portfolio.enabled || var.portfolio_provisioning_stage != "none"
  portfolio_service_enabled   = local.execution_registry.targets.portfolio.enabled || var.portfolio_provisioning_stage == "service"
  portfolio_deployment        = local.portfolio_execution_enabled ? jsondecode(var.deployment_configs["portfolio"]) : null
  portfolio_runtime           = local.portfolio_service_enabled ? "projects/${var.project_id}/serviceAccounts/${local.portfolio_deployment.inputs.runtime_account_id}@${var.project_id}.iam.gserviceaccount.com" : null
  portfolio_runtime_email     = local.portfolio_service_enabled ? "${local.portfolio_deployment.inputs.runtime_account_id}@${var.project_id}.iam.gserviceaccount.com" : null
  portfolio_invokers          = local.portfolio_service_enabled ? try(local.portfolio_deployment.portfolioHubTrust.configuration.invokerServiceAccounts, {}) : {}
}

module "portfolio_build_identity" {
  count  = local.portfolio_execution_enabled ? 1 : 0
  source = "../modules/service-identity"

  project_id   = var.project_id
  account_id   = "fa-portfolio-build"
  display_name = "FolioView Portfolio image build"
  description  = "Portfolio image publisher; service-only deployment is separately gated, with no content access."
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
  deploy_enabled = var.portfolio_image_deployment_enabled

  depends_on = [
    google_project_iam_member.portfolio_build_logging,
    google_artifact_registry_repository_iam_member.portfolio_build_images,
    google_project_iam_member.portfolio_image_build_metadata,
    google_cloud_run_v2_service_iam_member.portfolio_image_configuration,
    google_service_account_iam_member.portfolio_image_runtime,
  ]
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
  permissions = ["datastore.databases.getMetadata", "datastore.indexes.get"]
}

# No entity/content or DB create/delete permission is added to plan/apply.
# Exact Portfolio field metadata/update supports the implemented opaque-field
# exemptions. No TTL is configured and no index creation/deletion is granted.
resource "google_project_iam_custom_role" "portfolio_database_configuration" {
  count   = local.portfolio_service_enabled ? 1 : 0
  project = var.project_id
  role_id = "folioviewPortfolioDatabaseConfiguration"
  title   = "FolioView Portfolio database configuration"
  permissions = [
    "datastore.databases.getMetadata",
    "datastore.databases.update",
    "datastore.indexes.get",
    "datastore.indexes.update",
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
    image_deployment  = var.portfolio_image_deployment_enabled
  }

  precondition {
    condition = !local.portfolio_execution_enabled ? true : (
      module.portfolio_image_release[0].trigger_id == local.portfolio_deployment.adoption.buildTriggerId
    )
    error_message = "Retain Portfolio's inventoried build-trigger UUID; never substitute a new trigger."
  }
}

# Service IAM remains owned by this Portfolio administrative target. Web can
# forward owner credentials but is deliberately absent from Hub internal trust.
resource "google_cloud_run_v2_service_iam_member" "portfolio_invoker" {
  for_each = local.portfolio_invokers

  project  = var.project_id
  location = var.region
  name     = "portfolio-api"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${each.value}"

  lifecycle {
    precondition {
      condition = (
        contains(["web", "hub"], each.key) &&
        can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@${var.project_id}\\.iam\\.gserviceaccount\\.com$", each.value)) &&
        each.value != local.portfolio_runtime_email &&
        length(distinct(values(local.portfolio_invokers))) == length(local.portfolio_invokers) &&
        try(each.value == (each.key == "web" ? "${local.portfolio_deployment.portfolioHubTrust.configuration.webRuntimeAccountId}@${var.project_id}.iam.gserviceaccount.com" : "${local.portfolio_deployment.portfolioHubTrust.hubDeployment.inputs.runtime_account_id}@${var.project_id}.iam.gserviceaccount.com"), false)
      )
      error_message = "Only exact distinct same-project Web/Hub runtime invokers from the reviewed Portfolio contract are allowed."
    }
  }
}

# Reuse the existing service-scoped get/update-only custom role. The image
# publisher cannot create/delete services, administer IAM, or read user data.
resource "google_cloud_run_v2_service_iam_member" "portfolio_image_configuration" {
  count    = local.portfolio_service_enabled && var.portfolio_image_deployment_enabled ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = "portfolio-api"
  role     = google_project_iam_custom_role.portfolio_service_configuration[0].name
  member   = module.portfolio_build_identity[0].member
}

resource "google_service_account_iam_member" "portfolio_image_runtime" {
  count              = local.portfolio_service_enabled && var.portfolio_image_deployment_enabled ? 1 : 0
  service_account_id = local.portfolio_runtime
  role               = "roles/iam.serviceAccountUser"
  member             = module.portfolio_build_identity[0].member
}

# Firebase Admin checks revocation through a bounded user lookup. No user listing,
# user management, token signing or content/data permission is added.
resource "google_project_iam_custom_role" "portfolio_owner_auth_lookup" {
  count       = local.portfolio_service_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "folioviewPortfolioOwnerAuthLookup"
  title       = "FolioView Portfolio owner auth lookup"
  permissions = ["firebaseauth.users.get"]
}

resource "google_project_iam_member" "portfolio_owner_auth" {
  count   = local.portfolio_service_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.portfolio_owner_auth_lookup[0].name
  member  = "serviceAccount:${local.portfolio_runtime_email}"
}

# The unchanged release helper verifies its own producing build before PATCH.
# The existing foundation role reads build/trigger metadata and cannot queue,
# approve or change builds, access user data, or impersonate another identity.
resource "google_project_iam_member" "portfolio_image_build_metadata" {
  count   = local.portfolio_service_enabled && var.portfolio_image_deployment_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.build_metadata.name
  member  = module.portfolio_build_identity[0].member
}
