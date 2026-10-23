output "bootstrap_state_bucket" {
  description = "Administrative backend bucket; migrate local bootstrap state here after the first apply."
  value       = google_storage_bucket.state["bootstrap"].name
}

output "execution_state_bucket" {
  description = "Backend bucket used only by approved execution roots."
  value       = google_storage_bucket.state["execution"].name
}

output "plan_artifact_bucket" {
  description = "Private, short-lived saved-plan bucket."
  value       = google_storage_bucket.plans.name
}

output "execution_service_accounts" {
  description = "Separate runtime identities; neither has business resource write permissions yet."
  value       = { for phase, account in google_service_account.execution : phase => account.email }
}

output "triggers" {
  description = "Repo-only trigger resource names for one-time verification after bootstrap."
  value = {
    plan  = google_cloudbuild_trigger.plan.id
    apply = google_cloudbuild_trigger.apply.id
  }
}
