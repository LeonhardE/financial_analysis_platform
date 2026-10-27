output "database_id" {
  description = "Named database ID for explicit SDK and schema configuration."
  value       = google_firestore_database.this.name
}

output "resource_name" {
  description = "Exact database resource name used by database-level IAM conditions, not a collection or document scope."
  value       = "projects/${var.project_id}/databases/${google_firestore_database.this.name}"
}

output "location_id" {
  description = "Regional database location."
  value       = google_firestore_database.this.location_id
}

output "ttl_field_names" {
  description = "Provider field resource names keyed by the caller's stable logical names."
  value       = { for key, field in google_firestore_field.ttl : key => field.name }
}

output "composite_index_names" {
  description = "Provider composite index resource names keyed by the caller's stable logical names."
  value       = { for key, index in google_firestore_index.composite : key => index.name }
}
