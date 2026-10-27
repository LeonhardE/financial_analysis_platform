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
  description = "Nonsecret desired configuration for first-provision review, not an approval."
  value = {
    target             = "portfolio"
    environment        = local.environment
    bootstrap_image    = var.bootstrap_image
    secret_references  = {}
    runtime_iam_owner  = "administrator-bootstrap"
    release_mode       = "build_only"
    client_rules_owner = "administrator-bootstrap-service-stage"
  }
}
