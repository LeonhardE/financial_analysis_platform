terraform {
  required_version = "= 1.16.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 7.28.0"
    }
  }
}

resource "google_service_account" "runtime" {
  project      = "example-project"
  account_id   = "runtime-example"
  display_name = "Computed service-account fixture"
}

module "access" {
  source = "../../.."

  project_id  = "example-project"
  database_id = "user-data"
  runtime_service_accounts = {
    runtime = google_service_account.runtime.email
  }
}

output "grants" {
  value = module.access.grants
}

output "scope" {
  value = module.access.database_resource_name
}
