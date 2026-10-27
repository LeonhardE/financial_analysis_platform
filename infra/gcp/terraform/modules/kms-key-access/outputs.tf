output "crypto_key_id" {
  description = "Existing CryptoKey metadata reference, not key material or a version-level permission boundary."
  value       = var.crypto_key_id
}

output "usage" {
  description = "Selected fixed capability."
  value       = var.usage
}

output "role" {
  description = "The fixed minimal predefined role selected by usage."
  value       = local.role
}

output "grants" {
  description = "Resource/role/member metadata for the additive grants owned by this module. No private key or secret data is returned."
  value = {
    for key, grant in google_kms_crypto_key_iam_member.access : key => {
      crypto_key_id = grant.crypto_key_id
      role          = grant.role
      member        = grant.member
    }
  }
}
