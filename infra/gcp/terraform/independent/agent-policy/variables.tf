variable "enabled" {
  type    = bool
  default = false
}
variable "admin" {
  type = object({ project_id = string, region = string, repository_id = string, runtime_account_id = string })
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.admin.project_id)) && can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.admin.runtime_account_id))
    error_message = "Use the independently reviewed Policy project and exact runtime account ID."
  }
}
variable "lane" {
  type    = string
  default = null
  validation {
    condition     = var.lane == null ? true : try(jsondecode(var.lane).target == "agent-policy" && jsondecode(var.lane).projectId == var.admin.project_id && jsondecode(var.lane).inputs.deployment.runtime_account_id == var.admin.runtime_account_id, false)
    error_message = "Policy execution metadata must match this administrator root and its exact runtime identity."
  }
}
variable "execution_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.execution_enabled || (var.enabled && var.lane != null && var.workload_access_enabled)
    error_message = "Activation needs an enabled Owner root, reviewed public contract and explicit workload access."
  }
}
variable "workload_access_enabled" {
  type    = bool
  default = false
}
variable "runtime_act_as_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.runtime_act_as_enabled || (var.enabled && var.workload_access_enabled)
    error_message = "Runtime actAs is a separate grant after the actual runtime account exists."
  }
}
