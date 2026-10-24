locals {
  project_id       = "financial-analysis-512202"
  region           = "northamerica-northeast2"
  existing_web_uid = "4cd78365-f1a5-4049-a397-d00b1eebfd68"
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# The existing runtime identity is adopted, not created or renamed. Its IAM
# belongs to the administrator-managed Web configuration in bootstrap/.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = "fa-web-runtime"
  display_name = "fa-web-runtime"
  description  = ""

  secret_ids                = {}
  deployer_service_accounts = {}
}

module "web" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "market-web"
  runtime_service_account = module.runtime_identity.email

  # Creation-only input required by the shared contract. Imports and subsequent
  # configuration applies preserve the live image and release-owned traffic.
  image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/market-web@sha256:1884ba316a00f16639c93f670de6670b8bb3f797b6e7eab2e7fd2defe30ab26d"

  port              = 8080
  memory            = "512Mi"
  min_instances     = 0
  max_instances     = 12
  concurrency       = 80
  timeout_seconds   = 300
  startup_cpu_boost = true
  ingress           = "INGRESS_TRAFFIC_ALL"

  # The browser client receives public Firebase and API configuration at build
  # time through the retained image trigger. The deployed container has no env.
  environment        = {}
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
data "google_cloud_run_v2_service" "web_boundary" {
  project  = local.project_id
  location = local.region
  name     = "market-web"

  lifecycle {
    postcondition {
      condition     = self.uid == local.existing_web_uid
      error_message = "Web adoption requires the inventoried service UID; never recreate market-web."
    }

    postcondition {
      condition     = self.invoker_iam_disabled
      error_message = "Web's existing public access uses disabled invoker IAM checks; review a separate access-mode change."
    }

    postcondition {
      condition     = try(self.scaling[0].max_instance_count, 0) == 2
      error_message = "Web's existing service-wide maximum of two must be preserved; the shared controller owns revision scaling only."
    }
  }
}
