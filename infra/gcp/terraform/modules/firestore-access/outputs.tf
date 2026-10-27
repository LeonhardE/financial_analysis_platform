output "database_resource_name" {
  description = "Exact database resource name; this module neither creates nor looks up the database."
  value       = local.database_resource_name
}

output "condition" {
  description = "Internally fixed type-and-name database condition, usable by an existing grant without moving its Terraform address."
  value       = local.condition
}

output "grants" {
  description = "Nonsecret metadata of additive grants keyed by their stable logical account keys; empty in scope-only mode."
  value = {
    for key, grant in google_project_iam_member.runtime : key => {
      project   = grant.project
      role      = grant.role
      member    = grant.member
      condition = local.condition
    }
  }
}
