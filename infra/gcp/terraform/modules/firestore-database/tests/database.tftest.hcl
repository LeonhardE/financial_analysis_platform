mock_provider "google" {
  override_during = plan
}

variables {
  project_id  = "example-project"
  database_id = "example-private"
}

run "protected_named_database_without_optional_schema" {
  command = plan

  assert {
    condition = (
      google_firestore_database.this.project == var.project_id &&
      google_firestore_database.this.name == var.database_id &&
      google_firestore_database.this.location_id == "northamerica-northeast2" &&
      google_firestore_database.this.type == "FIRESTORE_NATIVE" &&
      google_firestore_database.this.database_edition == "STANDARD" &&
      google_firestore_database.this.concurrency_mode == "PESSIMISTIC" &&
      google_firestore_database.this.app_engine_integration_mode == "DISABLED" &&
      google_firestore_database.this.point_in_time_recovery_enablement == "POINT_IN_TIME_RECOVERY_DISABLED" &&
      google_firestore_database.this.delete_protection_state == "DELETE_PROTECTION_ENABLED" &&
      google_firestore_database.this.deletion_policy == "ABANDON" &&
      length(google_firestore_field.ttl) == 0 &&
      length(google_firestore_index.composite) == 0 &&
      output.database_id == var.database_id &&
      output.resource_name == "projects/example-project/databases/example-private" &&
      output.location_id == "northamerica-northeast2" &&
      length(output.ttl_field_names) == 0 &&
      length(output.composite_index_names) == 0
    )
    error_message = "The module must own only a protected named database by default, with explicit location and no optional schema."
  }
}

run "ttl_and_composites_use_only_the_selected_database" {
  command = plan

  variables {
    database_id = "another-private"
    location_id = "us-central1"
    ttl_fields = {
      authorization = { collection_group = "authorizations", field = "expires_at" }
      audit         = { collection_group = "audit_records", field = "retention.expires_at", disable_indexes = false }
    }
    composite_indexes = {
      owner_created = {
        collection_group = "encrypted_results"
        fields = [
          { field_path = "owner_id", order = "ASCENDING" },
          { field_path = "created_at", order = "DESCENDING" },
        ]
      }
      tag_created = {
        collection_group = "encrypted_results"
        query_scope      = "COLLECTION_GROUP"
        fields = [
          { field_path = "tags", array_config = "CONTAINS" },
          { field_path = "metadata.created_at", order = "DESCENDING" },
        ]
      }
    }
  }

  assert {
    condition = (
      google_firestore_database.this.location_id == "us-central1" &&
      length(google_firestore_field.ttl) == 2 &&
      alltrue([for key, field in google_firestore_field.ttl : (
        field.project == var.project_id && field.database == "another-private" &&
        field.collection == var.ttl_fields[key].collection_group &&
        field.field == var.ttl_fields[key].field && length(field.ttl_config) == 1
      )]) &&
      length(google_firestore_field.ttl["authorization"].index_config) == 1 &&
      length(google_firestore_field.ttl["authorization"].index_config[0].indexes) == 0 &&
      length(google_firestore_field.ttl["audit"].index_config) == 0 &&
      length(google_firestore_index.composite) == 2 &&
      alltrue([for key, index in google_firestore_index.composite : (
        index.project == var.project_id && index.database == "another-private" &&
        index.collection == var.composite_indexes[key].collection_group &&
        index.query_scope == var.composite_indexes[key].query_scope &&
        index.deletion_policy == "PREVENT" && length(index.fields) == 2
      )]) &&
      google_firestore_index.composite["tag_created"].fields[0].array_config == "CONTAINS" &&
      google_firestore_index.composite["owner_created"].fields[1].order == "DESCENDING" &&
      toset(keys(output.ttl_field_names)) == toset(["authorization", "audit"]) &&
      toset(keys(output.composite_index_names)) == toset(["owner_created", "tag_created"])
    )
    error_message = "Optional schema must retain logical ownership, explicitly target the named database, and use one TTL/index owner per field."
  }
}

run "reject_default_database" {
  command = plan
  variables { database_id = "(default)" }
  expect_failures = [var.database_id]
}

run "accept_database_id_length_boundaries" {
  command = plan
  variables { database_id = "abcd" }
  assert {
    condition     = output.database_id == "abcd"
    error_message = "A four-character named database ID must be accepted."
  }
}

run "accept_maximum_database_id_length" {
  command = plan
  variables { database_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  assert {
    condition     = length(output.database_id) == 63
    error_message = "A valid 63-character named database ID must be accepted."
  }
}

run "reject_short_database_id" {
  command = plan
  variables { database_id = "abc" }
  expect_failures = [var.database_id]
}

run "reject_long_database_id" {
  command = plan
  variables { database_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  expect_failures = [var.database_id]
}

run "reject_database_resource_path" {
  command = plan
  variables { database_id = "projects/another-project/databases/private" }
  expect_failures = [var.database_id]
}

run "reject_database_wildcard" {
  command = plan
  variables { database_id = "private-*" }
  expect_failures = [var.database_id]
}

run "reject_database_uuid" {
  command = plan
  variables { database_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }
  expect_failures = [var.database_id]
}

run "reject_database_trailing_hyphen" {
  command = plan
  variables { database_id = "private-" }
  expect_failures = [var.database_id]
}

run "reject_database_uppercase" {
  command = plan
  variables { database_id = "Private" }
  expect_failures = [var.database_id]
}

run "reject_project_path_injection" {
  command = plan
  variables { project_id = "example-project/databases/private" }
  expect_failures = [var.project_id]
}

run "reject_project_number" {
  command = plan
  variables { project_id = "123456789012" }
  expect_failures = [var.project_id]
}

run "reject_location_path" {
  command = plan
  variables { location_id = "projects/example-project/locations/us-central1" }
  expect_failures = [var.location_id]
}

run "reject_multi_region" {
  command = plan
  variables { location_id = "nam5" }
  expect_failures = [var.location_id]
}

run "reject_duplicate_ttl_group" {
  command = plan
  variables {
    ttl_fields = {
      expiry = { collection_group = "authorizations", field = "expires_at" }
      other  = { collection_group = "authorizations", field = "other_expiry" }
    }
  }
  expect_failures = [var.ttl_fields]
}

run "reject_ttl_collection_path" {
  command = plan
  variables { ttl_fields = { expiry = { collection_group = "users/alice/authorizations", field = "expires_at" } } }
  expect_failures = [var.ttl_fields]
}

run "reject_ttl_field_wildcard" {
  command = plan
  variables { ttl_fields = { expiry = { collection_group = "authorizations", field = "*" } } }
  expect_failures = [var.ttl_fields]
}

run "reject_ttl_reserved_field" {
  command = plan
  variables { ttl_fields = { expiry = { collection_group = "authorizations", field = "metadata.__name__" } } }
  expect_failures = [var.ttl_fields]
}

run "reject_unstable_logical_key" {
  command = plan
  variables { ttl_fields = { "not/a/key" = { collection_group = "authorizations", field = "expires_at" } } }
  expect_failures = [var.ttl_fields]
}

run "reject_reserved_collection_group" {
  command = plan
  variables { ttl_fields = { expiry = { collection_group = "__private__", field = "expires_at" } } }
  expect_failures = [var.ttl_fields]
}

run "reject_null_ttl_entry" {
  command = plan
  variables { ttl_fields = { expiry = null } }
  expect_failures = [var.ttl_fields]
}

run "reject_duplicate_composite_definition" {
  command = plan
  variables {
    composite_indexes = {
      first = {
        collection_group = "encrypted_results"
        fields = [
          { field_path = "owner_id", order = "ASCENDING" },
          { field_path = "created_at", order = "DESCENDING" },
        ]
      }
      duplicate = {
        collection_group = "encrypted_results"
        fields = [
          { field_path = "owner_id", order = "ASCENDING" },
          { field_path = "created_at", order = "DESCENDING" },
        ]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_duplicate_index_field_path" {
  command = plan
  variables {
    composite_indexes = {
      duplicate = {
        collection_group = "encrypted_results"
        fields = [
          { field_path = "owner_id", order = "ASCENDING" },
          { field_path = "owner_id", order = "DESCENDING" },
        ]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_invalid_query_scope" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        query_scope      = "COLLECTION_RECURSIVE"
        fields           = [{ field_path = "owner_id", order = "ASCENDING" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_index_order_and_array_together" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        fields           = [{ field_path = "tags", order = "ASCENDING", array_config = "CONTAINS" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_index_without_field_mode" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        fields           = [{ field_path = "owner_id" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_invalid_index_order" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        fields           = [{ field_path = "owner_id", order = "ascending" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_multiple_array_fields" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        fields           = [{ field_path = "tags", array_config = "CONTAINS" }, { field_path = "labels", array_config = "CONTAINS" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_invalid_array_mode" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        fields           = [{ field_path = "tags", array_config = "ALL" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_null_composite_entry" {
  command = plan
  variables { composite_indexes = { invalid = null } }
  expect_failures = [var.composite_indexes]
}

run "reject_index_collection_resource_path" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "projects/another-project/databases/private/documents/results"
        fields           = [{ field_path = "owner_id", order = "ASCENDING" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_index_field_path_injection" {
  command = plan
  variables {
    composite_indexes = {
      invalid = {
        collection_group = "encrypted_results"
        fields           = [{ field_path = "users/alice", order = "ASCENDING" }, { field_path = "created_at", order = "DESCENDING" }]
      }
    }
  }
  expect_failures = [var.composite_indexes]
}

run "reject_single_field_composite" {
  command = plan
  variables {
    composite_indexes = {
      invalid = { collection_group = "encrypted_results", fields = [{ field_path = "owner_id", order = "ASCENDING" }] }
    }
  }
  expect_failures = [var.composite_indexes]
}
