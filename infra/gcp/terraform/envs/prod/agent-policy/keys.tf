resource "google_kms_key_ring" "policy" {
  count    = local.enabled ? 1 : 0
  project  = local.project_id
  location = local.region
  name     = "folioview-independent-policy"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.policy]
}

resource "google_kms_crypto_key" "signing" {
  count                         = local.enabled ? 1 : 0
  name                          = "policy-es256"
  key_ring                      = google_kms_key_ring.policy[0].id
  purpose                       = "ASYMMETRIC_SIGN"
  skip_initial_version_creation = false
  destroy_scheduled_duration    = "2592000s"
  version_template {
    algorithm        = "EC_SIGN_P256_SHA256"
    protection_level = "SOFTWARE"
  }
  lifecycle { prevent_destroy = true }
}

resource "google_kms_crypto_key" "recovery" {
  count                         = local.enabled ? 1 : 0
  name                          = "executor-state-dek"
  key_ring                      = google_kms_key_ring.policy[0].id
  purpose                       = "ENCRYPT_DECRYPT"
  rotation_period               = "7776000s"
  destroy_scheduled_duration    = "2592000s"
  skip_initial_version_creation = false
  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }
  lifecycle { prevent_destroy = true }
}

# Deliberately no KMS/STS/WIP/impersonation grant in D1. Ordinary executor
# identities never receive direct KMS decrypt. The merged Policy verifies fresh
# signed Google custom-audience evidence, original keys/current VM and Root state,
# then wraps only the 32-byte DEK to the attested ephemeral boot recipient.
