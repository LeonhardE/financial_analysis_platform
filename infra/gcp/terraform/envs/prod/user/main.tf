locals {
  project_id        = var.deployment.project_id
  region            = var.deployment.region
  existing_user_uid = var.deployment.existing_service_uid
  hub_trust_environment = var.hub_trust == null ? {} : (
    alltrue([for value in values(var.hub_trust) : value == ""]) ? {} : var.hub_trust
  )
  environment = merge({
    FIREBASE_PROJECT_ID = local.project_id
    CORS_ORIGINS        = var.deployment.web_origin
    FIRESTORE_DATABASE  = "(default)"
    USER_STORE_BACKEND  = "firestore"
    MARKET_API_BASE_URL = var.deployment.market_origin
  }, local.hub_trust_environment)
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# The existing runtime identity is adopted, not created or renamed. Its IAM
# belongs to the administrator-managed User configuration in bootstrap/.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = var.deployment.runtime_account_id
  display_name = var.deployment.runtime_account_id
  description  = ""

  secret_ids                = {}
  deployer_service_accounts = {}
}

module "user" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "user-api"
  runtime_service_account = module.runtime_identity.email

  # Creation-only input required by the shared contract. Imports and subsequent
  # configuration applies preserve the live image and release-owned traffic.
  image = var.deployment.creation_image

  port              = 8080
  memory            = "256Mi"
  min_instances     = 0
  max_instances     = 12
  concurrency       = 8
  timeout_seconds   = 60
  startup_cpu_boost = true
  ingress           = "INGRESS_TRAFFIC_ALL"

  environment        = local.environment
  secret_environment = {}

  # Public invocation already uses invokerIamDisabled=true. Do not add an
  # allUsers grant or mistake this no-new-IAM choice for a private service.
  allow_unauthenticated    = false
  invoker_service_accounts = {}
}

# Read independently during planning, before any controller work. These imported
# boundaries are observed, not written by the shared configuration controller.
# A missing/replaced service or changed access/cap must fail the plan rather
# than defer discovery until after a native create could have been applied.
data "google_cloud_run_v2_service" "user_boundary" {
  project  = local.project_id
  location = local.region
  name     = "user-api"

  lifecycle {
    postcondition {
      condition     = self.uid == local.existing_user_uid
      error_message = "User adoption requires the inventoried service UID; never recreate user-api."
    }

    postcondition {
      condition     = self.invoker_iam_disabled
      error_message = "User's existing public access uses disabled invoker IAM checks; review a separate access-mode change."
    }

    postcondition {
      condition     = try(self.scaling[0].max_instance_count, 0) == 1
      error_message = "User's existing service-wide maximum of one must be preserved; the shared controller owns revision scaling only."
    }
  }
}
