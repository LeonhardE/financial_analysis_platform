locals {
  enabled         = var.stage != "none"
  service_enabled = var.stage == "base"
  project_id      = var.deployment.project_id
  region          = var.deployment.region
  runtime_email   = "${var.deployment.runtime_account_id}@${local.project_id}.iam.gserviceaccount.com"
  build_email     = "${var.deployment.build_account_id}@${local.project_id}.iam.gserviceaccount.com"
  database_id     = "agent-policy-witness"
  snapshot_name   = "${local.project_id}-policy-snapshots"
  labels          = { application = "folioview", target = "agent-policy", managed_by = "terraform" }
  # Base cannot acquire authority merely by changing an input/config file.
  environment = {
    POLICY_ENABLED             = "0"
    POLICY_KEY_RELEASE_ENABLED = "0"
    POLICY_STORE_BACKEND       = "cloud"
    POLICY_CONFIG              = ""
    CORS_ORIGINS               = ""
  }
  apis = toset([
    "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "cloudkms.googleapis.com",
    "firestore.googleapis.com", "firebaserules.googleapis.com", "iam.googleapis.com",
    "logging.googleapis.com", "run.googleapis.com", "storage.googleapis.com",
  ])
}

provider "google" {
  project                         = local.project_id
  region                          = local.region
  add_terraform_attribution_label = false
}

# This entire root belongs to the independent trusted Owner administrator.
# Ordinary repository plan/apply/build/Hub/executor identities get no grant here.
resource "google_project_service" "policy" {
  for_each           = local.enabled ? local.apis : toset([])
  project            = local.project_id
  service            = each.value
  disable_on_destroy = false
}

module "runtime_identity" {
  count        = local.enabled ? 1 : 0
  source       = "../../../modules/service-identity"
  project_id   = local.project_id
  account_id   = var.deployment.runtime_account_id
  display_name = "FolioView independent Policy runtime"
  description  = "Trusted Owner authority; base has no sign, decrypt, witness or impersonation grant."
  depends_on   = [google_project_service.policy]
}

module "build_identity" {
  count        = local.enabled ? 1 : 0
  source       = "../../../modules/service-identity"
  project_id   = local.project_id
  account_id   = var.deployment.build_account_id
  display_name = "FolioView independent Policy image build"
  description  = "Build-only image writer, never Policy deployer, signer or key-release authority."
  depends_on   = [google_project_service.policy]
}

resource "google_artifact_registry_repository" "policy" {
  count         = local.enabled ? 1 : 0
  project       = local.project_id
  location      = local.region
  repository_id = var.deployment.artifact_repository
  format        = "DOCKER"
  description   = "Independent Policy build candidates; no automatic deployment or cleanup."
  labels        = local.labels
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.policy]
}

resource "google_artifact_registry_repository_iam_member" "build" {
  count      = local.enabled ? 1 : 0
  project    = local.project_id
  location   = local.region
  repository = google_artifact_registry_repository.policy[0].repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${local.build_email}"
  depends_on = [module.build_identity]
}

resource "google_project_iam_member" "build_logging" {
  count      = local.enabled ? 1 : 0
  project    = local.project_id
  role       = "roles/logging.logWriter"
  member     = "serviceAccount:${local.build_email}"
  depends_on = [module.build_identity]
}

# Reuse the guarded configuration controller: no full-template provider update,
# no image/traffic rollback and no deploy rights for the build-only identity.
module "agent_policy" {
  count                    = local.service_enabled ? 1 : 0
  source                   = "../../../modules/cloud-run-service"
  project_id               = local.project_id
  region                   = local.region
  name                     = "agent-policy-api"
  runtime_service_account  = local.runtime_email
  image                    = var.deployment.creation_image
  port                     = 8080
  memory                   = "512Mi"
  min_instances            = 0
  max_instances            = 1
  concurrency              = 4
  timeout_seconds          = 60
  startup_cpu_boost        = false
  ingress                  = "INGRESS_TRAFFIC_ALL"
  environment              = local.environment
  secret_environment       = {}
  allow_unauthenticated    = false
  invoker_service_accounts = {}
  depends_on               = [google_project_service.policy, module.runtime_identity]
}
