output "base" {
  description = "Public Executor D2 references only; no attestation, Root enrollment, secret release, native installation or apply approval."
  value = {
    stage                    = var.stage
    project_id               = local.project
    region                   = local.region
    zone                     = var.deployment.zone
    instance_name            = local.name
    instance_id              = local.vm ? google_compute_instance.executor[0].instance_id : null
    runtime_service_account  = local.enabled ? local.emails.runtime : null
    creation_service_account = local.enabled ? local.emails.creation : null
    build_service_account    = local.enabled ? local.emails.build : null
    state_bucket             = local.enabled ? google_storage_bucket.state[0].name : null
    config_bucket            = local.enabled ? google_storage_bucket.config[0].name : null
    ingress_ip               = local.enabled ? google_compute_global_address.ingress[0].address : null
    backend_tls_port         = 8443
    public_tls_port          = 443
    tls_termination          = "measured_executor_only"
    kms_decrypt_granted      = false
  }
}
output "launch_review" {
  description = "Metadata for independent Root review. Operator environment is only a subset of the full OCI claim, never observed hardware proof or authorization."
  value = {
    image                      = try(var.launch.image, null)
    boot_image                 = try(var.launch.confidential_space_image, null)
    args                       = ["python", "-m", "app.main"]
    operator_environment       = local.operator_environment
    full_environment_observed  = false
    attestation_verified       = false
    actual_state_head_observed = false
  }
}
