output "base" {
  description = "Public independent Policy references and explicit gate selections; no Root approval, live attestation or apply authorization."
  value = {
    stage                   = var.stage
    project_id              = local.project_id
    region                  = local.region
    service                 = local.service_enabled ? { id = module.agent_policy[0].id, uri = module.agent_policy[0].uri } : null
    runtime_service_account = local.enabled ? local.runtime_email : null
    build_service_account   = local.enabled ? local.build_email : null
    witness                 = local.enabled ? module.witness[0].resource_name : null
    snapshot_bucket         = local.enabled ? google_storage_bucket.snapshots[0].name : null
    signing_key_version     = local.enabled ? "${google_kms_crypto_key.signing[0].id}/cryptoKeyVersions/1" : null
    recovery_key            = local.enabled ? google_kms_crypto_key.recovery[0].id : null
    authority_enabled       = var.authority_enabled
    key_release_enabled     = var.key_release_enabled
    public_invocation       = var.public_invocation
  }
}

output "creation_configuration" {
  description = "Closed selected-target configuration; populated authority remains off unless separately enabled. Public values only."
  value       = { environment = local.environment, min_instances = 0, max_instances = 1, concurrency = 4 }
}
