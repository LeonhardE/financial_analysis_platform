variable "project_id" {
  description = "The existing production project; this foundation must not target another project."
  type        = string
  default     = "financial-analysis-512202"

  validation {
    condition     = var.project_id == "financial-analysis-512202"
    error_message = "This bootstrap is restricted to financial-analysis-512202."
  }
}

variable "region" {
  description = "The existing production region in Toronto."
  type        = string
  default     = "northamerica-northeast2"

  validation {
    condition     = var.region == "northamerica-northeast2"
    error_message = "Use the existing Toronto region, northamerica-northeast2."
  }
}

variable "repository_id" {
  description = "Existing Cloud Build v2 repository resource, not a GitHub URL."
  type        = string

  validation {
    condition = (
      can(regex("^projects/(financial-analysis-512202|630815932903)/locations/northamerica-northeast2/connections/[^/]+/repositories/[^/]+$", var.repository_id)) &&
      !strcontains(var.repository_id, "REPLACE_")
    )
    error_message = "Use the existing project's Toronto Cloud Build v2 repository resource name."
  }
}

variable "deployment_configs" {
  description = "Optional canonical target-instance-v1 JSON for explicitly migrated targets. Empty leaves existing consumers unchanged; no secrets or arbitrary environment maps."
  type        = map(string)
  default     = {}
}
