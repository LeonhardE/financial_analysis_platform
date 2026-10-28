# Exercise remote state, saved plans, approval, and stale-plan protection without
# provisioning billable resources or taking ownership of existing services.
resource "terraform_data" "execution_contract" {
  input = {
    schema_version = 1
    project_id     = var.deployment.project_id
    environment    = "prod"
    target         = "repo"
  }

  lifecycle {
    prevent_destroy = true
  }
}
