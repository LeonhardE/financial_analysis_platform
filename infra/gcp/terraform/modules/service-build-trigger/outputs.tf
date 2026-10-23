output "id" {
  description = "Full trigger resource ID, suitable for later import and inspection."
  value       = google_cloudbuild_trigger.this.id
}

output "trigger_id" {
  description = "Cloud Build trigger UUID."
  value       = google_cloudbuild_trigger.this.trigger_id
}

output "name" {
  description = "Cloud Build trigger name."
  value       = google_cloudbuild_trigger.this.name
}
