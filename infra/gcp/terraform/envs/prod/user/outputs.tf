output "service" {
  description = "The existing User service identity and origin; image releases remain independent."
  value = {
    id   = module.user.id
    name = module.user.name
    uri  = module.user.uri
  }
}

output "runtime_service_account" {
  description = "Existing keyless User runtime identity; its permissions are administrator-managed."
  value       = module.runtime_identity.email
}

output "adoption_boundary" {
  description = "Imported-service boundaries verified during planning; these are not controller-owned settings."
  value = {
    uid                   = data.google_cloud_run_v2_service.user_boundary.uid
    service_max_instances = try(data.google_cloud_run_v2_service.user_boundary.scaling[0].max_instance_count, 0)
    invoker_iam_disabled  = data.google_cloud_run_v2_service.user_boundary.invoker_iam_disabled
  }
}
