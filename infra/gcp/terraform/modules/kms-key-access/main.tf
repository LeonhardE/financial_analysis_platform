locals {
  role_by_usage = {
    delegation_signer = "roles/cloudkms.signer"
    public_key_viewer = "roles/cloudkms.publicKeyViewer"
    firestore_cmek    = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  }
  role = lookup(local.role_by_usage, var.usage, null)
}

# Only an additive member grant on an existing CryptoKey. This module never
# creates or reads keys, versions, secret payloads, identities or project roles.
resource "google_kms_crypto_key_iam_member" "access" {
  for_each = local.role == null ? {} : var.members

  crypto_key_id = var.crypto_key_id
  role          = local.role
  member        = "serviceAccount:${each.value}"
}
