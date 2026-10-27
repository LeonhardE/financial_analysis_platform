output "service" {
  value = {
    id   = module.agent_hub.id
    name = module.agent_hub.name
    uri  = module.agent_hub.uri
  }
}

output "runtime_service_account" {
  value = module.runtime_identity.email
}

output "database_resource_name" {
  value = module.database.resource_name
}

output "creation_configuration" {
  description = "Nonsecret desired service configuration for first-provision review; no approval is granted."
  value       = local.service_configuration
}
