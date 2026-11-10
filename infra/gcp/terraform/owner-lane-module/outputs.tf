output "lane" {
  value = {
    state_bucket = google_storage_bucket.private["state"].name
    plan_bucket  = google_storage_bucket.private["plans"].name
    state_prefix = "prod/${var.target}"
    accounts     = { for phase, account in google_service_account.execution : phase => account.email }
    triggers     = { plan = google_cloudbuild_trigger.plan.trigger_id, apply = google_cloudbuild_trigger.apply.trigger_id }
    enabled      = var.execution_enabled
  }
}
