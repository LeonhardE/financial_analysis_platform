output "id" {
  description = "Full Cloud Run resource ID for service-scoped references and imports."
  value       = google_cloud_run_v2_service.service.id
}

output "name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.service.name
}

output "uri" {
  description = "Cloud Run HTTPS URI; network ingress and IAM permissions still apply."
  value       = google_cloud_run_v2_service.service.uri
}
