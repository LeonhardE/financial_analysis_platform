output "service" {
  description = "The existing Market service identity and origin; image releases remain independent."
  value = {
    id   = module.market.id
    name = module.market.name
    uri  = module.market.uri
  }
}

output "runtime_service_account" {
  description = "Existing keyless Market runtime identity; its permissions are administrator-managed."
  value       = module.runtime_identity.email
}

output "adoption_boundary" {
  description = "Imported-service boundaries verified during planning; these are not controller-owned settings."
  value = {
    uid                   = data.google_cloud_run_v2_service.market_boundary.uid
    service_max_instances = try(data.google_cloud_run_v2_service.market_boundary.scaling[0].max_instance_count, 0)
    invoker_iam_disabled  = data.google_cloud_run_v2_service.market_boundary.invoker_iam_disabled
  }
}
