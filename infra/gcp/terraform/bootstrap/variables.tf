variable "project_id" {
  description = "Explicit existing project selected by the operator and the repo deployment projection."
  type        = string
  nullable    = false

  validation {
    condition = try(
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id)) &&
      jsondecode(var.deployment_configs["repo"]).project.id == var.project_id,
      false,
    )
    error_message = "Select a valid project ID matching the explicit repo deployment projection."
  }
}

variable "region" {
  description = "Explicit existing Cloud Build region selected by the operator and repo deployment projection."
  type        = string
  nullable    = false

  validation {
    condition = try(
      can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.region)) &&
      jsondecode(var.deployment_configs["repo"]).region == var.region,
      false,
    )
    error_message = "Select a regional Cloud Build location matching the explicit repo deployment projection."
  }
}

variable "repository_id" {
  description = "Existing same-project/region Cloud Build v2 repository resource, bound to the explicit repo projection."
  type        = string
  nullable    = false

  validation {
    condition = try(
      can(regex("^[1-9][0-9]{5,19}$", jsondecode(var.deployment_configs["repo"]).project.number)) &&
      can(regex("^projects/(${var.project_id}|${jsondecode(var.deployment_configs["repo"]).project.number})/locations/${var.region}/connections/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/repositories/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", var.repository_id)) &&
      !strcontains(var.repository_id, "REPLACE_") &&
      jsondecode(var.deployment_configs["repo"]).source.repositoryResource == var.repository_id,
      false,
    )
    error_message = "Use the existing same-project/region repository resource selected by the repo projection."
  }
}

variable "deployment_configs" {
  description = "Canonical target-instance-v1 JSON required for every trigger-v1 catalog target, including disabled Portfolio. No production fallback, secrets or arbitrary environment maps. Inactive Hub preparation requires no adopted projection."
  type        = map(string)
  default     = {}
}
