locals {
  project_id    = var.deployment.project_id
  region        = var.deployment.region
  web_origin    = var.deployment.web_origin
  runtime_email = "${var.deployment.runtime_account_id}@${local.project_id}.iam.gserviceaccount.com"
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
      FIREBASE_PROJECT_ID           = local.project_id
      FIRESTORE_DATABASE            = "agent-hub"
      AGENT_HUB_STORE_BACKEND       = "firestore"
      CORS_ORIGINS                  = local.web_origin
      HUB_SERVICE_AUDIENCE          = var.deployment.hub_origin
      HUB_KMS_SIGNING_KEY_VERSION   = "${google_kms_crypto_key.delegation.id}/cryptoKeyVersions/1"
      HUB_CATALOGUE_CALLER_EMAIL    = local.runtime_email
      HUB_USER_ORIGIN               = var.sources.user_origin
      HUB_PORTFOLIO_ORIGIN          = var.sources.portfolio_origin
      HUB_PORTFOLIO_CALLER_EMAIL    = var.sources.portfolio_caller_email
      HUB_TRUSTED_PORTFOLIO_CALLERS = jsonencode(var.sources.trusted_portfolio_callers)
      HUB_OAUTH_ENABLED             = var.connector.oauth_enabled ? "1" : "0"
      HUB_ENCRYPTED_ADAPTER_ENABLED = var.connector.encrypted_adapter_enabled ? "1" : "0"
      HUB_OAUTH_ISSUER              = var.deployment.hub_origin
      HUB_OAUTH_CONSENT_URL         = "${var.deployment.hub_origin}/agent/v2/helper/consent.html"
      HUB_OAUTH_CLIENTS_JSON = jsonencode([for client in var.connector.muse_clients : {
        provider                = "muse"
        clientId                = client.client_id
        redirectUris            = client.redirect_uris
        tokenEndpointAuthMethod = client.token_endpoint_auth_method
        secretSha256            = client.secret_sha256
      }])
    }
  }
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# This target owns metadata/resources. Administrator bootstrap owns all IAM.
module "runtime_identity" {
  source = "../../../modules/service-identity"

  project_id   = local.project_id
  account_id   = var.deployment.runtime_account_id
  display_name = "FolioView Agent Hub runtime"
  description  = "Ciphertext/approved metadata and delegated public-authority signing; no user-content keys."
}

module "database" {
  source = "../../../modules/firestore-database"

  project_id  = local.project_id
  database_id = "agent-hub"
  location_id = local.region

  # No TTL for grants, histories, operation ACKs or correctness-bearing references.
  ttl_fields        = {}
  composite_indexes = {}
}

# These operational signing keys never encrypt user content or appear as private
# key bytes in Terraform, environment, backend snapshots or recovery mechanisms.
resource "google_kms_key_ring" "delegation" {
  name     = "folioview-agent-hub"
  project  = local.project_id
  location = local.region
  lifecycle { prevent_destroy = true }
}

resource "google_kms_crypto_key" "delegation" {
  name                          = "delegation-signing"
  key_ring                      = google_kms_key_ring.delegation.id
  purpose                       = "ASYMMETRIC_SIGN"
  skip_initial_version_creation = false
  destroy_scheduled_duration    = "2592000s"
  version_template {
    algorithm        = "RSA_SIGN_PKCS1_2048_SHA256"
    protection_level = "SOFTWARE"
  }
  lifecycle { prevent_destroy = true }
}

module "agent_hub" {
  source = "../../../modules/cloud-run-service"

  project_id              = local.project_id
  region                  = local.region
  name                    = "agent-hub-api"
  runtime_service_account = module.runtime_identity.email
  image                   = var.deployment.creation_image
  port                    = local.service_configuration.port
  memory                  = local.service_configuration.memory
  min_instances           = local.service_configuration.min_instances
  max_instances           = local.service_configuration.max_instances
  concurrency             = local.service_configuration.concurrency
  timeout_seconds         = local.service_configuration.timeout_seconds
  startup_cpu_boost       = local.service_configuration.startup_cpu_boost
  ingress                 = local.service_configuration.ingress

  environment        = local.service_configuration.environment
  secret_environment = {}
  # Public connector invocation, when separately authorized, belongs to the
  # administrator bootstrap service stage, never normal target apply IAM rights.
  allow_unauthenticated    = false
  invoker_service_accounts = {}
}
