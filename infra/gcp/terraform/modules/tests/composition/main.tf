# Test-only fixture: no execution target or production root calls this module.
# Computed resource identifiers deliberately remain unknown during the mock plan.
resource "google_secret_manager_secret" "model" {
  project   = "example-project"
  secret_id = "example-model"

  replication {
    auto {}
  }
}

module "build" {
  source = "../../service-identity"

  project_id   = "example-project"
  account_id   = "example-build"
  display_name = "Example build identity"
}

module "caller" {
  source = "../../service-identity"

  project_id   = "example-project"
  account_id   = "example-caller"
  display_name = "Example caller identity"
}

module "runtime" {
  source = "../../service-identity"

  project_id   = "example-project"
  account_id   = "example-runtime"
  display_name = "Example runtime identity"

  secret_ids = {
    model = google_secret_manager_secret.model.id
  }
  deployer_service_accounts = {
    build = module.build.email
  }
}

module "service" {
  source = "../../cloud-run-service"

  project_id              = "example-project"
  name                    = "example-api"
  runtime_service_account = module.runtime.email
  image                   = "example.com/images/example-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  invoker_service_accounts = {
    caller = module.caller.email
  }
  secret_environment = {
    MODEL_KEY = {
      secret  = google_secret_manager_secret.model.id
      version = "1"
    }
  }

  # An email dependency alone would not order the service after accessor grants.
  depends_on = [module.runtime]
}

module "trigger" {
  source = "../../service-build-trigger"

  project_id            = "example-project"
  name                  = "build-example-api"
  repository_id         = "projects/example-project/locations/northamerica-northeast2/connections/example/repositories/application"
  build_service_account = module.build.id
  filename              = "infra/gcp/cloudbuild.example.yaml"
  included_files        = ["services/example-service/**"]
}

output "service_name" {
  value = module.service.name
}

output "trigger_name" {
  value = module.trigger.name
}
