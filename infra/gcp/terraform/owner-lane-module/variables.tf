variable "project_id" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use an explicit independent project ID."
  }
}
variable "region" {
  type = string
  validation {
    condition     = can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.region))
    error_message = "Use an explicit regional location."
  }
}
variable "target" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,28}[a-z0-9]$", var.target)) && !contains(["repo", "web", "shared", "bootstrap"], var.target)
    error_message = "Use one nonreserved independent target."
  }
}
variable "repository_id" {
  type = string
  validation {
    condition     = can(regex("^projects/(${var.project_id}|[0-9]+)/locations/${var.region}/connections/[A-Za-z0-9_.-]+/repositories/[A-Za-z0-9_.-]+$", var.repository_id))
    error_message = "Use this independent project's exact regional repository resource."
  }
}
variable "lane" {
  description = "Reviewed canonical public contract; null creates disabled execution resources only. Never a secret or ordinary operator projection."
  type        = string
  default     = null
  validation {
    condition = var.lane == null ? true : try(
      length(var.lane) <= 4000 && can(regex("^[\\x20-\\x7e]+$", var.lane)) && !strcontains(var.lane, "$") &&
      var.lane == jsonencode(jsondecode(var.lane)) && jsondecode(var.lane).schemaVersion == 1 &&
      jsondecode(var.lane).target == var.target && jsondecode(var.lane).projectId == var.project_id &&
      jsondecode(var.lane).region == var.region && jsondecode(var.lane).repository == var.repository_id,
      false,
    )
    error_message = "Pin a canonical bounded public lane contract to this target/project/region/source."
  }
}
variable "execution_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.execution_enabled || var.lane != null
    error_message = "Execution cannot be enabled without a separately reviewed public lane contract."
  }
}
