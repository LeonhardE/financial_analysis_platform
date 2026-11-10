# A live named DB is an independent anti-rollback witness, never a backup source.
module "witness" {
  count             = local.enabled ? 1 : 0
  source            = "../../../modules/firestore-database"
  project_id        = local.project_id
  database_id       = local.database_id
  location_id       = local.region
  ttl_fields        = {}
  composite_indexes = {}
  depends_on        = [google_project_service.policy]
}

resource "google_firestore_field" "pointer" {
  for_each   = local.enabled ? toset(["domain", "sequence", "digest", "previous"]) : toset([])
  project    = local.project_id
  database   = module.witness[0].database_id
  collection = "policy_live_heads"
  field      = each.value
  index_config {}
  lifecycle { prevent_destroy = true }
}

resource "google_firebaserules_ruleset" "deny_clients" {
  count   = local.enabled ? 1 : 0
  project = local.project_id
  source {
    files {
      name    = "firestore.rules"
      content = <<-RULES
        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /{document=**} {
              allow read, write: if false;
            }
          }
        }
      RULES
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.policy]
}
resource "google_firebaserules_release" "deny_clients" {
  count        = local.enabled ? 1 : 0
  project      = local.project_id
  name         = "cloud.firestore/${local.database_id}"
  ruleset_name = google_firebaserules_ruleset.deny_clients[0].name
  lifecycle { prevent_destroy = true }
  depends_on = [module.witness]
}

resource "google_storage_bucket" "snapshots" {
  count                       = local.enabled ? 1 : 0
  project                     = local.project_id
  name                        = local.snapshot_name
  location                    = local.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  retention_policy {
    retention_period = var.deployment.snapshot_retention_seconds
    is_locked        = false
  }
  soft_delete_policy { retention_duration_seconds = 604800 }
  # No timer may delete a snapshot still selected by the live witness or lineage.
  # No runtime/ordinary executor gets IAM yet; D3 binds exact approved authority.
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.policy]
}
