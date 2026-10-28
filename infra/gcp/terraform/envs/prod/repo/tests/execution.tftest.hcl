variables {
  deployment = { project_id = "example-project-alpha" }
}

run "repo_execution_contract_has_no_business_resources" {
  command = plan

  assert {
    condition = (
      terraform_data.execution_contract.input.project_id == "example-project-alpha" &&
      terraform_data.execution_contract.input.target == "repo" &&
      terraform_data.execution_contract.input.environment == "prod" &&
      terraform_data.execution_contract.input.schema_version == 1
    )
    error_message = "The repo execution root must retain its contract address and exercise state without owning a business service."
  }
}

run "a_second_explicit_project_has_no_first_instance_fallback" {
  command = plan
  variables {
    deployment = { project_id = "example-project-beta" }
  }
  assert {
    condition     = terraform_data.execution_contract.input.project_id == "example-project-beta"
    error_message = "Repo inputs must come exclusively from the selected deployment, without an original-author default."
  }
}

run "reject_invalid_project_id" {
  command = plan
  variables {
    deployment = { project_id = "../invalid" }
  }
  expect_failures = [var.deployment]
}

run "reject_unknown_deployment_inputs" {
  command = plan
  variables {
    deployment = { project_id = "example-project-alpha", region = "us-central1" }
  }
  expect_failures = [var.deployment]
}

run "reject_missing_project_id" {
  command = plan
  variables {
    deployment = {}
  }
  expect_failures = [var.deployment]
}
