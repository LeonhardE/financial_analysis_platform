variable "deployment" {
  description = "Explicit repo-only inputs from the verified target-instance projection; no production default or arbitrary Terraform variable map."
  type        = map(string)
  nullable    = false

  validation {
    condition = try(
      toset(keys(var.deployment)) == toset(["project_id"]) &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.project_id)),
      false,
    )
    error_message = "Repo deployment must contain exactly one valid project_id."
  }
}
