locals {
  project_id  = var.deployment.project_id
  region      = var.deployment.region
  database_id = "portfolio"
  hub_trust_environment = var.hub_trust == null ? {} : (
    alltrue([for value in values(var.hub_trust) : value == ""]) ? {} : var.hub_trust
  )
  environment = merge({
    FIREBASE_PROJECT_ID     = local.project_id
    FIRESTORE_DATABASE      = local.database_id
    PORTFOLIO_STORE_BACKEND = "firestore"
    CORS_ORIGINS            = var.deployment.web_origin
  }, local.hub_trust_environment)
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# One owner in this target's business state. Administrator bootstrap owns IAM.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = var.deployment.runtime_account_id
  display_name = "FolioView Portfolio runtime"
  description  = "Keyless runtime for encrypted holdings and permitted metadata only."

  secret_ids                = {}
  deployer_service_accounts = {}
}

module "database" {
  source = "../../../modules/firestore-database"

  project_id  = local.project_id
  database_id = local.database_id
  location_id = local.region

  # Preserve the already-created named database and its existing storage shape.
  # Schema/index/TTL changes remain a separate Portfolio change.
  ttl_fields        = {}
  composite_indexes = {}
}

module "portfolio" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "portfolio-api"
  runtime_service_account = module.runtime_identity.email
  image                   = var.deployment.creation_image

  port              = 8080
  memory            = "256Mi"
  min_instances     = 0
  max_instances     = 1
  concurrency       = 8
  timeout_seconds   = 60
  startup_cpu_boost = false
  ingress           = "INGRESS_TRAFFIC_ALL"

  environment        = local.environment
  secret_environment = {}

  # Preserve the existing private Cloud Run IAM boundary. Public browser
  # invocation/application authentication requires a separate reviewed change.
  allow_unauthenticated    = false
  invoker_service_accounts = {}
}

# This target has already been created. A missing or replaced service must fail
# a read-only plan rather than let this configuration recreate it.
data "google_cloud_run_v2_service" "portfolio_boundary" {
  project  = local.project_id
  location = local.region
  name     = "portfolio-api"

  lifecycle {
    postcondition {
      condition     = self.uid == var.deployment.existing_service_uid
      error_message = "Portfolio adoption requires the inventoried service UID; never recreate portfolio-api."
    }

    postcondition {
      condition     = !self.invoker_iam_disabled
      error_message = "Portfolio must retain its existing private invoker IAM checks."
    }

    postcondition {
      condition     = try(self.scaling[0].max_instance_count, 0) == 12
      error_message = "Portfolio's existing service-wide maximum is 12; the independently owned revision maximum remains 1."
    }
  }
}
