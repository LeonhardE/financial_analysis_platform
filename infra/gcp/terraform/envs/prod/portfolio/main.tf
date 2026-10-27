locals {
  project_id  = "financial-analysis-512202"
  region      = "northamerica-northeast2"
  database_id = "portfolio"
  environment = {
    FIREBASE_PROJECT_ID     = local.project_id
    FIRESTORE_DATABASE      = local.database_id
    PORTFOLIO_STORE_BACKEND = "firestore"
    CORS_ORIGINS            = "https://market-web-630815932903.northamerica-northeast2.run.app"
  }
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
  account_id   = "fa-portfolio-runtime"
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

  # The skeleton has no storage/query contract yet. POR-002 introduces only the
  # needed metadata indexes/TTL/exemptions before any real content is admitted.
  ttl_fields        = {}
  composite_indexes = {}
}

module "portfolio" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "portfolio-api"
  runtime_service_account = module.runtime_identity.email
  image                   = var.bootstrap_image

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

  # A skeleton is not an authenticated private API. Keep Cloud Run IAM closed;
  # browser invocation/application authentication requires its own later change.
  allow_unauthenticated    = false
  invoker_service_accounts = {}
}
