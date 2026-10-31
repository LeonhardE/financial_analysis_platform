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

variable "agent_hub_runtime_account_id" {
  description = "Hub's explicit custom runtime account ID; must match its separately reviewed business-root deployment inputs."
  type        = string
  default     = "fa-agent-hub-runtime"
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.agent_hub_runtime_account_id))
    error_message = "Use a canonical custom service account ID in this project."
  }
}

variable "agent_hub_public_connector_enabled" {
  description = "Administrator-only public Hub invoker opt-in after matching OAuth/adapter/application-auth and real consumer acceptance; private by default."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.agent_hub_public_connector_enabled || var.agent_hub_provisioning_stage == "service"
    error_message = "Public invocation requires an explicit service-stage administrator review after business resources and protocol acceptance."
  }
}

locals {
  agent_hub_artifact_repository = jsondecode(var.deployment_configs["repo"]).artifactRepository
  agent_hub_execution_enabled   = var.agent_hub_provisioning_stage != "none" || local.execution_registry.targets["agent-hub"].enabled
  agent_hub_service_enabled     = var.agent_hub_provisioning_stage == "service" || local.execution_registry.targets["agent-hub"].enabled
  agent_hub_runtime_email       = "${var.agent_hub_runtime_account_id}@${var.project_id}.iam.gserviceaccount.com"
  agent_hub_runtime_resource    = "projects/${var.project_id}/serviceAccounts/${local.agent_hub_runtime_email}"
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
      permissions = ["datastore.databases.getMetadata", "datastore.indexes.get"]
    }
    database_configuration = {
      id          = "folioviewAgentHubDatabaseConfiguration"
      permissions = ["datastore.databases.getMetadata", "datastore.databases.update", "datastore.indexes.get", "datastore.indexes.update", "datastore.operations.get"]
    }
    owner_auth_lookup = {
      id          = "folioviewAgentHubOwnerAuthLookup"
      permissions = ["firebaseauth.users.get"]
    }
    signing_ring_read = {
      id          = "folioviewAgentHubSigningRingRead"
      permissions = ["cloudkms.keyRings.get"]
    }
    signing_key_read = {
      id          = "folioviewAgentHubSigningKeyRead"
      permissions = ["cloudkms.cryptoKeys.get"]
    }
    signing_key_configuration = {
      id          = "folioviewAgentHubSigningKeyConfiguration"
      permissions = ["cloudkms.cryptoKeys.get", "cloudkms.cryptoKeys.update"]
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
  repository = local.agent_hub_artifact_repository
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
    "services/agent-hub-service/**", "services/common/**", ".dockerignore", "infra/gcp/cloudbuild.agent-hub.yaml",
    "infra/gcp/deploy_existing_service.py", "scripts/service-targets.json", "scripts/service_targets.py",
  ]
  substitutions  = { _REPOSITORY = local.agent_hub_artifact_repository }
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
  repository = local.agent_hub_artifact_repository
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
    application_status = "current encrypted owner APIs; private first creation, OAuth/adapter explicitly disabled until separate acceptance"
    public_connector   = var.agent_hub_public_connector_enabled
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

# API enablement is a separately reviewed execution-stage proposal. None remains
# inert; an eventual apply must retain the API and its protected signing key.
resource "google_project_service" "agent_hub_kms" {
  count              = local.agent_hub_execution_enabled ? 1 : 0
  project            = var.project_id
  service            = "cloudkms.googleapis.com"
  disable_on_destroy = false
}

# Firebase revocation checks require account lookup, not user listing/admin or
# Firebase signing authority. This is project-level identity metadata only.
resource "google_project_iam_member" "agent_hub_owner_auth" {
  count   = local.agent_hub_service_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.agent_hub["owner_auth_lookup"].name
  member  = "serviceAccount:${local.agent_hub_runtime_email}"
}

locals {
  agent_hub_signing_ring = "projects/${var.project_id}/locations/${var.region}/keyRings/folioview-agent-hub"
  agent_hub_signing_key  = "${local.agent_hub_signing_ring}/cryptoKeys/delegation-signing"
}

# Bootstrap owns these exact-resource IAM tuples. No infrastructure execution
# identity receives signing, private-key import/export, decrypt or key creation.
module "agent_hub_delegation_signer" {
  count         = local.agent_hub_service_enabled ? 1 : 0
  source        = "../modules/kms-key-access"
  project_id    = var.project_id
  crypto_key_id = local.agent_hub_signing_key
  usage         = "delegation_signer"
  members       = { runtime = local.agent_hub_runtime_email }
}

module "agent_hub_delegation_public_key" {
  count         = local.agent_hub_service_enabled ? 1 : 0
  source        = "../modules/kms-key-access"
  project_id    = var.project_id
  crypto_key_id = local.agent_hub_signing_key
  usage         = "public_key_viewer"
  members       = { runtime = local.agent_hub_runtime_email }
}

resource "google_kms_key_ring_iam_member" "agent_hub_signing_metadata" {
  for_each    = local.agent_hub_phase_accounts
  key_ring_id = local.agent_hub_signing_ring
  role        = google_project_iam_custom_role.agent_hub["signing_ring_read"].name
  member      = "serviceAccount:${each.value}"
}

resource "google_kms_crypto_key_iam_member" "agent_hub_signing_metadata" {
  for_each      = local.agent_hub_phase_accounts
  crypto_key_id = local.agent_hub_signing_key
  role          = google_project_iam_custom_role.agent_hub[each.key == "plan" ? "signing_key_read" : "signing_key_configuration"].name
  member        = "serviceAccount:${each.value}"
}

# Public invocation is a distinct administrator IAM decision. It does not turn
# OAuth/adapter flags on, grant user access or bypass owner/internal validation.
resource "google_cloud_run_v2_service_iam_member" "agent_hub_public_connector" {
  count    = local.agent_hub_service_enabled && var.agent_hub_public_connector_enabled ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = "agent-hub-api"
  role     = "roles/run.invoker"
  member   = "allUsers"
}
