variable "stage" {
  description = "Owner administrator preparation only. none is inert; resources prepares build/storage/keys; base adds a private service with all authority/release gates closed. Retain base after creation."
  type        = string
  default     = "none"
  nullable    = false
  validation {
    condition     = contains(["none", "resources", "base"], var.stage)
    error_message = "Only none, resources and base are implemented; activation needs a separate reviewed binding change."
  }
}

variable "deployment" {
  description = "Explicit independent trusted Policy project and immutable build candidate. No author/project defaults or inferred product adoption of prototype resources."
  type = object({
    project_id                 = string
    region                     = string
    artifact_repository        = string
    runtime_account_id         = string
    build_account_id           = string
    creation_image             = optional(string)
    operator_project_ids       = set(string)
    snapshot_retention_seconds = optional(number, 604800)
  })
  nullable = false

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deployment.project_id)) &&
      can(regex("^[a-z]+(-[a-z0-9]+)+[0-9]$", var.deployment.region)) &&
      can(regex("^[a-z][a-z0-9-]{1,62}$", var.deployment.artifact_repository)) &&
      alltrue([for account in [var.deployment.runtime_account_id, var.deployment.build_account_id] :
        can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", account))
      ]) && var.deployment.runtime_account_id != var.deployment.build_account_id
    )
    error_message = "Use explicit canonical project/region/repository and distinct keyless runtime/build identities."
  }
  validation {
    condition = (
      length(var.deployment.operator_project_ids) >= 1 &&
      alltrue([for project in var.deployment.operator_project_ids : can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", project))]) &&
      !contains(var.deployment.operator_project_ids, var.deployment.project_id)
    )
    error_message = "Explicitly inventory routine Hub/executor operator projects; Policy must use a distinct trusted project. Actual inherited IAM/people isolation still needs live verification."
  }
  validation {
    condition = var.deployment.creation_image == null || can(regex(
      "^${var.deployment.region}-docker\\.pkg\\.dev/${var.deployment.project_id}/${var.deployment.artifact_repository}/agent-policy-api@sha256:[a-f0-9]{64}$",
      var.deployment.creation_image,
    ))
    error_message = "Pin the exact agent-policy-api digest from the independently reviewed successful build in this Policy project/repository."
  }
  validation {
    condition     = var.stage != "base" || var.deployment.creation_image != null
    error_message = "The base service stage requires a reviewed successful immutable build; resources prepares its repository/build identity without a placeholder image."
  }
  validation {
    condition = (
      var.deployment.snapshot_retention_seconds == floor(var.deployment.snapshot_retention_seconds) &&
      var.deployment.snapshot_retention_seconds >= 604800 &&
      var.deployment.snapshot_retention_seconds <= 2592000
    )
    error_message = "Use 7–30 days of unlocked minimum snapshot retention; no automatic correctness-state deletion or irreversible bucket lock."
  }
}
