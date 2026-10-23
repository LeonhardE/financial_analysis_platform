run "repo_execution_contract_has_no_business_resources" {
  command = plan

  assert {
    condition = (
      terraform_data.execution_contract.input.project_id == "financial-analysis-512202" &&
      terraform_data.execution_contract.input.target == "repo" &&
      terraform_data.execution_contract.input.environment == "prod" &&
      terraform_data.execution_contract.input.schema_version == 1
    )
    error_message = "The initial execution root must exercise state without owning a business service."
  }
}
