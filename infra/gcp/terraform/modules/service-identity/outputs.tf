output "id" {
  description = "Fully qualified runtime service account resource ID."
  value       = google_service_account.this.id
}

output "email" {
  description = "Runtime identity email for a Cloud Run service."
  value       = google_service_account.this.email
}

output "member" {
  description = "Runtime IAM member identifier for consumer-owned resource grants."
  value       = google_service_account.this.member
}
