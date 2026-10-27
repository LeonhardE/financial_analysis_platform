mock_provider "google" {
  override_during = apply
}

variables {
  project_id  = "example-project"
  database_id = "(default)"
}

run "default_scope_only_creates_no_iam" {
  command = plan
  assert {
    condition = (
      length(google_project_iam_member.runtime) == 0 &&
      length(output.grants) == 0 &&
      output.database_resource_name == "projects/example-project/databases/(default)" &&
      output.condition.title == "database-default" &&
      output.condition.expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/example-project/databases/(default)'" &&
      toset(keys(output.condition)) == toset(["title", "description", "expression"])
    )
    error_message = "Empty runtime map must expose only the exact default-database condition and create no IAM."
  }
}

run "named_scope_only_has_distinct_title_and_exact_resource" {
  command = plan
  variables {
    database_id = "default"
  }
  assert {
    condition = (
      length(google_project_iam_member.runtime) == 0 &&
      output.condition.title == "database-named-default" &&
      output.condition.title != "database-default" &&
      output.database_resource_name == "projects/example-project/databases/default" &&
      output.condition.expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/example-project/databases/default'"
    )
    error_message = "A named database must never alias the special default database condition."
  }
}

run "fixed_role_members_and_type_name_condition_are_additive" {
  command = plan
  variables {
    database_id = "agent-data"
    runtime_service_accounts = {
      runtime = "runtime-example@example-project.iam.gserviceaccount.com"
      worker  = "worker-example@example-project.iam.gserviceaccount.com"
    }
  }
  assert {
    condition = (
      length(google_project_iam_member.runtime) == 2 &&
      toset(keys(output.grants)) == toset(["runtime", "worker"]) &&
      alltrue([for key, grant in google_project_iam_member.runtime : (
        grant.project == var.project_id &&
        grant.role == "roles/datastore.user" &&
        grant.member == "serviceAccount:${var.runtime_service_accounts[key]}" &&
        length(grant.condition) == 1 &&
        grant.condition[0].title == output.condition.title &&
        grant.condition[0].description == output.condition.description &&
        grant.condition[0].expression == "resource.type == 'firestore.googleapis.com/Database' && resource.name == 'projects/example-project/databases/agent-data'" &&
        output.grants[key].role == grant.role &&
        output.grants[key].member == grant.member
      )])
    )
    error_message = "Each stable runtime key must own one fixed Datastore User member with the exact database condition."
  }
}

run "computed_runtime_email_keeps_instance_keys_known_at_plan" {
  command = plan
  module {
    source = "./tests/fixtures/computed"
  }
  assert {
    condition = (
      length(output.grants) == 1 &&
      contains(keys(output.grants), "runtime") &&
      output.grants["runtime"].role == "roles/datastore.user" &&
      output.scope == "projects/example-project/databases/user-data"
    )
    error_message = "A new service account email unknown until apply must not make IAM instance keys unknown."
  }
}

run "reject_invalid_project" {
  command = plan
  variables {
    project_id = "Not_A_Project"
  }
  expect_failures = [var.project_id]
}

run "reject_short_database_id" {
  command = plan
  variables {
    database_id = "abc"
  }
  expect_failures = [var.database_id]
}

run "reject_database_path" {
  command = plan
  variables {
    database_id = "projects/example-project/databases/agent-data"
  }
  expect_failures = [var.database_id]
}

run "reject_database_wildcard" {
  command = plan
  variables {
    database_id = "*"
  }
  expect_failures = [var.database_id]
}

run "reject_uppercase_database" {
  command = plan
  variables {
    database_id = "User-Data"
  }
  expect_failures = [var.database_id]
}

run "reject_database_condition_injection" {
  command = plan
  variables {
    database_id = "data' || true"
  }
  expect_failures = [var.database_id]
}

run "reject_uuid_like_database" {
  command = plan
  variables {
    database_id = "a2345678-abcd-abcd-abcd-123456789abc"
  }
  expect_failures = [var.database_id]
}

run "reject_cross_project_runtime" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "runtime-example@another-project.iam.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_human_runtime" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "person@example.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_public_runtime" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "allUsers" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_prefixed_member" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "serviceAccount:runtime-example@example-project.iam.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_default_compute_service_account" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "123456789-compute@developer.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_google_service_agent" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "service-123456789@gcp-sa-firestore.iam.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_runtime_wildcard" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "runtime-*@example-project.iam.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_runtime_path" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = "projects/example-project/serviceAccounts/runtime-example@example-project.iam.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_null_member" {
  command = plan
  variables {
    runtime_service_accounts = { runtime = null }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_duplicate_runtime_membership" {
  command = plan
  variables {
    runtime_service_accounts = {
      runtime = "runtime-example@example-project.iam.gserviceaccount.com"
      alias   = "runtime-example@example-project.iam.gserviceaccount.com"
    }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_unsafe_logical_key" {
  command = plan
  variables {
    runtime_service_accounts = { "runtime/path" = "runtime-example@example-project.iam.gserviceaccount.com" }
  }
  expect_failures = [var.runtime_service_accounts]
}

run "reject_more_than_ten_members" {
  command = plan
  variables {
    runtime_service_accounts = {
      for i in range(11) : "runtime-${i}" => "runtime-${i}@example-project.iam.gserviceaccount.com"
    }
  }
  expect_failures = [var.runtime_service_accounts]
}
