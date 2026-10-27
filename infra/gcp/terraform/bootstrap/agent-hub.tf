# INF-006 preparation is inert by default. Initial execution infrastructure can
# precede the service; service-scoped IAM must wait until business-root creation.
variable "agent_hub_provisioning_stage" {
  description = "Administrator-only additive stage: none, execution, or service. Keep service after provisioning; never reset a protected target to none."
  type        = string
  default     = "none"
  nullable    = false

  validation {
    condition     = contains(["none", "execution", "service"], var.agent_hub_provisioning_stage)
    error_message = "Use none, execution, or service; every apply requires a separately reviewed administrator saved plan."
  }
}

locals {
  agent_hub_execution_enabled = var.agent_hub_provisioning_stage != "none" || local.execution_registry.targets["agent-hub"].enabled
  agent_hub_service_enabled   = var.agent_hub_provisioning_stage == "service" || local.execution_registry.targets["agent-hub"].enabled
  agent_hub_runtime_email     = "fa-agent-hub-runtime@${var.project_id}.iam.gserviceaccount.com"
  agent_hub_runtime_resource  = "projects/${var.project_id}/serviceAccounts/${local.agent_hub_runtime_email}"
  agent_hub_phase_accounts = local.agent_hub_service_enabled ? {
    plan  = "fa-infra-agent-hub-plan@${var.project_id}.iam.gserviceaccount.com"
    apply = "fa-infra-agent-hub-apply@${var.project_id}.iam.gserviceaccount.com"
  } : {}
  agent_hub_service_roles = local.agent_hub_service_enabled ? {
    service_read = {
      id          = "folioviewAgentHubServiceRead"
      permissions = ["run.services.get"]
    }
    service_configuration = {
      id          = "folioviewAgentHubServiceConfiguration"
      permissions = ["run.services.get", "run.services.update"]
    }
    identity_read = {
      id          = "folioviewAgentHubIdentityRead"
      permissions = ["iam.serviceAccounts.get"]
    }
    identity_metadata = {
      id          = "folioviewAgentHubIdentityMetadata"
      permissions = ["iam.serviceAccounts.get", "iam.serviceAccounts.update", "iam.serviceAccounts.enable"]
    }
    image_read = {
      id          = "folioviewAgentHubConfigurationImageRead"
      permissions = ["artifactregistry.repositories.downloadArtifacts"]
    }
    database_read = {
      id          = "folioviewAgentHubDatabaseRead"
      permissions = ["datastore.databases.getMetadata"]
    }
    database_configuration = {
      id          = "folioviewAgentHubDatabaseConfiguration"
      permissions = ["datastore.databases.getMetadata", "datastore.databases.update", "datastore.operations.get"]
    }
  } : {}
}

# Keyless build identity has no runtime attachment, Run, user-data or key rights.
module "agent_hub_build_identity" {
  count  = local.agent_hub_execution_enabled ? 1 : 0
  source = "../modules/service-identity"

  project_id   = var.project_id
  account_id   = "fa-agent-hub-build"
  display_name = "FolioView Agent Hub image build"
  description  = "Build-only Agent Hub images; no runtime impersonation or deployment permission."
}

resource "google_project_iam_member" "agent_hub_build_logging" {
  count   = local.agent_hub_execution_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = module.agent_hub_build_identity[0].member
}

resource "google_artifact_registry_repository_iam_member" "agent_hub_build_images" {
  count      = local.agent_hub_execution_enabled ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = "financial-analysis"
  role       = "roles/artifactregistry.writer"
  member     = module.agent_hub_build_identity[0].member
}

module "agent_hub_image_release" {
  count  = local.agent_hub_execution_enabled ? 1 : 0
  source = "../modules/service-build-trigger"

  project_id            = var.project_id
  region                = var.region
  name                  = "build-agent-hub-api"
  repository_id         = var.repository_id
  build_service_account = module.agent_hub_build_identity[0].id
  filename              = "infra/gcp/cloudbuild.agent-hub.yaml"
  included_files = [
    "services/agent-hub-service/**", "services/common/**", ".dockerignore",
    "infra/gcp/deploy_existing_service.py", "scripts/service-targets.json", "scripts/service_targets.py",
  ]
  substitutions  = { _REPOSITORY = "financial-analysis" }
  disabled       = false
  deploy_enabled = false

  depends_on = [
    google_project_iam_member.agent_hub_build_logging,
    google_artifact_registry_repository_iam_member.agent_hub_build_images,
  ]
}

resource "google_project_iam_custom_role" "agent_hub" {
  for_each    = local.agent_hub_service_roles
  project     = var.project_id
  role_id     = each.value.id
  title       = "FolioView Agent Hub ${replace(each.key, "_", " ")}"
  description = "Agent Hub ${replace(each.key, "_", " ")} only when bound on its exact resource."
  permissions = each.value.permissions
}

resource "google_cloud_run_v2_service_iam_member" "agent_hub_execution" {
  for_each = local.agent_hub_phase_accounts
  project  = var.project_id
  location = var.region
  name     = "agent-hub-api"
  role     = google_project_iam_custom_role.agent_hub[each.key == "plan" ? "service_read" : "service_configuration"].name
  member   = "serviceAccount:${each.value}"
}

resource "google_service_account_iam_member" "agent_hub_execution_metadata" {
  for_each           = local.agent_hub_phase_accounts
  service_account_id = local.agent_hub_runtime_resource
  role               = google_project_iam_custom_role.agent_hub[each.key == "plan" ? "identity_read" : "identity_metadata"].name
  member             = "serviceAccount:${each.value}"
}

resource "google_service_account_iam_member" "agent_hub_runtime_deployer" {
  count              = local.agent_hub_service_enabled ? 1 : 0
  service_account_id = local.agent_hub_runtime_resource
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.agent_hub_phase_accounts.apply}"
}

resource "google_artifact_registry_repository_iam_member" "agent_hub_configuration_image" {
  count      = local.agent_hub_service_enabled ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = "financial-analysis"
  role       = google_project_iam_custom_role.agent_hub["image_read"].name
  member     = "serviceAccount:${local.agent_hub_phase_accounts.apply}"
}

module "agent_hub_database_access" {
  count  = local.agent_hub_service_enabled ? 1 : 0
  source = "../modules/firestore-access"

  project_id               = var.project_id
  database_id              = "agent-hub"
  runtime_service_accounts = { runtime = local.agent_hub_runtime_email }
}

# No entity/content permissions for infrastructure execution. Database metadata
# grants use the same exact database condition as the runtime data grant.
resource "google_project_iam_member" "agent_hub_database_configuration" {
  for_each = local.agent_hub_phase_accounts
  project  = var.project_id
  role     = google_project_iam_custom_role.agent_hub[each.key == "plan" ? "database_read" : "database_configuration"].name
  member   = "serviceAccount:${each.value}"

  condition {
    title       = module.agent_hub_database_access[0].condition.title
    description = module.agent_hub_database_access[0].condition.description
    expression  = module.agent_hub_database_access[0].condition.expression
  }
}

output "agent_hub_preparation" {
  description = "Stage metadata only; no first-provision approval, secrets or keys."
  value = {
    stage              = var.agent_hub_provisioning_stage
    pipeline_enabled   = local.execution_registry.targets["agent-hub"].enabled
    image_deploys      = false
    database_id        = "agent-hub"
    runtime_identity   = local.agent_hub_runtime_email
    application_status = "health-only; private/OAuth/MCP routes remain unavailable"
  }
}

# Client SDK access is denied independently of runtime IAM. Deploy only after
# the real named database exists; never reuse the default database release.
resource "google_firebaserules_ruleset" "agent_hub" {
  count   = local.agent_hub_service_enabled ? 1 : 0
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

resource "google_firebaserules_release" "agent_hub" {
  count        = local.agent_hub_service_enabled ? 1 : 0
  project      = var.project_id
  name         = "cloud.firestore/agent-hub"
  ruleset_name = google_firebaserules_ruleset.agent_hub[0].name
  lifecycle {
    prevent_destroy = true
  }
}
