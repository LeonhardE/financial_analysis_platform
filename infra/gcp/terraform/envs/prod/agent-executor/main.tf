locals {
  enabled       = var.stage != "none"
  vm            = contains(["creation", "runtime"], var.stage)
  project       = var.deployment.project_id
  region        = var.deployment.region
  name          = var.deployment.instance_name
  bucket        = "${local.project}-executor-state"
  config_bucket = "${local.project}-executor-config"
  labels        = { application = "folioview", target = "agent-executor", managed_by = "terraform" }
  accounts = {
    runtime  = var.deployment.runtime_account_id
    creation = var.deployment.creation_account_id
    build    = var.deployment.build_account_id
  }
  emails            = { for mode, id in local.accounts : mode => "${id}@${local.project}.iam.gserviceaccount.com" }
  workload_accounts = local.enabled ? { for mode in ["runtime", "creation"] : mode => local.emails[mode] } : {}
  apis = toset([
    "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "compute.googleapis.com",
    "confidentialcomputing.googleapis.com", "iam.googleapis.com", "logging.googleapis.com", "storage.googleapis.com",
  ])
  # No unbounded metadata/environment map or shell command is accepted.
  operator_environment = !local.vm ? {} : merge({
    EXECUTOR_ROOT_KEY_ID = var.launch.root_key_id
    }, var.stage == "creation" ? {
    EXECUTOR_ENABLED          = "0"
    EXECUTOR_CREATION_ENABLED = "1"
    EXECUTOR_NATIVE_ENABLED   = "0"
    EXECUTOR_DRAFT_OBJECT     = var.launch.draft_object
    EXECUTOR_PERMIT_OBJECT    = var.launch.permit_object
    EXECUTOR_ROOT_JWK_OBJECT  = var.launch.root_jwk_object
    } : {
    EXECUTOR_ENABLED          = "1"
    EXECUTOR_CREATION_ENABLED = "0"
    EXECUTOR_NATIVE_ENABLED   = var.launch.native_enabled ? "1" : "0"
    EXECUTOR_CONFIG_OBJECT    = var.launch.config_object
    }, try(var.launch.native_enabled, false) ? {
    EXECUTOR_NATIVE_CONFIG_OBJECT = var.launch.native_config_object
    EXECUTOR_NATIVE_CONFIG_SHA256 = var.launch.native_config_sha256
  } : {})
  metadata = !local.vm ? {} : merge({
    tee-image-reference          = var.launch.image
    tee-restart-policy           = "Never"
    tee-container-log-redirect   = "false"
    tee-monitoring-memory-enable = "false"
    tee-nonroot-container        = "true"
    block-project-ssh-keys       = "true"
    serial-port-enable           = "0"
    disable-legacy-endpoints     = "TRUE"
  }, { for key, value in local.operator_environment : "tee-env-${key}" => value })
}

provider "google" {
  project                         = local.project
  region                          = local.region
  zone                            = var.deployment.zone
  add_terraform_attribution_label = false
}

resource "google_project_service" "executor" {
  for_each           = local.enabled ? local.apis : toset([])
  project            = local.project
  service            = each.value
  disable_on_destroy = false
}

module "identity" {
  for_each     = local.enabled ? local.accounts : {}
  source       = "../../../modules/service-identity"
  project_id   = local.project
  account_id   = each.value
  display_name = "FolioView Executor ${each.key}"
  description  = "Executor ${each.key} only; no Policy deployment, KMS decrypt, Root secrets or service-account impersonation."
  depends_on   = [google_project_service.executor]
}

resource "google_artifact_registry_repository" "executor" {
  count         = local.enabled ? 1 : 0
  project       = local.project
  location      = local.region
  repository_id = var.deployment.artifact_repository
  format        = "DOCKER"
  labels        = local.labels
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.executor]
}
resource "google_artifact_registry_repository_iam_member" "build" {
  count      = local.enabled ? 1 : 0
  project    = local.project
  location   = local.region
  repository = google_artifact_registry_repository.executor[0].repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${local.emails.build}"
  depends_on = [module.identity]
}
resource "google_project_iam_member" "build_logging" {
  count      = local.enabled ? 1 : 0
  project    = local.project
  role       = "roles/logging.logWriter"
  member     = "serviceAccount:${local.emails.build}"
  depends_on = [module.identity]
}
resource "google_artifact_registry_repository_iam_member" "pull" {
  for_each   = local.workload_accounts
  project    = local.project
  location   = local.region
  repository = google_artifact_registry_repository.executor[0].repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${each.value}"
  depends_on = [module.identity]
}
resource "google_project_iam_member" "attest" {
  for_each   = local.workload_accounts
  project    = local.project
  role       = "roles/confidentialcomputing.workloadUser"
  member     = "serviceAccount:${each.value}"
  depends_on = [module.identity]
}

resource "terraform_data" "launch" {
  count            = local.vm ? 1 : 0
  input            = { image = var.launch.image, boot_image = var.launch.confidential_space_image, metadata = local.metadata, identity = local.emails[var.stage == "creation" ? "creation" : "runtime"] }
  triggers_replace = [sha256(jsonencode(var.launch)), sha256(jsonencode(local.metadata)), var.stage]
}

resource "google_compute_instance" "executor" {
  count                     = local.vm ? 1 : 0
  project                   = local.project
  name                      = local.name
  zone                      = var.deployment.zone
  machine_type              = "n2d-standard-2"
  min_cpu_platform          = "AMD Milan"
  deletion_protection       = var.instance_protection_enabled
  allow_stopping_for_update = false
  desired_status            = "RUNNING"
  can_ip_forward            = false
  enable_display            = false
  labels                    = local.labels
  metadata                  = local.metadata
  confidential_instance_config {
    enable_confidential_compute = true
    confidential_instance_type  = "SEV"
  }
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }
  scheduling {
    automatic_restart   = false
    on_host_maintenance = "MIGRATE"
    provisioning_model  = "STANDARD"
  }
  boot_disk {
    auto_delete = true
    initialize_params {
      image = var.launch.confidential_space_image
      size  = 10
      type  = "pd-balanced"
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.executor[0].self_link
    # Outbound access only; direct ingress is blocked except GFE/health to 8443.
    access_config { network_tier = "PREMIUM" }
  }
  service_account {
    email  = local.emails[var.stage == "creation" ? "creation" : "runtime"]
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
  lifecycle {
    create_before_destroy = false
    replace_triggered_by  = [terraform_data.launch[0]]
  }
  depends_on = [google_project_service.executor, google_project_iam_member.attest, google_artifact_registry_repository_iam_member.pull, google_storage_bucket_iam_member.objects, google_storage_bucket_iam_member.config]
}
