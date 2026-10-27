# Complete native provider-mocked plans; never credentialed deployment evidence.
mock_provider "google" {
  override_during = plan

  mock_resource "google_service_account" {
    defaults = {
      id     = "projects/financial-analysis-512202/serviceAccounts/fa-portfolio-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      email  = "fa-portfolio-runtime@financial-analysis-512202.iam.gserviceaccount.com"
      member = "serviceAccount:fa-portfolio-runtime@financial-analysis-512202.iam.gserviceaccount.com"
    }
  }
}

run "single_target_private_named_database_and_no_keys" {
  command = plan

  assert {
    condition = (
      output.service.name == "portfolio-api" &&
      output.runtime_service_account == "fa-portfolio-runtime@financial-analysis-512202.iam.gserviceaccount.com" &&
      output.database.id == "portfolio" &&
      output.database.resource == "projects/financial-analysis-512202/databases/portfolio" &&
      output.database.location == "northamerica-northeast2" &&
      output.deployment_contract.environment.FIRESTORE_DATABASE == "portfolio" &&
      output.deployment_contract.environment.CORS_ORIGINS == "https://market-web-630815932903.northamerica-northeast2.run.app" &&
      length(output.deployment_contract.secret_references) == 0 &&
      output.deployment_contract.release_mode == "build_only"
    )
    error_message = "Portfolio must target only its own keyless identity/named DB, exact Web origin and no secret or content-key references."
  }
}

run "reject_mutable_image_tag" {
  command = plan
  variables {
    bootstrap_image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/portfolio-api:latest"
  }
  expect_failures = [var.bootstrap_image]
}

run "reject_other_target_digest" {
  command = plan
  variables {
    bootstrap_image = "northamerica-northeast2-docker.pkg.dev/financial-analysis-512202/financial-analysis/agent-hub-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.bootstrap_image]
}
