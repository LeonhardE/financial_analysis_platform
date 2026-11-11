locals {
  # These are implemented top-level maps/arrays or opaque JSON strings. The Hub
  # uses exact document IDs/get_many, not Firestore queries on these fields.
  unindexed_fields = {
    hub_agent_recoveries                   = ["entries"]
    hub_runtime_setup_intents              = ["offer", "paired"]
    hub_native_oauth_pending               = ["entries"]
    hub_native_oauth_codes                 = ["context"]
    hub_native_oauth_access                = ["grantRefs"]
    hub_native_oauth_refresh               = ["grantRefs"]
    hub_native_oauth_families              = ["grantRefs"]
    hub_agent_identities                   = ["identity", "binding", "revocation", "credentialLease", "credentialApproval"]
    hub_agent_identity_history             = ["record"]
    hub_agent_credential_operations        = ["command", "receipt"]
    hub_agent_credential_setups            = ["offer"]
    hub_credential_lineage                 = ["predecessor"]
    hub_agent_identity_operations          = ["command", "receipt"]
    hub_resource_consents                  = ["consent", "operations"]
    hub_resource_consent_operations        = ["command", "sourceStates", "receipt"]
    hub_persistent_publications            = ["context", "carrierJson", "receipt"]
    hub_persistent_task_authorities        = ["context"]
    hub_persistent_runs                    = ["manifestJson", "identity", "registryHistory"]
    hub_persistent_results                 = ["metadata", "context", "receipt"]
    hub_persistent_result_content          = ["carrierJson"]
    hub_persistent_result_pages            = ["resultIds"]
    hub_persistent_result_state_operations = ["metadata"]
    hub_persistent_plans                   = ["reported", "observed"]
    hub_persistent_plan_operations         = ["receipt", "requestJson", "proofJson", "identity"]
    hub_vaults                             = ["registryHistory", "archive", "sources"]
    hub_vault_lifecycle                    = ["history"]
    hub_operations                         = ["command", "archiveCommand", "receipt"]
    hub_task_versions                      = ["carrierJson", "keyProofs"]
    hub_task_indexes                       = ["tasks", "cursors"]
    hub_oauth_pending                      = ["entries"]
    hub_oauth_owners                       = ["attempts", "connectionIds"]
    hub_oauth_connections                  = ["grants"]
    hub_oauth_codes                        = ["context"]
    hub_oauth_access                       = ["grantRefs"]
    hub_oauth_refresh                      = ["grantRefs"]
    hub_oauth_families                     = ["grantRefs"]
    hub_preparations                       = ["receipt"]
    hub_preparation_objects                = ["carrierJson", "operations"]
    hub_runs                               = ["manifestJson", "grantJson", "authorProofs", "cursors"]
    hub_run_components                     = ["carrierJson"]
    hub_run_proofs                         = ["bundleJson"]
    hub_run_indexes                        = ["runIds"]
    hub_result_revisions                   = ["carrierJson", "bundleJson", "proof"]
    hub_result_indexes                     = ["resultIds"]
    hub_inbox_cursors                      = ["cursors"]
    hub_result_state_operations            = ["operations"]
  }
  index_exemptions = merge([for collection, fields in local.unindexed_fields : {
    for field in fields : "${collection}_${field}" => {
      collection = collection
      field      = field
    }
  }]...)
}

# Historical exemptions above stay in state to avoid a destructive migration or index backfill.
# Credential limits and lineage use direct document IDs; no composite index or TTL.
# An index exemption is not a TTL policy. The shared module's ttl_fields always
# enables TTL and therefore must not own these fields.
resource "google_firestore_field" "opaque" {
  for_each = local.index_exemptions

  project    = local.project_id
  database   = module.database.database_id
  collection = each.value.collection
  field      = each.value.field
  index_config {}

  lifecycle { prevent_destroy = true }
}

output "index_exemptions" {
  description = "Implemented opaque fields with all single-field indexing disabled and no TTL."
  value       = local.index_exemptions
}

output "delegation_signing" {
  description = "Operational signing-only references; no user-content decryption or private key material."
  value = {
    key_ring_id   = google_kms_key_ring.delegation.id
    crypto_key_id = google_kms_crypto_key.delegation.id
    key_version   = "${google_kms_crypto_key.delegation.id}/cryptoKeyVersions/1"
    algorithm     = "RSA_SIGN_PKCS1_2048_SHA256"
  }
}
