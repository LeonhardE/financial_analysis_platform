locals {
  project_id          = "financial-analysis-512202"
  region              = "northamerica-northeast2"
  existing_config_uid = "e4f50b70-600b-4aac-9530-4caa9de99944"
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# The existing runtime identity is adopted, not created or renamed. Its IAM
# belongs to the administrator-managed Config configuration in bootstrap/.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = "fa-config-runtime"
  display_name = "fa-config-runtime"
  description  = ""

  secret_ids                = {}
  deployer_service_accounts = {}
}

module "config" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "config-api"
  runtime_service_account = module.runtime_identity.email

  # Creation-only input required by the shared contract. Imports and subsequent
  # configuration applies preserve the live image and release-owned traffic.
  image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/config-api@sha256:6d7be547a8ffd9452c16f8f4cda225c90e0b0fdab69eecc4769cb52434f4df83"

  port              = 8080
  memory            = "256Mi"
  min_instances     = 0
  max_instances     = 12
  concurrency       = 8
  timeout_seconds   = 60
  startup_cpu_boost = true
  ingress           = "INGRESS_TRAFFIC_ALL"

  environment = {
    CORS_ORIGINS         = "https://market-web-630815932903.northamerica-northeast2.run.app"
    FIREBASE_PROJECT_ID  = local.project_id
    FIRESTORE_DATABASE   = "(default)"
    CONFIG_STORE_BACKEND = "firestore"
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
data "google_cloud_run_v2_service" "config_boundary" {
  project  = local.project_id
  location = local.region
  name     = "config-api"

  lifecycle {
    postcondition {
      condition     = self.uid == local.existing_config_uid
      error_message = "Config adoption requires the inventoried service UID; never recreate config-api."
    }

    postcondition {
      condition     = self.invoker_iam_disabled
      error_message = "Config's existing public access uses disabled invoker IAM checks; review a separate access-mode change."
    }

    postcondition {
      condition     = try(self.scaling[0].max_instance_count, 0) == 1
      error_message = "Config's existing service-wide maximum of one must be preserved; the shared controller owns revision scaling only."
    }
  }
}
