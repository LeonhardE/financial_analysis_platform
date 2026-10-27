locals {
  database_resource_name = "projects/${var.project_id}/databases/${var.database_id}"
  condition = {
    title       = var.database_id == "(default)" ? "database-default" : "database-named-${var.database_id}"
    description = "Datastore User access limited to the exact Firestore database ${local.database_resource_name}."
    expression  = "resource.type == 'firestore.googleapis.com/Database' && resource.name == '${local.database_resource_name}'"
  }
}

# This is additive member IAM, never an authoritative binding/policy. Its role
# and CEL are deliberately not caller-selectable. Empty input is scope-only.
resource "google_project_iam_member" "runtime" {
  for_each = var.runtime_service_accounts

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${each.value}"

  condition {
    title       = local.condition.title
    description = local.condition.description
    expression  = local.condition.expression
  }
}
