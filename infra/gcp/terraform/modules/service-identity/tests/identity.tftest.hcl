mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/financial-analysis-512202/serviceAccounts/fa-example@financial-analysis-512202.iam.gserviceaccount.com"
      name   = "projects/financial-analysis-512202/serviceAccounts/fa-example@financial-analysis-512202.iam.gserviceaccount.com"
      email  = "fa-example@financial-analysis-512202.iam.gserviceaccount.com"
      member = "serviceAccount:fa-example@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id   = "financial-analysis-512202"
  account_id   = "fa-example"
  display_name = "Example runtime"
}

run "keyless_identity_has_no_default_grants" {
  command = plan

  assert {
    condition = (
      google_service_account.this.project == var.project_id &&
      google_service_account.this.account_id == var.account_id &&
      !google_service_account.this.disabled &&
      length(google_secret_manager_secret_iam_member.accessor) == 0 &&
      length(google_service_account_iam_member.deployer) == 0 &&
      output.id == google_service_account.this.id &&
      output.email == google_service_account.this.email &&
      output.member == google_service_account.this.member
    )
    error_message = "A runtime identity must be enabled, expose only its identifiers, and grant no access by default."
  }
}

run "grants_are_incremental_and_resource_scoped" {
  command = plan

  variables {
    secret_ids = {
      token  = "projects/financial-analysis-512202/secrets/example-token"
      config = "projects/financial-analysis-512202/secrets/example-config"
    }
    deployer_service_accounts = {
      build = "fa-build@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }

  assert {
    condition = (
      length(google_secret_manager_secret_iam_member.accessor) == 2 &&
      alltrue([for key, grant in google_secret_manager_secret_iam_member.accessor : (
        grant.project == var.project_id &&
        grant.secret_id == var.secret_ids[key] &&
        grant.role == "roles/secretmanager.secretAccessor" &&
        grant.member == google_service_account.this.member
      )]) &&
      length(google_service_account_iam_member.deployer) == 1 &&
      alltrue([for key, grant in google_service_account_iam_member.deployer : (
        grant.service_account_id == google_service_account.this.name &&
        grant.role == "roles/iam.serviceAccountUser" &&
        grant.member == "serviceAccount:${var.deployer_service_accounts[key]}"
      )])
    )
    error_message = "Each optional grant must bind only the selected secret or runtime account with its fixed minimal role."
  }
}

run "reject_invalid_account_id" {
  command = plan
  variables {
    account_id = "Runtime_Invalid"
  }
  expect_failures = [var.account_id]
}

run "reject_short_account_id" {
  command = plan
  variables {
    account_id = "short"
  }
  expect_failures = [var.account_id]
}

run "reject_invalid_project_id" {
  command = plan
  variables {
    project_id = "Not_A_Project"
  }
  expect_failures = [var.project_id]
}

run "reject_empty_display_name" {
  command = plan
  variables {
    display_name = " "
  }
  expect_failures = [var.display_name]
}

run "reject_cross_project_secret" {
  command = plan
  variables {
    secret_ids = { token = "projects/another-project/secrets/example-token" }
  }
  expect_failures = [var.secret_ids]
}

run "reject_duplicate_secret_ownership" {
  command = plan
  variables {
    secret_ids = {
      token = "projects/financial-analysis-512202/secrets/example-token"
      alias = "projects/financial-analysis-512202/secrets/example-token"
    }
  }
  expect_failures = [var.secret_ids]
}

run "reject_secret_version_reference" {
  command = plan
  variables {
    secret_ids = { token = "projects/financial-analysis-512202/secrets/example-token/versions/latest" }
  }
  expect_failures = [var.secret_ids]
}

run "reject_short_secret_reference" {
  command = plan
  variables {
    secret_ids = { token = "example-token" }
  }
  expect_failures = [var.secret_ids]
}

run "reject_cross_project_deployer" {
  command = plan
  variables {
    deployer_service_accounts = { build = "fa-build@another-project.iam.gserviceaccount.com" }
  }
  expect_failures = [var.deployer_service_accounts]
}

run "reject_duplicate_deployer_ownership" {
  command = plan
  variables {
    deployer_service_accounts = {
      build = "fa-build@financial-analysis-512202.iam.gserviceaccount.com"
      alias = "fa-build@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
  expect_failures = [var.deployer_service_accounts]
}

run "reject_human_deployer" {
  command = plan
  variables {
    deployer_service_accounts = { build = "user@example.com" }
  }
  expect_failures = [var.deployer_service_accounts]
}

run "reject_public_deployer" {
  command = plan
  variables {
    deployer_service_accounts = { build = "allUsers" }
  }
  expect_failures = [var.deployer_service_accounts]
}
