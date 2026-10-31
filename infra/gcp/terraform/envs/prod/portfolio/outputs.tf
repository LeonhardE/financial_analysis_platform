output "service" {
  description = "Portfolio's service identity and origin; initial image is creation-only."
  value = {
    id   = module.portfolio.id
    name = module.portfolio.name
    uri  = module.portfolio.uri
  }
}

output "runtime_service_account" {
  description = "Dedicated keyless runtime; administrator bootstrap owns its IAM."
  value       = module.runtime_identity.email
}

output "database" {
  description = "Named encrypted-content database; never falls back to the default DB."
  value = {
    id       = module.database.database_id
    resource = module.database.resource_name
    location = module.database.location_id
  }
}

output "deployment_contract" {
  description = "Nonsecret selected configuration for existing Portfolio review, not an approval."
  value = {
    target             = "portfolio"
    environment        = local.environment
    bootstrap_image    = var.deployment.creation_image
    secret_references  = {}
    runtime_iam_owner  = "administrator-bootstrap"
    release_mode       = "existing_service_separately_gated"
    client_rules_owner = "administrator-bootstrap-service-stage"
  }
}

output "adoption_boundary" {
  description = "Read-only existing Portfolio identity/private-invocation/service-cap boundary."
  value = {
    uid                   = data.google_cloud_run_v2_service.portfolio_boundary.uid
    invoker_iam_disabled  = data.google_cloud_run_v2_service.portfolio_boundary.invoker_iam_disabled
    service_max_instances = try(data.google_cloud_run_v2_service.portfolio_boundary.scaling[0].max_instance_count, 0)
  }
}
