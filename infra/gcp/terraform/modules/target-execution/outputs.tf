output "state_bucket" {
  description = "Private backend bucket owned by the administrative bootstrap for this target."
  value       = google_storage_bucket.state.name
}

output "state_prefix" {
  description = "Default-workspace backend prefix, shared with the registry and lock IAM condition."
  value       = local.state_prefix
}

output "service_accounts" {
  description = "Separate plan and apply keyless execution identities; business grants are provisioned separately."
  value       = { for phase, account in google_service_account.execution : phase => account.email }
}

output "triggers" {
  description = "Main-only plan and manually approved apply trigger resource names."
  value = {
    plan  = google_cloudbuild_trigger.plan.id
    apply = google_cloudbuild_trigger.apply.id
  }
}
