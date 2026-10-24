locals {
  project_id          = "financial-analysis-512202"
  region              = "northamerica-northeast2"
  existing_market_uid = "9c834402-c8d5-4c71-82d9-1a705e335f02"
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# The existing runtime identity is adopted, not created or renamed. Its IAM
# belongs to the administrator-managed Market configuration in bootstrap/.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = "fa-api-runtime"
  display_name = "fa-api-runtime"
  description  = ""

  secret_ids                = {}
  deployer_service_accounts = {}
}

module "market" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "market-api"
  runtime_service_account = module.runtime_identity.email

  # Creation-only input required by the shared contract. Imports and subsequent
  # configuration applies preserve the live image and release-owned traffic.
  image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/market-api@sha256:ff9fdab6bfbd0193d47b53d64fea87152a1896337c90baf6207536d97212f521"

  port              = 8080
  memory            = "512Mi"
  min_instances     = 0
  max_instances     = 12
  concurrency       = 80
  timeout_seconds   = 300
  startup_cpu_boost = true
  ingress           = "INGRESS_TRAFFIC_ALL"

  environment = {
    CORS_ORIGINS                = "https://market-web-630815932903.northamerica-northeast2.run.app"
    FIREBASE_PROJECT_ID         = local.project_id
    MARKET_DATA_SOURCE          = "yfinance"
    MARKET_CACHE_BACKEND        = "firestore"
    MARKET_FIRESTORE_DATABASE   = "(default)"
    MARKET_CACHE_TTL_SECONDS    = "3600"
    MARKET_UPSTREAM_DAILY_LIMIT = "200"
  }
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
data "google_cloud_run_v2_service" "market_boundary" {
  project  = local.project_id
  location = local.region
  name     = "market-api"

  lifecycle {
    postcondition {
      condition     = self.uid == local.existing_market_uid
      error_message = "Market adoption requires the inventoried service UID; never recreate market-api."
    }

    postcondition {
      condition     = self.invoker_iam_disabled
      error_message = "Market's existing public access uses disabled invoker IAM checks; review a separate access-mode change."
    }

    postcondition {
      condition     = try(self.scaling[0].max_instance_count, 0) == 2
      error_message = "Market's existing service-wide maximum of two must be preserved; the shared controller owns revision scaling only."
    }
  }
}
