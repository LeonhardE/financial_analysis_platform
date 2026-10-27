resource "google_firestore_database" "this" {
  project                           = var.project_id
  name                              = var.database_id
  location_id                       = var.location_id
  type                              = "FIRESTORE_NATIVE"
  database_edition                  = "STANDARD"
  concurrency_mode                  = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABANDON"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_firestore_field" "ttl" {
  for_each = var.ttl_fields

  project    = var.project_id
  database   = google_firestore_database.this.name
  collection = each.value.collection_group
  field      = each.value.field

  # Provider 7.28.0 enables TTL with an empty block; its state is computed only.
  ttl_config {}

  # Omitting this block preserves inherited indexes; an empty block exempts this field.
  dynamic "index_config" {
    for_each = each.value.disable_indexes ? [true] : []
    content {}
  }
}

resource "google_firestore_index" "composite" {
  for_each = var.composite_indexes

  project         = var.project_id
  database        = google_firestore_database.this.name
  collection      = each.value.collection_group
  query_scope     = each.value.query_scope
  api_scope       = "ANY_API"
  deletion_policy = "PREVENT"

  dynamic "fields" {
    for_each = each.value.fields
    content {
      field_path   = fields.value.field_path
      order        = fields.value.order
      array_config = fields.value.array_config
    }
  }
}
