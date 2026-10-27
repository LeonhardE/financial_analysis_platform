locals {
  project_id = "financial-analysis-512202"
  region     = "northamerica-northeast2"
  web_origin = "https://market-web-630815932903.northamerica-northeast2.run.app"
  service_configuration = {
    min_instances     = 0
    max_instances     = 1
    concurrency       = 8
    timeout_seconds   = 60
    port              = 8080
    memory            = "256Mi"
    startup_cpu_boost = true
    ingress           = "INGRESS_TRAFFIC_ALL"
    environment = {
      FIREBASE_PROJECT_ID = "financial-analysis-512202"
      FIRESTORE_DATABASE  = "agent-hub"
      HUB_STORE_BACKEND   = "firestore"
      CORS_ORIGINS        = "https://market-web-630815932903.northamerica-northeast2.run.app"
    }
  }
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

variable "bootstrap_image" {
  description = "Creation-only Agent Hub digest. Default is an existing verified plan candidate, not first-provision approval; replace with the approved target-trigger digest before creation."
  type        = string
  default     = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/agent-hub-api@sha256:e4504d4b3b4624dd0c81585f13166fe3c6a4cb6bd9171adc87c9cf5b0b8ad927"
  nullable    = false

  validation {
    condition     = can(regex("^northamerica-northeast2-docker[.]pkg[.]dev/financial-analysis-512202/financial-analysis/agent-hub-api@sha256:[a-f0-9]{64}$", var.bootstrap_image))
    error_message = "Use this target's immutable image in the existing Toronto repository."
  }
}

# Owns metadata only; IAM belongs to the administrator bootstrap service stage.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = "fa-agent-hub-runtime"
  display_name = "FolioView Agent Hub runtime"
  description  = "Agent Hub ciphertext and approved metadata only; no user-content keys."
}

module "database" {
  source = "../../../modules/firestore-database"

  project_id  = local.project_id
  database_id = "agent-hub"
  location_id = local.region

  # Storage-model tickets add explicit TTL/index exemptions when collections and
  # fields are implemented. No speculative collection schema or ciphertext index.
  ttl_fields        = {}
  composite_indexes = {}
}

module "agent_hub" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "agent-hub-api"
  runtime_service_account = module.runtime_identity.email
  image                   = var.bootstrap_image
  port                    = local.service_configuration.port
  memory                  = local.service_configuration.memory
  min_instances           = local.service_configuration.min_instances
  max_instances           = local.service_configuration.max_instances
  concurrency             = local.service_configuration.concurrency
  timeout_seconds         = local.service_configuration.timeout_seconds
  startup_cpu_boost       = local.service_configuration.startup_cpu_boost
  ingress                 = local.service_configuration.ingress

  environment              = local.service_configuration.environment
  secret_environment       = {}
  allow_unauthenticated    = false
  invoker_service_accounts = {}
}
